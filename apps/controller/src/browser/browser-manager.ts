import path from "node:path";
import crypto from "node:crypto";
import {
  generateSolWakeMessage,
  type BrowserStatus,
  type SolWakeRecord,
  type SolWakeResultStatus,
  type RepositoryMutationEvent,
  ValidationError
} from "@orca/shared";
import { ProfileLockManager } from "./profile-lock.js";
import type { BrowserDriver } from "./browser-driver.js";
import { PlaywrightDriver } from "./playwright-driver.js";
import { SolWakeSubmitter } from "./sol-wake-submitter.js";
import type { SolWakeStore } from "./sol-wake-store.js";

export interface BrowserManagerOptions {
  dataDir: string;
  driver?: BrowserDriver;
  wakeStore: SolWakeStore;
  submitter?: SolWakeSubmitter;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
}

/** Backpressure budget before a wake is reported busy/queued (L). */
const WAKE_LOCK_RETRIES = 5;
const WAKE_LOCK_RETRY_MS = 1500;

export class BrowserManager {
  private readonly profileDir: string;
  private readonly lockManager: ProfileLockManager;
  private readonly driver: BrowserDriver;
  private readonly wakeStore: SolWakeStore;
  private readonly submitter: SolWakeSubmitter;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;
  private isSetupOpen = false;

  constructor(options: BrowserManagerOptions) {
    this.profileDir = path.join(options.dataDir, "browser", "profile");
    this.lockManager = new ProfileLockManager(this.profileDir);
    this.driver = options.driver || new PlaywrightDriver();
    this.wakeStore = options.wakeStore;
    this.submitter = options.submitter || new SolWakeSubmitter();
    this.eventPublisher = options.eventPublisher;
  }

  async openSetupBrowser(): Promise<void> {
    if (this.isSetupOpen) return;

    if (!this.lockManager.acquire("INTERACTIVE_SETUP")) {
      const holder = this.lockManager.getLockInfo();
      throw new ValidationError(
        holder && holder.mode === "AUTOMATED"
          ? "Automated Chromium owns the profile; headed setup cannot reuse it. Wait for automated operations to finish."
          : "Browser profile is currently locked by another process."
      );
    }

    try {
      await this.driver.launch(this.profileDir, false); // Headed for user login
      await this.driver.openPage("setup", "https://chatgpt.com");
      this.isSetupOpen = true;
    } catch (err) {
      this.lockManager.release();
      throw err;
    }
  }

  async closeSetupBrowser(): Promise<void> {
    if (!this.isSetupOpen) return;

    try {
      await this.driver.close();
    } finally {
      this.isSetupOpen = false;
      this.lockManager.release();
    }
  }

  /**
   * Submit a Sol wake. Returns the durable wake record. Real ChatGPT transport
   * is handled by the driver/submitter; the loop uses the returned status.
   */
  async submitSolWake(
    repositoryId: string,
    params: {
      runId: string;
      iteration: number;
      dispatchId?: string | null;
      resultStatus: SolWakeResultStatus;
      conversationUrl: string;
      repositoryName: string;
    }
  ): Promise<SolWakeRecord> {
    const wakeId = crypto.randomUUID();
    const now = new Date().toISOString();

    const message = generateSolWakeMessage({
      repositoryName: params.repositoryName,
      runId: params.runId,
      iteration: params.iteration,
      dispatchId: params.dispatchId || "none",
      resultStatus: params.resultStatus
    });

    // Duplicate wake idempotency (L): do not double-submit the SAME wake intent.
    // The wake intent is its full generated message (runId + iteration + dispatchId
    // + resultStatus). The initial wake and a later executor-completed wake for the
    // same run are DISTINCT intents and BOTH must be delivered; keying dedup on
    // runId alone would silently swallow the subsequent wake (Q/L defect).
    const existing = this.wakeStore
      .getByRepository(repositoryId)
      .find(
        (w) =>
          w.runId === params.runId &&
          w.message === message &&
          w.status !== "failed" &&
          w.status !== "busy"
      );
    if (existing) {
      return existing;
    }

    const wakeRecord: SolWakeRecord = {
      id: wakeId,
      repositoryId,
      runId: params.runId,
      dispatchId: params.dispatchId ?? null,
      conversationUrl: params.conversationUrl,
      message,
      status: "pending",
      errorMessage: null,
      submittedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.wakeStore.create(wakeRecord);

    // Backpressure: wait for the automated profile lock to free up (L).
    let locked = false;
    for (let attempt = 0; attempt < WAKE_LOCK_RETRIES; attempt++) {
      if (this.lockManager.acquire("AUTOMATED")) {
        locked = true;
        break;
      }
      await new Promise<void>((r) => setTimeout(r, WAKE_LOCK_RETRY_MS));
    }

    if (!locked) {
      this.wakeStore.updateStatus(wakeId, "busy", {
        errorMessage: "Profile is locked by setup browser or another process"
      });
      return this.wakeStore.get(wakeId)!;
    }

    try {
      if (!this.driver.isRunning()) {
        await this.driver.launch(this.profileDir, true); // Headless for automated wake
      }

      const page = await this.driver.openPage(repositoryId, params.conversationUrl);
      await this.submitter.submitWake(page, message);

      const submittedAt = new Date().toISOString();
      this.wakeStore.updateStatus(wakeId, "submitted", { submittedAt });

      this.publishEvent({
        type: "repository.updated",
        at: submittedAt,
        repositoryId
      });

      // Close this repository's page when its Sol operation completes (L).
      await this.closeRepositoryPage(repositoryId);
      return this.wakeStore.get(wakeId)!;
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      // Cloudflare/CAPTCHA/verification -> ATTENTION_REQUIRED signal for the loop.
      const needsAttention =
        /ATTENTION_REQUIRED|verification|cloudflare|captcha|login required/i.test(errorMessage);
      this.wakeStore.updateStatus(wakeId, "failed", { errorMessage });
      throw new Error(needsAttention ? `ATTENTION_REQUIRED: ${errorMessage}` : errorMessage);
    } finally {
      // If no active Sol pages remain, close Chromium so it does not idle (L).
      if (!this.isSetupOpen && this.driver.activePageCount() === 0) {
        await this.driver.close().catch(() => {});
      }
      // Automated lock is released when the full browser closes; release defensively.
      if (!this.driver.isRunning()) {
        this.lockManager.release();
      }
    }
  }

  /** Close the browser page associated with a repository (L). */
  async closeRepositoryPage(repositoryId: string): Promise<void> {
    try {
      await this.driver.closePage(repositoryId);
    } catch (err) {
      console.warn("[BrowserManager] Failed to close repository page:", err);
    }
  }

  getStatus(): BrowserStatus {
    const lockInfo = this.lockManager.getLockInfo();
    return {
      isRunning: this.driver.isRunning(),
      isSetupOpen: this.isSetupOpen,
      activePages: this.driver.activePageCount(),
      profilePath: this.profileDir,
      lockHolderPid: lockInfo ? lockInfo.pid : null
    };
  }

  async close(): Promise<void> {
    try {
      if (this.driver.isRunning()) {
        await this.driver.close();
      }
    } finally {
      this.lockManager.release();
      this.isSetupOpen = false;
    }
  }

  private publishEvent(event: RepositoryMutationEvent): void {
    if (this.eventPublisher) {
      try {
        this.eventPublisher(event);
      } catch (err) {
        console.warn("[BrowserManager] Failed to publish event:", err);
      }
    }
  }
}

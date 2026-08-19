import path from "node:path";
import crypto from "node:crypto";
import {
  generateSolWakeMessage,
  type BrowserStatus,
  type SolWakeRecord,
  type ExecutorResultStatus,
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

    if (!this.lockManager.acquire("interactive_setup")) {
      throw new ValidationError("Browser profile is currently locked by another process.");
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

  async submitSolWake(
    repositoryId: string,
    params: {
      runId: string;
      iteration: number;
      dispatchId?: string | null;
      resultStatus: ExecutorResultStatus;
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

    if (!this.lockManager.acquire("automated_wake")) {
      this.wakeStore.updateStatus(wakeId, "busy", {
        errorMessage: "Profile is locked by setup browser or another process"
      });
      return this.wakeStore.get(wakeId)!;
    }

    try {
      if (!this.driver.isRunning()) {
        await this.driver.launch(this.profileDir, true); // Headless for automated background wake
      }

      const page = await this.driver.openPage(repositoryId, params.conversationUrl);
      await this.submitter.submitWake(page, message);

      const submittedAt = new Date().toISOString();
      this.wakeStore.updateStatus(wakeId, "submitted", {
        submittedAt
      });

      this.publishEvent({
        type: "repository.updated",
        at: submittedAt,
        repositoryId
      });

      return this.wakeStore.get(wakeId)!;
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      this.wakeStore.updateStatus(wakeId, "failed", {
        errorMessage
      });
      return this.wakeStore.get(wakeId)!;
    } finally {
      // Keep automated browser context alive for page multiplexing, release lock on full close
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

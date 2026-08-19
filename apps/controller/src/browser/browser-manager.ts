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
import { getChromiumStatus, type ChromiumStatus } from "./provisioning.js";

export interface BrowserManagerOptions {
  dataDir: string;
  driver?: BrowserDriver;
  wakeStore: SolWakeStore;
  submitter?: SolWakeSubmitter;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
  solTimeoutMs?: number;
  onSolStalled?: (repositoryId: string, runId: string, errorMessage: string) => void | Promise<void>;
}

/** Backpressure budget before a wake is reported busy/queued (L). */
const WAKE_LOCK_RETRIES = 5;
const WAKE_LOCK_RETRY_MS = 1500;
export const DEFAULT_SOL_TIMEOUT_MS = 20 * 60 * 1000;

export interface SolOperationRecord {
  repositoryId: string;
  runId: string;
  iteration: number;
  wakeId: string;
  submittedAt: string;
  deadline: number;
  retryCount: number;
  conversationUrl: string;
  repositoryName: string;
  dispatchId: string | null;
  resultStatus: SolWakeResultStatus;
}

export class BrowserManager {
  private readonly profileDir: string;
  private readonly lockManager: ProfileLockManager;
  private readonly driver: BrowserDriver;
  private readonly wakeStore: SolWakeStore;
  private readonly submitter: SolWakeSubmitter;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;
  private isSetupOpen = false;
  private readonly solTimeoutMs: number;
  private onSolStalled?: (repositoryId: string, runId: string, errorMessage: string) => void | Promise<void>;

  private readonly solOperations = new Map<string, SolOperationRecord>();
  private readonly solTimeoutHandles = new Map<string, NodeJS.Timeout>();

  constructor(options: BrowserManagerOptions) {
    this.profileDir = path.join(options.dataDir, "browser", "profile");
    this.lockManager = new ProfileLockManager(this.profileDir);
    this.driver = options.driver || new PlaywrightDriver();
    this.wakeStore = options.wakeStore;
    this.submitter = options.submitter || new SolWakeSubmitter();
    this.eventPublisher = options.eventPublisher;
    this.solTimeoutMs = options.solTimeoutMs ?? DEFAULT_SOL_TIMEOUT_MS;
    this.onSolStalled = options.onSolStalled;
  }

  setSolStalledHandler(handler: (repositoryId: string, runId: string, errorMessage: string) => void | Promise<void>): void {
    this.onSolStalled = handler;
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
   * Keeps repository page alive until expected Git transition (dispatch or control) arrives.
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

      // FIX #9: Keep repository page alive until expected Git transition arrives.
      // Record Sol operation for lifecycle tracking, schedule timeout, do NOT close page here.
      this.registerSolOperation(repositoryId, {
        runId: params.runId,
        iteration: params.iteration,
        wakeId,
        submittedAt,
        conversationUrl: params.conversationUrl,
        repositoryName: params.repositoryName,
        dispatchId: params.dispatchId ?? null,
        resultStatus: params.resultStatus
      });

      return this.wakeStore.get(wakeId)!;
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      const isBusy = /BUSY/i.test(errorMessage);
      const needsAttention =
        /ATTENTION_REQUIRED|CHATGPT_AUTH_REQUIRED|verification|cloudflare|captcha|login required/i.test(errorMessage);
      if (isBusy) {
        // Bounded backpressure: mark busy, do not treat as hard failure, do not bypass limits
        this.wakeStore.updateStatus(wakeId, "busy", { errorMessage });
        // Keep page alive for potential retry after backoff? For now mark busy and return.
        return this.wakeStore.get(wakeId)!;
      }
      this.wakeStore.updateStatus(wakeId, "failed", { errorMessage });
      throw new Error(needsAttention ? `ATTENTION_REQUIRED: ${errorMessage}` : errorMessage);
    } finally {
      // Do NOT close Chromium here based on activePageCount ==0 check that would race with kept-alive pages.
      // Only close if driver has no pages and no pending Sol operations and not in setup.
      if (!this.isSetupOpen && this.driver.activePageCount() === 0 && this.solOperations.size === 0) {
        await this.driver.close().catch(() => {});
      }
      if (!this.driver.isRunning()) {
        this.lockManager.release();
      }
    }
  }

  /** Close the browser page associated with a repository (L). Scoped to that repository only. */
  async closeRepositoryPage(repositoryId: string): Promise<void> {
    try {
      await this.driver.closePage(repositoryId);
    } catch (err) {
      console.warn("[BrowserManager] Failed to close repository page:", err);
    }
    // Do not affect other repositories' pages
    if (!this.isSetupOpen && this.driver.activePageCount() === 0 && this.solOperations.size === 0) {
      await this.driver.close().catch(() => {});
      this.lockManager.release();
    }
  }

  /**
   * FIX #9: Mark Sol operation complete for a repository when expected Git transition arrives.
   * Called by LoopService.onDispatchDetected / onControlDetected. Correlated to run/iteration
   * via the stored SolOperationRecord; if runId mismatches, no-op (stale).
   * Closes only that repository's page; if no active Sol pages remain, closes Chromium.
   */
  async completeSolOperation(repositoryId: string, runId?: string): Promise<void> {
    const op = this.solOperations.get(repositoryId);
    if (!op) return;
    if (runId && op.runId !== runId) return; // correlated to correct run only

    // Clear timeout handle for this repository
    const handle = this.solTimeoutHandles.get(repositoryId);
    if (handle) {
      clearTimeout(handle);
      this.solTimeoutHandles.delete(repositoryId);
    }
    this.solOperations.delete(repositoryId);

    await this.closeRepositoryPage(repositoryId);
  }

  /**
   * FIX #9: Check for Sol operation timeouts. Used by fake-clock tests and by real timer callback.
   * If no expected Git transition before deadline, retry once idempotently; if still no transition, SOL_STALLED.
   * Scoped per repository; one repo's stall never closes unrelated pages.
   */
  async checkSolTimeouts(nowMs: number = Date.now()): Promise<void> {
    const stalled: SolOperationRecord[] = [];
    for (const [repoId, op] of this.solOperations.entries()) {
      if (nowMs >= op.deadline) {
        if (op.retryCount < 1) {
          // Retry once idempotently: resubmit same wake intent via page resend
          op.retryCount += 1;
          op.deadline = nowMs + this.solTimeoutMs;
          // Reschedule timeout handle
          this.scheduleSolTimeout(repoId, op);
          try {
            await this.retrySolWake(op);
          } catch (e: any) {
            // Retry failed -> will be caught on next deadline check as stall
            console.warn(`[BrowserManager] Sol retry failed for ${repoId}:`, e?.message || String(e));
          }
        } else {
          stalled.push(op);
        }
      }
    }
    for (const op of stalled) {
      const handle = this.solTimeoutHandles.get(op.repositoryId);
      if (handle) {
        clearTimeout(handle);
        this.solTimeoutHandles.delete(op.repositoryId);
      }
      this.solOperations.delete(op.repositoryId);
      const errorMessage = `Sol operation timed out after ${this.solTimeoutMs}ms and one retry with no dispatch or control transition (SOL_STALLED)`;
      // Update wake record if still submitted
      try {
        const wake = this.wakeStore.get(op.wakeId);
        if (wake && wake.status === "submitted") {
          this.wakeStore.updateStatus(op.wakeId, "failed", { errorMessage });
        }
      } catch {}
      // Notify loop to mark run SOL_STALLED
      if (this.onSolStalled) {
        try {
          await this.onSolStalled(op.repositoryId, op.runId, errorMessage);
        } catch {}
      }
      // Close only that repository's page
      await this.closeRepositoryPage(op.repositoryId);
    }
  }

  /** For tests: expose pending operations */
  getSolOperations(): Map<string, SolOperationRecord> {
    return new Map(this.solOperations);
  }

  /** For tests: inject fake time without real timeout */
  getSolTimeoutMs(): number {
    return this.solTimeoutMs;
  }

  async getProvisioningStatus(): Promise<ChromiumStatus> {
    return getChromiumStatus();
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
    // Clear all pending Sol timeouts
    for (const h of this.solTimeoutHandles.values()) clearTimeout(h);
    this.solTimeoutHandles.clear();
    this.solOperations.clear();
    try {
      if (this.driver.isRunning()) {
        await this.driver.close();
      }
    } finally {
      this.lockManager.release();
      this.isSetupOpen = false;
    }
  }

  private registerSolOperation(
    repositoryId: string,
    params: {
      runId: string;
      iteration: number;
      wakeId: string;
      submittedAt: string;
      conversationUrl: string;
      repositoryName: string;
      dispatchId: string | null;
      resultStatus: SolWakeResultStatus;
    }
  ): void {
    const deadline = Date.now() + this.solTimeoutMs;
    const record: SolOperationRecord = {
      repositoryId,
      runId: params.runId,
      iteration: params.iteration,
      wakeId: params.wakeId,
      submittedAt: params.submittedAt,
      deadline,
      retryCount: 0,
      conversationUrl: params.conversationUrl,
      repositoryName: params.repositoryName,
      dispatchId: params.dispatchId,
      resultStatus: params.resultStatus
    };
    // Clear existing handle for this repo if any
    const existingHandle = this.solTimeoutHandles.get(repositoryId);
    if (existingHandle) clearTimeout(existingHandle);
    this.solOperations.set(repositoryId, record);
    this.scheduleSolTimeout(repositoryId, record);
  }

  private scheduleSolTimeout(repositoryId: string, op: SolOperationRecord): void {
    const delay = Math.max(0, op.deadline - Date.now());
    const handle = setTimeout(() => {
      void this.checkSolTimeouts(Date.now());
    }, delay);
    // Allow process to exit without waiting for Sol timeout.
    if ((handle as any).unref) (handle as any).unref();
    this.solTimeoutHandles.set(repositoryId, handle);
  }

  private async retrySolWake(op: SolOperationRecord): Promise<void> {
    // Idempotent retry: reuse same message; re-open page if needed and resubmit
    const message = generateSolWakeMessage({
      repositoryName: op.repositoryName,
      runId: op.runId,
      iteration: op.iteration,
      dispatchId: op.dispatchId || "none",
      resultStatus: op.resultStatus
    });
    if (!this.driver.isRunning()) {
      // Re-acquire lock if needed
      if (!this.lockManager.acquire("AUTOMATED")) {
        throw new Error("Cannot retry Sol wake: profile locked");
      }
      await this.driver.launch(this.profileDir, true);
    }
    const page = await this.driver.openPage(op.repositoryId, op.conversationUrl);
    await this.submitter.submitWake(page, message);
    const now = new Date().toISOString();
    this.wakeStore.updateStatus(op.wakeId, "submitted", { submittedAt: now });
    op.submittedAt = now;
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

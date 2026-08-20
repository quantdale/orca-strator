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
import {
  type SolOperationRecord,
  type SolOperationStore,
  MemorySolOperationStore
} from "./sol-operation-store.js";
import { getChromiumStatus, type ChromiumStatus } from "./provisioning.js";

export interface BrowserManagerOptions {
  dataDir: string;
  driver?: BrowserDriver;
  wakeStore: SolWakeStore;
  /** Durable Sol-operation store. If omitted, an in-memory fallback is used (no restart durability). */
  solOperationStore?: SolOperationStore;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
  solTimeoutMs?: number;
  onSolStalled?: (repositoryId: string, runId: string, errorMessage: string) => void | Promise<void>;
}

/** Backpressure budget before a wake is reported busy/queued (L). */
const WAKE_LOCK_RETRIES = 5;
const WAKE_LOCK_RETRY_MS = 1500;
export const DEFAULT_SOL_TIMEOUT_MS = 20 * 60 * 1000;
/** Bounded BUSY backpressure before a wake is reported SOL_STALLED (L, item #3). */
export const BUSY_MAX_RETRIES = 3;
export const BUSY_RETRY_MS = 3500;

export class BrowserManager {
  private readonly profileDir: string;
  private readonly lockManager: ProfileLockManager;
  private readonly driver: BrowserDriver;
  private readonly wakeStore: SolWakeStore;
  private readonly solStore: SolOperationStore;
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
    this.solStore = options.solOperationStore || new MemorySolOperationStore();
    this.submitter = new SolWakeSubmitter();
    this.eventPublisher = options.eventPublisher;
    this.solTimeoutMs = options.solTimeoutMs ?? DEFAULT_SOL_TIMEOUT_MS;
    this.onSolStalled = options.onSolStalled;
  }

  setSolStalledHandler(handler: (repositoryId: string, runId: string, errorMessage: string) => void | Promise<void>): void {
    this.onSolStalled = handler;
  }

  /** Read the durable Sol operation for a repository (exact intent + retry budgets). */
  getActiveOperation(repositoryId: string): SolOperationRecord | null {
    return this.solStore.get(repositoryId);
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
   *
   * The exact wake intent (repositoryName, runId, iteration, dispatchId, resultStatus,
   * conversationUrl, message) is persisted durably in the Sol-operation store so a
   * controller restart reproduces the SAME wake intent instead of reconstructing it
   * (item #1). BUSY backpressure and timeout retry budgets are also persisted (item #3).
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
    const now = new Date().toISOString();
    const nowMs = Date.now();

    const message = generateSolWakeMessage({
      repositoryName: params.repositoryName,
      runId: params.runId,
      iteration: params.iteration,
      dispatchId: params.dispatchId || "none",
      resultStatus: params.resultStatus
    });

    // Reuse the existing active Sol operation for the SAME wake intent (same run + message),
    // otherwise create a fresh durable operation. This keeps one wake intent per repo
    // and makes re-submission (busy retry / restart) byte-for-byte identical.
    let op = this.solStore.get(repositoryId);
    if (!op || op.runId !== params.runId || op.message !== message || op.status !== "active") {
      const wakeId = crypto.randomUUID();
      const newOp: SolOperationRecord = {
        repositoryId,
        runId: params.runId,
        iteration: params.iteration,
        wakeId,
        dispatchId: params.dispatchId ?? null,
        conversationUrl: params.conversationUrl,
        repositoryName: params.repositoryName,
        resultStatus: params.resultStatus,
        message,
        submittedAt: null,
        deadline: nowMs + this.solTimeoutMs,
        timeoutRetryCount: 0,
        busyRetryCount: 0,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      this.solStore.upsert(newOp);
      this.wakeStore.create({
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
      });
      this.registerSolOperation(newOp);
      op = newOp;
    } else {
      // Re-using an existing active operation: keep its wake record, ensure it is active.
      this.solStore.update(repositoryId, { status: "active", updatedAt: now });
    }

    const wakeId = op.wakeId;

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

      // Persist the exact intent + reset BUSY budget on a real submit.
      this.solStore.update(repositoryId, {
        submittedAt,
        status: "active",
        busyRetryCount: 0,
        updatedAt: submittedAt
      });

      this.publishEvent({
        type: "repository.updated",
        at: submittedAt,
        repositoryId
      });

      this.registerSolOperation(this.solStore.get(repositoryId)!);

      return this.wakeStore.get(wakeId)!;
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      const isBusy = /BUSY/i.test(errorMessage);
      const needsAttention =
        /ATTENTION_REQUIRED|CHATGPT_AUTH_REQUIRED|verification|cloudflare|captcha|login required/i.test(errorMessage);
      if (isBusy) {
        // Bounded BUSY backpressure: persist the retry budget durably (item #3) so
        // controller restarts cannot reset the one-time BUSY budget. The loop owns
        // the retry scheduling and reads this durable counter.
        const count = (op.busyRetryCount ?? 0) + 1;
        this.solStore.update(repositoryId, { busyRetryCount: count, status: "active", updatedAt: now });
        this.wakeStore.updateStatus(wakeId, "busy", { errorMessage });
        // Reconstruct in-memory operation so resume/retry sees the durable state.
        this.registerSolOperation(this.solStore.get(repositoryId)!);
        return this.wakeStore.get(wakeId)!;
      }
      this.wakeStore.updateStatus(wakeId, "failed", { errorMessage });
      this.solStore.update(repositoryId, { status: "stalled", updatedAt: now });
      // Persist so rehydrate does not resurrect a failed operation.
      this.registerSolOperation(this.solStore.get(repositoryId)!);
      throw new Error(needsAttention ? `ATTENTION_REQUIRED: ${errorMessage}` : errorMessage);
    } finally {
      // Do NOT close Chromium here based on activePageCount ==0 check that would race with kept-alive pages.
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
   * Mark Sol operation complete for a repository when expected Git transition arrives.
   * Called by LoopService.onDispatchDetected / onControlDetected. Correlated to run/iteration
   * and expected transition iteration (not just runId) where available.
   */
  async completeSolOperation(repositoryId: string, runId?: string, expectedIteration?: number): Promise<void> {
    const op = this.solOperations.get(repositoryId);
    if (!op) return;
    if (runId && op.runId !== runId) return;
    if (expectedIteration !== undefined && op.iteration + 1 !== expectedIteration) return;

    const handle = this.solTimeoutHandles.get(repositoryId);
    if (handle) {
      clearTimeout(handle);
      this.solTimeoutHandles.delete(repositoryId);
    }
    this.solOperations.delete(repositoryId);
    this.solStore.update(repositoryId, { status: "completed" });
    try {
      this.solStore.delete(repositoryId);
    } catch {}

    await this.closeRepositoryPage(repositoryId);
  }

  /**
   * Check for Sol operation timeouts. Used by fake-clock tests and by real timer callback.
   * If no expected Git transition before deadline, retry once idempotently (budget persisted
   * durably, item #1/#3); if still no transition, SOL_STALLED. Scoped per repository; one
   * repo's stall never closes unrelated pages. BUSY operations are owned by the loop's BUSY
   * backpressure and are skipped here.
   */
  async checkSolTimeouts(nowMs: number = Date.now()): Promise<void> {
    for (const [repoId, op] of this.solOperations.entries()) {
      if (op.status === "stalled" || op.status === "completed") continue;
      const wake = this.wakeStore.get(op.wakeId);
      // BUSY operations are retried by the loop's backpressure, not the SOL timeout.
      if (wake && wake.status === "busy") continue;

      if (nowMs >= op.deadline) {
        if (op.timeoutRetryCount < 1) {
          op.timeoutRetryCount += 1;
          op.deadline = nowMs + this.solTimeoutMs;
          this.solStore.update(repoId, {
            timeoutRetryCount: op.timeoutRetryCount,
            deadline: op.deadline,
            updatedAt: new Date().toISOString()
          });
          this.scheduleSolTimeout(repoId, op);
          try {
            await this.retrySolWake(op);
          } catch (e: any) {
            console.warn(`[BrowserManager] Sol retry failed for ${repoId}:`, e?.message || String(e));
          }
        } else {
          await this.stallSolOperation(repoId, op, "Sol operation timed out after one retry with no dispatch or control transition (SOL_STALLED)");
        }
      }
    }
  }

  private async stallSolOperation(repoId: string, op: SolOperationRecord, errorMessage: string): Promise<void> {
    const handle = this.solTimeoutHandles.get(repoId);
    if (handle) {
      clearTimeout(handle);
      this.solTimeoutHandles.delete(repoId);
    }
    this.solOperations.delete(repoId);
    this.solStore.update(repoId, { status: "stalled", updatedAt: new Date().toISOString() });
    try {
      const wake = this.wakeStore.get(op.wakeId);
      if (wake && wake.status === "submitted") {
        this.wakeStore.updateStatus(op.wakeId, "failed", { errorMessage });
      }
    } catch {}
    if (this.onSolStalled) {
      try {
        await this.onSolStalled(op.repositoryId, op.runId, errorMessage);
      } catch {}
    }
    await this.closeRepositoryPage(op.repositoryId);
  }

  /** For tests: expose pending operations */
  getSolOperations(): Map<string, SolOperationRecord> {
    return new Map(this.solOperations);
  }

  /**
   * Rehydrate SOL_REVIEWING / pending Sol operations after restart (items #1/#3).
   * Reads the EXACT durable intent from the Sol-operation store — never guesses
   * resultStatus, repositoryName, iteration, deadline, or retry budgets. A restart
   * reproduces the same wake intent so COMPLETED stays COMPLETED, never INITIAL.
   */
  async rehydrateFromStore(
    runStore: { getActiveRun: (repoId: string) => any; getByRepository?: (repoId: string) => any },
    opts?: { repoIds?: string[] }
  ): Promise<void> {
    const activeOps = this.solStore.listActive();
    const repoIds = opts?.repoIds ?? activeOps.map((o) => o.repositoryId);

    for (const repoId of repoIds) {
      const op = this.solStore.get(repoId);
      if (!op || op.status !== "active") continue;

      const run = runStore.getActiveRun(repoId);
      // Only resume operations that belong to an active run still awaiting Sol.
      if (!run || (run.status !== "SOL_REVIEWING" && run.status !== "SOL_PENDING")) continue;
      if (this.solOperations.has(repoId)) continue;

      const wake = this.wakeStore.get(op.wakeId);
      const nowMs = Date.now();
      const isBusy = wake && wake.status === "busy";

      if (isBusy) {
        // BUSY backpressure is resumed by the loop's rehydrateBusyBackpressure using the
        // durable busyRetryCount. Just keep the operation in memory so correlation works.
        this.solOperations.set(repoId, { ...op });
        continue;
      }

      if (nowMs >= op.deadline) {
        if (op.timeoutRetryCount < 1) {
          // Exactly one permitted timeout retry (budget persisted durably).
          const newDeadline = nowMs + this.solTimeoutMs;
          this.solStore.update(repoId, {
            timeoutRetryCount: op.timeoutRetryCount + 1,
            deadline: newDeadline,
            updatedAt: new Date().toISOString()
          });
          this.solOperations.set(repoId, { ...op, timeoutRetryCount: op.timeoutRetryCount + 1, deadline: newDeadline });
          this.scheduleSolTimeout(repoId, this.solOperations.get(repoId)!);
          try {
            await this.retrySolWake(this.solOperations.get(repoId)!);
          } catch {
            // Retry failed; will be caught on next deadline check as stall.
            const curOp = this.solStore.get(repoId);
            if (curOp && nowMs >= curOp.deadline) {
              await this.stallSolOperation(repoId, curOp, "Sol operation timed out after restart (retry failed) – SOL_STALLED");
            }
          }
        } else {
          // Both deadlines passed with no transition -> SOL_STALLED (do not resurrect).
          await this.stallSolOperation(repoId, op, "Sol operation timed out after restart (no retry window) – SOL_STALLED");
        }
        continue;
      }

      // Within first deadline: resume waiting with the EXACT persisted intent.
      this.solOperations.set(repoId, { ...op });
      this.scheduleSolTimeout(repoId, this.solOperations.get(repoId)!);
    }
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

  private registerSolOperation(op: SolOperationRecord): void {
    // Clear existing handle for this repo if any
    const existingHandle = this.solTimeoutHandles.get(op.repositoryId);
    if (existingHandle) clearTimeout(existingHandle);
    this.solOperations.set(op.repositoryId, op);
    if (op.status === "active") {
      this.scheduleSolTimeout(op.repositoryId, op);
    }
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
    const message = op.message;
    if (!this.driver.isRunning()) {
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

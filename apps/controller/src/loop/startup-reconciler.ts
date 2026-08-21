import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "./run-store.js";
import type { LoopService } from "./loop-service.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { ExecutorStore } from "../executor/executor-store.js";

export interface ReconcileResult {
  reconciledCount: number;
  recoveryRequiredCount: number;
  /** executor_runs rows found still 'running'/'pending' at boot with no live process; marked failed. */
  orphanedExecutorRuns: number;
}

export class StartupReconciler {
  constructor(
    private readonly repoStore: RepositoryStore,
    private readonly runStore: RunStore,
    private readonly loopService: LoopService,
    private readonly browserManager?: BrowserManager | null,
    // Optional so existing three/four-argument wiring keeps compiling until
    // app.ts passes its executor store in.
    private readonly executorStore?: ExecutorStore | null
  ) {}

  async reconcile(): Promise<ReconcileResult> {
    const repos = this.repoStore.list();
    let reconciledCount = 0;
    let recoveryRequiredCount = 0;
    let orphanedExecutorRuns = 0;

    // Re-arm wall-clock ceilings and drain mirrors from persisted drainReason (Fix #4)
    try { this.loopService.rehydrateWallClockCeilings(); } catch {}

    // Rehydrate SOL_REVIEWING operations before handling per-run decisions (Fix #5)
    if (this.browserManager) {
      try {
        await this.browserManager.rehydrateFromStore(this.runStore as any, { repoIds: repos.map(r=>r.id) });
      } catch (e) {
        console.warn("[StartupReconciler] rehydrateFromStore failed:", (e as any)?.message || String(e));
      }
      // Resume BUSY backpressure scheduling using the durable retry budget (item #3)
      try {
        this.loopService.rehydrateBusyBackpressure();
      } catch (e) {
        console.warn("[StartupReconciler] rehydrateBusyBackpressure failed:", (e as any)?.message || String(e));
      }
    }

    for (const repo of repos) {
      // Orphaned executor attempts truth repair: when the controller dies
      // abnormally, executor_runs rows can survive as 'running'/'pending' even
      // though no process exists anymore. Leaving them active lets a restarted
      // controller observe two writers on one working tree, so they are marked
      // 'failed' (the truthful terminal status in the ExecutorRunStatus union;
      // there is no distinct 'orphaned' value) with the cause recorded. No OS
      // process killing happens here by design: there is no safe startup helper
      // that could identify or terminate the previous process tree.
      if (this.executorStore) {
        for (const stale of this.executorStore.getByRepository(repo.id)) {
          if (stale.status !== "running" && stale.status !== "pending") continue;
          this.executorStore.updateStatus(stale.id, "failed", {
            errorMessage:
              "Orphaned by controller restart: executor run was still marked " +
              `${stale.status} but no live process existed at startup reconciliation. ` +
              "Marked failed to prevent two writers to one working tree.",
            finishedAt: new Date().toISOString()
          });
          orphanedExecutorRuns++;
        }
      }

      const activeRun = this.runStore.getActiveRun(repo.id);
      if (!activeRun) continue;

      reconciledCount++;

      if (activeRun.status === "EXECUTING" || activeRun.status === "EXECUTOR_PENDING") {
        this.runStore.updateStatus(activeRun.id, "RECOVERY_REQUIRED", {
          lastError: "Controller process restarted while executor turn was in progress. Manual recovery required."
        });
        recoveryRequiredCount++;
      } else if (activeRun.status === "SOL_PENDING") {
        await this.loopService.resubmitPendingWake(repo.id, activeRun).catch((err) => {
          console.warn("[StartupReconciler] Failed to resubmit pending wake:", err);
        });
      } else if (activeRun.status === "DRAINING") {
        // If wall-clock already expired at startup, ensure DRAINING persists without killing actor
        // (rehydrateWallClockCeilings already armed timer / entered DRAINING if needed)
      }
      // SOL_REVIEWING rehydrated via BrowserManager; PAUSED requires explicit user action.
    }

    return { reconciledCount, recoveryRequiredCount, orphanedExecutorRuns };
  }
}

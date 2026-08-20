import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "./run-store.js";
import type { LoopService } from "./loop-service.js";
import type { BrowserManager } from "../browser/browser-manager.js";

export class StartupReconciler {
  constructor(
    private readonly repoStore: RepositoryStore,
    private readonly runStore: RunStore,
    private readonly loopService: LoopService,
    private readonly browserManager?: BrowserManager | null
  ) {}

  async reconcile(): Promise<{ reconciledCount: number; recoveryRequiredCount: number }> {
    const repos = this.repoStore.list();
    let reconciledCount = 0;
    let recoveryRequiredCount = 0;

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

    return { reconciledCount, recoveryRequiredCount };
  }
}

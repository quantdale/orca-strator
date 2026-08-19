import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "./run-store.js";
import type { LoopService } from "./loop-service.js";

export class StartupReconciler {
  constructor(
    private readonly repoStore: RepositoryStore,
    private readonly runStore: RunStore,
    private readonly loopService: LoopService
  ) {}

  async reconcile(): Promise<{ reconciledCount: number; recoveryRequiredCount: number }> {
    const repos = this.repoStore.list();
    let reconciledCount = 0;
    let recoveryRequiredCount = 0;

    for (const repo of repos) {
      const activeRun = this.runStore.getActiveRun(repo.id);
      if (!activeRun) continue;

      reconciledCount++;

      if (activeRun.status === "EXECUTING" || activeRun.status === "EXECUTOR_PENDING") {
        // M: executor turn interrupted by controller/process loss. Preserve the
        // dirty checkout; require an explicit Resume/recovery rather than silently
        // restarting or creating a duplicate run.
        this.runStore.updateStatus(activeRun.id, "RECOVERY_REQUIRED", {
          lastError: "Controller process restarted while executor turn was in progress. Manual recovery required."
        });
        recoveryRequiredCount++;
      } else if (activeRun.status === "SOL_PENDING") {
        // Resubmit the pending Sol wake idempotently. This MUST NOT recreate the
        // run (the old code called startRun() against the already-active run and
        // silently failed). The loop rehydrates the existing run.
        await this.loopService.resubmitPendingWake(repo.id, activeRun).catch((err) => {
          console.warn("[StartupReconciler] Failed to resubmit pending wake:", err);
        });
      }
      // SOL_REVIEWING and PAUSED resolve naturally or via explicit user action.
    }

    return { reconciledCount, recoveryRequiredCount };
  }
}

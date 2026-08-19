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
        this.runStore.updateStatus(activeRun.id, "RECOVERY_REQUIRED", {
          lastError: "Controller process restarted while executor turn was in progress. Manual recovery required."
        });
        recoveryRequiredCount++;
      } else if (activeRun.status === "SOL_PENDING") {
        // Resubmit wake
        await this.loopService.startRun(repo.id, {
          goal: activeRun.goal,
          maxIterations: activeRun.maxIterations
        }).catch(() => {});
      }
      // If SOL_REVIEWING or PAUSED, it resumes naturally
    }

    return { reconciledCount, recoveryRequiredCount };
  }
}

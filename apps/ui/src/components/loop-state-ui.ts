import type { LoopState } from "@orca/shared";

/**
 * Loop states where the run cannot progress without user intervention
 * (UI-UX spec §17 error presentation).
 */
export const PROBLEM_LOOP_STATES: ReadonlySet<LoopState> = new Set<LoopState>([
  "SOL_STALLED",
  "BLOCKED",
  "NEEDS_HUMAN",
  "EXECUTOR_UNAVAILABLE",
  "RECOVERY_REQUIRED",
  "ATTENTION_REQUIRED"
]);

export function isProblemLoopState(state: LoopState): boolean {
  return PROBLEM_LOOP_STATES.has(state);
}

/**
 * Tailwind tone classes for a loop-state badge, reusing the environment-badge
 * palette already used across the dashboard.
 */
export function loopStateBadgeClasses(state: LoopState): string {
  if (isProblemLoopState(state)) {
    return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
  }
  switch (state) {
    case "SOL_PENDING":
    case "SOL_REVIEWING":
      return "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20";
    case "EXECUTOR_PENDING":
    case "EXECUTING":
      return "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20";
    case "GOAL_COMPLETE":
      return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    case "PAUSED":
    case "CEILING_REACHED":
      return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    default:
      // IDLE, STOPPED, DRAINING
      return "bg-slate-800 text-slate-300 border border-slate-700";
  }
}

/** Suggested manual next action shown on the failure card (UI-UX spec §17). */
export function problemNextAction(state: LoopState): string {
  switch (state) {
    case "SOL_STALLED":
      return "Inspect the Sol conversation/browser, then use Wake Sol to retry the wake.";
    case "BLOCKED":
      return "Review the blocker in recent activity, then Retry Turn or mark complete.";
    case "NEEDS_HUMAN":
      return "Intervene manually, then use Retry Turn to resume the run.";
    case "EXECUTOR_UNAVAILABLE":
      return "Verify the executor CLI/model works locally, then Retry Turn.";
    case "RECOVERY_REQUIRED":
      return "Use Retry Turn to recover, or Stop Run to end gracefully.";
    default:
      return "Inspect recent activity, then Retry Turn or Stop Run.";
  }
}

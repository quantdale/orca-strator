export interface BootstrapPromptParams {
  repositoryName: string;
  dispatchId: string;
  changePath: string;
  goal: string;
  iteration: number;
  /** Resume an interrupted dispatch: instruct the executor to preserve partial work. */
  recovery?: boolean;
}

export function generateBootstrapPrompt(params: BootstrapPromptParams): string {
  const recoveryNote = params.recovery
    ? `\nThis is a RESUME of an interrupted dispatch. Inspect and preserve any existing partial work on main; do not discard it. Continue and complete the remaining tasks.`
    : "";
  return [
    `Orca-Strator autonomous executor turn for ${params.repositoryName}.`,
    `Dispatch ID: ${params.dispatchId} (Iteration ${params.iteration})`,
    `Work Target: ${params.changePath}`,
    `Goal: ${params.goal}`,
    ``,
    `Instructions:`,
    `1. Read AGENTS.md, .agent/state.json, and repository instructions.`,
    `2. Read .orca/dispatch/${params.dispatchId}.json and the change artifacts in ${params.changePath}.`,
    `3. Preserve and reconcile existing work on main.`,
    `4. Implement the requested tasks and run relevant verification.`,
    `5. Commit and push intended work to main.`,
    `6. Write the final isolated result manifest at .orca/results/${params.dispatchId}.json and push it.`,
    `7. Exit with truthful status.`,
    recoveryNote
  ].join("\n");
}

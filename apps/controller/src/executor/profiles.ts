/**
 * Executor invocation profiles.
 *
 * Finding D: the previous code assumed every executor was
 *   <cli> --model <model> "<prompt>"
 * That is wrong for real harnesses (Kimi Code CLI, Codex CLI, etc.) and it let a
 * later step dynamically route the model. The user is the only authority that
 * selects executor/model, so profiles only describe HOW a given harness expects
 * its arguments; they never choose the model.
 *
 * A profile is resolved from the configured executorCli string. To add a new
 * harness, register it in PROFILES; nothing else needs to change.
 */

export type ExecutorProfileId = "kimi" | "codex" | "generic" | "test";

export interface ExecutorInvocation {
  /** Executable to spawn (the resolved cli, possibly a script path). */
  command: string;
  /** Argument array passed to the executable (no shell interpolation). */
  args: string[];
}

export interface BuildInvocationParams {
  cli: string;
  model: string;
  prompt: string;
}

export function resolveProfile(cli: string): ExecutorProfileId {
  const normalized = cli.toLowerCase();
  if (normalized.includes("orca-test-harness")) return "test";
  if (normalized.includes("kimi")) return "kimi";
  if (normalized.includes("codex")) return "codex";
  return "generic";
}

/**
 * Building block for the deterministic "test" harness used by the real
 * qualification tier. The harness path comes from the environment so the
 * controller never guesses where the test fixture lives; it is only used by the
 * qualification tests, never in production.
 */
export function buildTestInvocation(_params: BuildInvocationParams): ExecutorInvocation {
  const harnessPath = process.env.ORCA_TEST_EXECUTOR_HARNESS;
  if (!harnessPath) {
    throw new Error(
      "ORCA_TEST_EXECUTOR_HARNESS is not set; cannot build a test executor invocation."
    );
  }
  // Spawn Node directly against the harness script with no shell interpolation.
  return {
    command: process.execPath,
    args: [harnessPath]
  };
}

function buildKimiInvocation(params: BuildInvocationParams): ExecutorInvocation {
  // Kimi Code CLI convention (verify against installed `--help`):
  //   kimi-code --model <model> --prompt "<prompt>"
  return {
    command: params.cli,
    args: ["--model", params.model, "--prompt", params.prompt]
  };
}

function buildCodexInvocation(params: BuildInvocationParams): ExecutorInvocation {
  // Codex CLI convention (verify against installed `--help`):
  //   codex --model <model> "<prompt>"
  return {
    command: params.cli,
    args: ["--model", params.model, params.prompt]
  };
}

function buildGenericInvocation(params: BuildInvocationParams): ExecutorInvocation {
  // Fallback for custom harnesses. Passes model + prompt as positional args and
  // lets the harness read dispatch/run identity from ORCA_* environment vars.
  return {
    command: params.cli,
    args: ["--model", params.model, params.prompt]
  };
}

const PROFILES: Record<ExecutorProfileId, (p: BuildInvocationParams) => ExecutorInvocation> = {
  kimi: buildKimiInvocation,
  codex: buildCodexInvocation,
  generic: buildGenericInvocation,
  test: buildTestInvocation
};

export function buildExecutorInvocation(
  profile: ExecutorProfileId,
  params: BuildInvocationParams
): ExecutorInvocation {
  return PROFILES[profile](params);
}

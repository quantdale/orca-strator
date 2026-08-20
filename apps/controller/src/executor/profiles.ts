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

export type ExecutorProfileId = "kimi" | "codex" | "generic" | "test" | "swarm-test" | "opencode";

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
  /** Repository environment; lets the deterministic harness run under WSL (Q/C). */
  environment?: "windows" | "wsl";
}

export function resolveProfile(cli: string): ExecutorProfileId {
  const normalized = cli.toLowerCase();
  if (normalized.includes("orca-swarm-test-harness")) return "swarm-test";
  if (normalized.includes("orca-test-harness")) return "test";
  if (normalized.includes("kimi")) return "kimi";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("opencode")) return "opencode";
  return "generic";
}

import { toWslPath } from "../wsl-path.js";

/**
 * Building block for the deterministic "test" harness used by the real
 * qualification tier. The harness path comes from the environment so the
 * controller never guesses where the test fixture lives; it is only used by the
 * qualification tests, never in production.
 */
export function buildTestInvocation(params: BuildInvocationParams): ExecutorInvocation {
  const harnessPath = process.env.ORCA_TEST_EXECUTOR_HARNESS;
  if (!harnessPath) {
    throw new Error(
      "ORCA_TEST_EXECUTOR_HARNESS is not set; cannot build a test executor invocation."
    );
  }
  // Under WSL the harness must run with the Linux node and a Linux mount path
  // (Finding C). On Windows we spawn the host Node directly. No shell interpolation.
  if (params.environment === "wsl") {
    return {
      command: "node",
      args: [toWslPath(harnessPath)]
    };
  }
  return {
    command: process.execPath,
    args: [harnessPath]
  };
}

/** Deterministic worker-only harness used by the real swarm qualification tier. */
export function buildSwarmTestInvocation(params: BuildInvocationParams): ExecutorInvocation {
  const harnessPath = process.env.ORCA_SWARM_TEST_HARNESS;
  if (!harnessPath) {
    throw new Error(
      "ORCA_SWARM_TEST_HARNESS is not set; cannot build a swarm test invocation."
    );
  }
  if (params.environment === "wsl") {
    return { command: "node", args: [toWslPath(harnessPath)] };
  }
  return { command: process.execPath, args: [harnessPath] };
}

function buildKimiInvocation(params: BuildInvocationParams): ExecutorInvocation {
  // Kimi Code CLI verified (--help 0.34.0): `kimi -m <model> -p "<prompt>"` (also --model)
  // Use -p for prompt (documented non-interactive mode).
  return {
    command: params.cli,
    args: ["-m", params.model, "-p", params.prompt]
  };
}

function buildCodexInvocation(params: BuildInvocationParams): ExecutorInvocation {
  // Codex CLI verified (0.147.0): `codex exec -m <model> -C <dir> [--json] "<prompt>"`
  // Non-interactive exec subcommand; --cd is -C. Do not burn quota in qualification; syntax only.
  return {
    command: params.cli,
    args: ["exec", "-m", params.model, "--json", params.prompt]
  };
}

function buildOpenCodeInvocation(params: BuildInvocationParams): ExecutorInvocation {
  // OpenCode's documented headless CLI is `opencode run --model <provider/model> <message>`.
  // The model remains user-owned; this profile only describes invocation shape.
  return {
    command: params.cli,
    args: ["run", "--model", params.model, params.prompt]
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
  opencode: buildOpenCodeInvocation,
  generic: buildGenericInvocation,
  test: buildTestInvocation,
  "swarm-test": buildSwarmTestInvocation
};

export function buildExecutorInvocation(
  profile: ExecutorProfileId,
  params: BuildInvocationParams
): ExecutorInvocation {
  return PROFILES[profile](params);
}

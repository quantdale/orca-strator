/**
 * Deterministic real-executor harness for the qualification tier.
 *
 * This is NOT a mock. It is a real child process spawned exactly like a production
 * executor (same ORCA_* environment contract, same Git working tree, same result
 * manifest schema). It performs real Git commits and pushes so the watcher/loop
 * pipeline can be qualified end-to-end without burning inference.
 *
 * It reads dispatch identity from the same ORCA_* environment variables the
 * production ExecutorRunner injects, then:
 *   1. reconciles the local clone with origin/main (the clone's local main may lag
 *      the bare remote after the watcher's fetch-only step);
 *   2. writes a partial artifact at .orca/work/<dispatchId>.partial.txt if ORCA_SLOW_MS;
 *   3. sleeps ORCA_SLOW_MS (deterministic slow mode, no AI inference);
 *   4. writes a real work artifact and commits it (this is `resultSha`);
 *   5. writes a VALID ExecutorResult manifest at .orca/results/<dispatchId>.json;
 *   6. commits and pushes the result to main.
 *
 * Slow / status / exit overrides (env):
 *   ORCA_SLOW_MS            number ms to sleep before doing real work (default 0)
 *   ORCA_HARNESS_STATUS     COMPLETED|BLOCKED|NEEDS_HUMAN|FAILED override
 *   ORCA_HARNESS_EXIT_CODE  numeric exit code override (nonzero preserves manifest)
 *
 * On a real repository the coding CLI would do the work; here the harness performs
 * a harmless equivalent so qualification can prove the contract.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

function git(args) {
  execFileSync("git", args, { cwd: process.cwd(), stdio: "inherit" });
}

function sha(ref) {
  return execFileSync("git", ["rev-parse", ref], { cwd: process.cwd() })
    .toString()
    .trim();
}

function sleepSync(ms) {
  if (!ms || ms <= 0) return;
  // Block synchronously without inference; keeps executor child alive so pause/kill/ceiling tests work.
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait capped to 4s harness: this is the qualification helper only.
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const runId = process.env.ORCA_RUN_ID;
  const dispatchId = process.env.ORCA_DISPATCH_ID;
  const iteration = parseInt(process.env.ORCA_ITERATION || "1", 10);
  const model = process.env.ORCA_EXECUTOR_MODEL || "test-model";
  const environment = process.env.ORCA_ENVIRONMENT || "windows";
  const slowMs = parseInt(process.env.ORCA_SLOW_MS || "0", 10) || 0;
  const harnessStatus = (process.env.ORCA_HARNESS_STATUS || "COMPLETED").trim().toUpperCase();
  const exitCodeRaw = process.env.ORCA_HARNESS_EXIT_CODE;
  const exitCodeOverride = exitCodeRaw !== undefined && exitCodeRaw !== "" ? parseInt(exitCodeRaw, 10) : 0;

  const allowedStatus = new Set(["COMPLETED", "BLOCKED", "NEEDS_HUMAN", "FAILED"]);
  const resultStatus = allowedStatus.has(harnessStatus) ? harnessStatus : "COMPLETED";

  if (!runId || !dispatchId) {
    console.error("Missing ORCA_RUN_ID / ORCA_DISPATCH_ID");
    process.exit(2);
  }

  // 1. Reconcile with origin/main.
  try {
    git(["config", "user.email", "orca-harness@example.com"]);
    git(["config", "user.name", "Orca Test Harness"]);
    git(["config", "commit.gpgsign", "false"]);
    // Cross-environment (WSL mounted Windows tree) git may flag dubious ownership.
    git(["config", "--global", "--add", "safe.directory", "*"]);
    git(["fetch", "origin", "main"]);
    git(["rebase", "origin/main"]);
  } catch (err) {
    // Clone may already be aligned; treat rebase failure as non-fatal here.
    console.warn("reconcile warning:", err.message);
  }

  // 1b. Deterministic slow path: write partial artifact BEFORE sleeping to prove pause preserves work.
  if (slowMs > 0) {
    fs.mkdirSync(".orca/work", { recursive: true });
    fs.writeFileSync(
      `.orca/work/${dispatchId}.partial.txt`,
      `partial work for ${dispatchId} at ${new Date().toISOString()} run=${runId} iter=${iteration}\n`
    );
    // Do NOT commit partial; it must survive as working-tree evidence after pause.
    await sleep(slowMs);
  }

  // If this is a recovery resume, verify the partial still exists (contract proof).
  const partialPath = `.orca/work/${dispatchId}.partial.txt`;
  const isRecovery = process.env.ORCA_RECOVERY === "true" || process.env.ORCA_RECOVERY === "1";
  if (isRecovery && fs.existsSync(partialPath)) {
    fs.appendFileSync(partialPath, `recovery continue at ${new Date().toISOString()}\n`);
  }

  // 2. Real work commit.
  const baseSha = sha("HEAD");
  fs.mkdirSync(".orca/work", { recursive: true });
  fs.writeFileSync(`.orca/work/${dispatchId}.txt`, `work for ${dispatchId}\n`);
  git(["add", "-A"]);
  git(["commit", "-m", `feat(executor): work for ${dispatchId}`]);
  const workSha = sha("HEAD");

  // 3. Result manifest (valid ExecutorResult schema).
  const now = new Date().toISOString();
  const result = {
    schemaVersion: 1,
    type: "executor-result",
    runId,
    dispatchId,
    iteration,
    status: resultStatus,
    startedAt: now,
    finishedAt: now,
    baseSha,
    resultSha: workSha,
    executor: {
      cli: "orca-test-harness",
      model,
      environment
    },
    verification: [
      { name: "smoke", status: "PASS", summary: "Real work committed by harness." }
    ],
    blockers: resultStatus === "BLOCKED" ? [{ code: "E2E", summary: "Harness forced BLOCKED" }] : [],
    summary: `Deterministic harness ${resultStatus} for dispatch ${dispatchId}.`
  };
  fs.mkdirSync(".orca/results", { recursive: true });
  fs.writeFileSync(`.orca/results/${dispatchId}.json`, JSON.stringify(result, null, 2));

  // 4. Commit + push the result.
  git(["add", "-A"]);
  git(["commit", "-m", `chore(executor): result for ${dispatchId}`]);
  git(["push", "origin", "main"]);

  process.exit(Number.isFinite(exitCodeOverride) ? exitCodeOverride : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

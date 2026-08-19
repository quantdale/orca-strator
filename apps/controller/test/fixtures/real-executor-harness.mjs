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
 *   2. writes a real work artifact and commits it (this is `resultSha`);
 *   3. writes a VALID ExecutorResult manifest at .orca/results/<dispatchId>.json;
 *   4. commits and pushes the result to main.
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

function main() {
  const runId = process.env.ORCA_RUN_ID;
  const dispatchId = process.env.ORCA_DISPATCH_ID;
  const iteration = parseInt(process.env.ORCA_ITERATION || "1", 10);
  const model = process.env.ORCA_EXECUTOR_MODEL || "test-model";
  const environment = process.env.ORCA_ENVIRONMENT || "windows";

  if (!runId || !dispatchId) {
    console.error("Missing ORCA_RUN_ID / ORCA_DISPATCH_ID");
    process.exit(2);
  }

  // 1. Reconcile with origin/main.
  try {
    git(["config", "user.email", "orca-harness@example.com"]);
    git(["config", "user.name", "Orca Test Harness"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["fetch", "origin", "main"]);
    git(["rebase", "origin/main"]);
  } catch (err) {
    // Clone may already be aligned; treat rebase failure as non-fatal here.
    console.warn("reconcile warning:", err.message);
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
    status: "COMPLETED",
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
    blockers: [],
    summary: `Deterministic harness completed work for dispatch ${dispatchId}.`
  };
  fs.mkdirSync(".orca/results", { recursive: true });
  fs.writeFileSync(`.orca/results/${dispatchId}.json`, JSON.stringify(result, null, 2));

  // 4. Commit + push the result.
  git(["add", "-A"]);
  git(["commit", "-m", `chore(executor): result for ${dispatchId}`]);
  git(["push", "origin", "main"]);

  process.exit(0);
}

main();

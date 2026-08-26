import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE watcher_state (
  repository_id TEXT PRIMARY KEY,
  last_observed_sha TEXT,
  last_polled_at TEXT,
  last_error TEXT,
  updated_at TEXT
)`);
db.exec(`CREATE TABLE runs (
  id TEXT PRIMARY KEY, repository_id TEXT, goal TEXT, status TEXT,
  current_iteration INTEGER, max_iterations INTEGER,
  active_dispatch_id TEXT, last_error TEXT,
  started_at TEXT, finished_at TEXT, created_at TEXT, updated_at TEXT
)`);

function bench(name, fn, iters = 20000) {
  for (let i = 0; i < 100; i++) fn(i);
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn(i);
  const ms = performance.now() - t0;
  console.log(`${name}: ${ms.toFixed(1)}ms / ${iters} iters = ${(ms / iters).toFixed(4)}ms per op`);
}

// Pattern A: prepare on every call (current DispatchStore/RunStore style)
bench("prepare-per-call SELECT", (i) => {
  const stmt = db.prepare("SELECT * FROM watcher_state WHERE repository_id = ?");
  stmt.get("repo-" + i);
});

// Pattern B: cached prepared statement
const cachedGet = db.prepare("SELECT * FROM watcher_state WHERE repository_id = ?");
bench("cached-stmt SELECT", (i) => {
  cachedGet.get("repo-" + i);
});

// Pattern C: prepare-per-call UPDATE
bench("prepare-per-call UPDATE", (i) => {
  const stmt = db.prepare(
    "UPDATE watcher_state SET last_polled_at = ?, last_error = ?, updated_at = ? WHERE repository_id = ?"
  );
  stmt.run(new Date().toISOString(), null, new Date().toISOString(), "repo-x");
});

// Pattern D: cached UPDATE
const cachedUpd = db.prepare(
  "UPDATE watcher_state SET last_polled_at = ?, last_error = ?, updated_at = ? WHERE repository_id = ?"
);
bench("cached-stmt UPDATE", (i) => {
  cachedUpd.run(new Date().toISOString(), null, new Date().toISOString(), "repo-x");
});

// Pattern E: PRAGMA table_info per call (RunStore.hasColumn)
bench("PRAGMA table_info per call", () => {
  const rows = db.prepare("PRAGMA table_info(runs)").all();
  return rows.some((r) => r.name === "drain_reason");
});

// One-time PRAGMA
const hasCol = (() => {
  const rows = db.prepare("PRAGMA table_info(runs)").all();
  return rows.some((r) => r.name === "drain_reason");
})();
console.log("one-time PRAGMA result:", hasCol);

// JSON stringify cost of a typical event payload (ledger record path)
const event = { repositoryId: "r1", runId: "run1", iteration: 3, phase: "EXECUTOR_ACTIVITY", eventType: "executor.log", data: { chunk: "x".repeat(400), runId: "run1", stream: "stdout" } };
bench("JSON.stringify(event)", () => JSON.stringify(event), 50000);

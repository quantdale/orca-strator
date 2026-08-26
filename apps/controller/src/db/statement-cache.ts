import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Per-connection prepared-statement cache.
 *
 * node:sqlite compiles SQL on every DatabaseSync.prepare() call and keeps no
 * internal cache. Store classes previously re-prepared identical statements on
 * each method call (hot paths include the 5s watcher poll loop, per-log-line
 * ledger writes during executor streaming, and every loop state transition).
 * A measured microbenchmark (scripts/profiling/sqlite-prepare-bench.mjs) shows
 * prepare-per-call costs 4-11x more than reusing a compiled statement.
 *
 * The cache lives in a WeakMap keyed by connection so closed/test databases
 * are garbage-collected without manual eviction. Statements are safe to share
 * because node:sqlite is synchronous and JS executes stores single-threaded;
 * .get()/.all()/.run() complete before returning. Schema changes after
 * preparation are handled internally by SQLite (prepare_v2 auto-reprepare).
 */
const caches = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

export function preparedStatement(db: DatabaseSync, sql: string): StatementSync {
  let statements = caches.get(db);
  if (!statements) {
    statements = new Map<string, StatementSync>();
    caches.set(db, statements);
  }
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

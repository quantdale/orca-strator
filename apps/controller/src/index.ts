import { loadConfig } from "./config/load-config.js";
import { getControllerIdentity } from "./runtime/build-identity.js";
import { ControllerRuntimeLock } from "./runtime/singleton-lock.js";
import { buildApp } from "./app.js";
import { DatabaseTooNewError, preflightSchemaCompatibility, MAX_KNOWN_SCHEMA_VERSION } from "./db/schema-compat.js";
import { installBoundedPackagedLogging } from "./runtime/log-bounded.js";
import { DatabaseSync } from "node:sqlite";

type AppRuntime = Awaited<ReturnType<typeof buildApp>>;

/** Process exit codes used by the desktop supervisor to classify failures. */
const EXIT_SINGLETON_BUSY = 10;
const EXIT_PORT_CONFLICT = 11;
const EXIT_INIT_FAILED = 1;
/** Change 026: database is newer than this binary supports; fail closed. */
const EXIT_DATABASE_TOO_NEW = 12;

/**
 * Packaged-runtime logging (Change 025 + 027): when there is no terminal,
 * controller stdout/stderr must still land in the writable data dir. The size
 * bound is enforced DURING the running process (runtime-bounded sink), not
 * only at startup, so one long-running controller cannot exceed the policy.
 */
function installPackagedLogging(logDir: string): void {
  installBoundedPackagedLogging(logDir);
}

async function main() {
  const identity = getControllerIdentity();
  const config = loadConfig();

  // Change 026: schema downgrade refusal runs before ANY other startup work —
  // before logging setup mutates nothing, before lock acquisition, before
  // services. A read-only preflight against the persistent DB decides.
  if (config.dbPath !== ":memory:") {
    try {
      const probe = new DatabaseSync(config.dbPath, { readOnly: true });
      try {
        preflightSchemaCompatibility(probe, MAX_KNOWN_SCHEMA_VERSION);
      } finally {
        probe.close();
      }
    } catch (err) {
      if (err instanceof DatabaseTooNewError) {
        console.error(
          `[controller] ${err.message} ` +
            `(currentSchema=${err.currentSchema}, maxKnownSchema=${err.maxKnownSchema})`
        );
        process.exit(EXIT_DATABASE_TOO_NEW);
      }
      // ENOENT etc. means no database exists yet — normal first-start path.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        // Unreadable/corrupt DB: let initDatabase surface the real error.
        console.warn(`[controller] Schema preflight probe skipped (${code ?? String(err)}).`);
      }
    }
  }

  if (config.nodeEnv === "production" || process.env.ORCA_PACKAGED === "1") {
    // In packaged mode there is no visible terminal; keep durable diagnostics.
    if (process.env.ORCA_PACKAGED === "1") {
      installPackagedLogging(config.logDir);
    }
  }

  // Singleton ownership BEFORE any service construction: two controllers must
  // never race into interleaved SQLite/watcher/browser state.
  const lock = new ControllerRuntimeLock(config.runtimeLockPath);
  const acquired = lock.acquire(identity.version);
  if (acquired.outcome === "busy") {
    const current = acquired.current;
    console.warn(
      `[controller] Another live Orca controller already owns this data directory ` +
        `(pid=${current.pid}, version=${current.version}, startedAt=${current.startedAt}). Exiting.`
    );
    process.exit(EXIT_SINGLETON_BUSY);
  } else if (acquired.outcome === "reclaimed-stale") {
    console.warn(
      `[controller] Reclaimed stale runtime lock (${acquired.reason}); previous owner pid=` +
        `${acquired.previous?.pid ?? "unknown"}.`
    );
  }

  // Signal handlers are registered BEFORE buildApp so Ctrl+C during startup
  // cannot orphan mid-push git state or Chromium children behind a process that
  // ignores the signal until listen() completes.
  //
  // Chosen shutdown-during-init behavior (documented): while buildApp is still
  // in flight there is no safely-awaitable teardown surface — half-built
  // services may not tolerate partial close, and awaiting buildApp from a
  // signal handler is unsound. A best-effort abort of in-flight startup work is
  // explicitly NOT attempted; we log a notice and exit cleanly. At that point
  // no Chromium page or executor child exists yet (both start lazily after
  // init), so nothing is orphaned by the exit.
  let initialized: AppRuntime | null = null;
  let exiting = false;

  const shutdown = async (signal: string) => {
    if (exiting) return;
    exiting = true;

    const app = initialized;
    if (!app) {
      console.warn(`[controller] ${signal} received before initialization completed; exiting cleanly.`);
      lock.release();
      process.exit(0);
    }

    app.fastify.log.info(`Shutting down controller (${signal})...`);
    await app.fastify.close();
    app.dbContext.close();
    lock.release();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  let app: AppRuntime;
  try {
    app = await buildApp(config, {
      lifecycle: {
        controlToken: lock.currentControlToken,
        requestShutdown: () => void shutdown("CONTROL_SHUTDOWN")
      }
    });
  } catch (err) {
    if (err instanceof DatabaseTooNewError) {
      console.error(
        `[controller] ${err.message} ` +
          `(currentSchema=${err.currentSchema}, maxKnownSchema=${err.maxKnownSchema})`
      );
      lock.release();
      process.exit(EXIT_DATABASE_TOO_NEW);
    }
    console.warn("[controller] Initialization failed:", err);
    lock.release();
    process.exit(EXIT_INIT_FAILED);
  }
  initialized = app;

  const { fastify, dbContext } = app;
  try {
    await fastify.listen({ host: config.host, port: config.port });
    fastify.log.info(`Orca Controller listening on http://${config.host}:${config.port}`);
    lock.refresh({ endpoint: `http://${config.host}:${config.port}` });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EADDRINUSE") {
      fastify.log.error(
        err,
        `Port ${config.port} is occupied and the runtime lock was not held by us; ` +
          `refusing to start rather than disturbing an unknown listener.`
      );
    } else {
      fastify.log.error(err, "Failed to start controller");
    }
    dbContext.close();
    lock.release();
    process.exit(code === "EADDRINUSE" ? EXIT_PORT_CONFLICT : EXIT_INIT_FAILED);
  }
}

void main().catch((err) => {
  console.error("[controller] Fatal startup error:", err);
  process.exit(1);
});

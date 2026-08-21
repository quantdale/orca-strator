import { loadConfig } from "./config/load-config.js";
import { buildApp } from "./app.js";

type AppRuntime = Awaited<ReturnType<typeof buildApp>>;

async function main() {
  const config = loadConfig();

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
      process.exit(0);
    }

    app.fastify.log.info(`Shutting down controller (${signal})...`);
    await app.fastify.close();
    app.dbContext.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  let app: AppRuntime;
  try {
    app = await buildApp(config);
  } catch (err) {
    console.warn("[controller] Initialization failed:", err);
    process.exit(1);
  }
  initialized = app;

  const { fastify, dbContext } = app;
  try {
    await fastify.listen({ host: config.host, port: config.port });
    fastify.log.info(`Orca Controller listening on http://${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err, "Failed to start controller");
    dbContext.close();
    process.exit(1);
  }
}

main();

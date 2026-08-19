import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { type ControllerConfig } from './config/load-config.js';
import { initDatabase, type DatabaseContext } from './db/database.js';
import { RepositoryStore } from './repositories/repository-store.js';
import { RepositoryService } from './repositories/repository-service.js';
import { EventBus } from './events/event-bus.js';
import { errorHandler } from './http/errors.js';
import { healthRoutes } from './http/routes/health.js';
import { repositoryRoutes } from './http/routes/repositories.js';
import { watcherRoutes } from './http/routes/watcher.js';
import { executorRoutes } from './http/routes/executor.js';
import { browserRoutes } from './http/routes/browser.js';
import { runRoutes } from './http/routes/runs.js';
import { systemRoutes } from './http/routes/system.js';
import { websocketRoutes } from './events/websocket.js';
import { registerStaticUi } from './http/static-ui.js';
import { DispatchStore } from './watcher/dispatch-store.js';
import { GitClient } from './watcher/git-client.js';
import { CommitInspector } from './watcher/commit-inspector.js';
import { WatcherService } from './watcher/watcher-service.js';
import { SolControlStore } from './watcher/sol-control-store.js';
import { ExecutorStore } from './executor/executor-store.js';
import { ExecutorService } from './executor/executor-service.js';
import { SolWakeStore } from './browser/sol-wake-store.js';
import { BrowserManager } from './browser/browser-manager.js';
import { RunStore } from './loop/run-store.js';
import { LoopService } from './loop/loop-service.js';
import { StartupReconciler } from './loop/startup-reconciler.js';

import type { BrowserDriver } from './browser/browser-driver.js';

export interface AppInstance {
  fastify: FastifyInstance;
  dbContext: DatabaseContext;
  eventBus: EventBus;
  repositoryService: RepositoryService;
  dispatchStore: DispatchStore;
  watcherService: WatcherService;
  solControlStore: SolControlStore;
  executorStore: ExecutorStore;
  executorService: ExecutorService;
  wakeStore: SolWakeStore;
  browserManager: BrowserManager;
  runStore: RunStore;
  loopService: LoopService;
}

export async function buildApp(
  config: ControllerConfig,
  overrides: {
    browserDriver?: BrowserDriver;
    browserManager?: BrowserManager;
    loopService?: LoopService;
  } = {}
): Promise<AppInstance> {
  const fastify = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  fastify.setErrorHandler(errorHandler);

  const dbContext = initDatabase(config.dbPath);
  const store = new RepositoryStore(dbContext.db);
  const dispatchStore = new DispatchStore(dbContext.db);
  const executorStore = new ExecutorStore(dbContext.db);
  const wakeStore = new SolWakeStore(dbContext.db);
  const solControlStore = new SolControlStore(dbContext.db);
  const runStore = new RunStore(dbContext.db);
  const eventBus = new EventBus();
  const repositoryService = new RepositoryService(store, eventBus);

  const gitClient = new GitClient();
  const commitInspector = new CommitInspector(gitClient);

  // Forward declaration so watcher/executor callbacks can reference the loop
  // service once it is constructed (real production wiring, A).
  let loopService: LoopService;

  const watcherService = new WatcherService({
    repoStore: store,
    dispatchStore,
    solControlStore,
    gitClient,
    commitInspector,
    eventPublisher: (event) => eventBus.publish(event),
    pollIntervalMs: 5000,
    onDispatchDetected: (repositoryId, dispatchId) => {
      void loopService.onDispatchDetected(repositoryId, dispatchId);
    },
    onControlDetected: (repositoryId, controlId, decision, runId) => {
      void loopService.onControlDetected(repositoryId, controlId, decision, runId);
    }
  });

  const executorService = new ExecutorService({
    repoStore: store,
    dispatchStore,
    executorStore,
    gitClient,
    dataDir: config.dataDir,
    onExecutorCompleted: (repositoryId, dispatchId, result) => {
      void loopService.onExecutorCompleted(repositoryId, dispatchId, result);
    },
    eventPublisher: (event) => eventBus.publish(event)
  });

  const browserManager =
    overrides.browserManager ||
    new BrowserManager({
      dataDir: config.dataDir,
      driver: overrides.browserDriver,
      wakeStore,
      eventPublisher: (event) => eventBus.publish(event)
    });

  loopService =
    overrides.loopService ||
    new LoopService({
      repoStore: store,
      dispatchStore,
      runStore,
      watcherService,
      executorService,
      browserManager,
      solControlStore,
      eventPublisher: (event) => eventBus.publish(event)
    });

  // Reconcile watched repositories when configuration changes (B).
  eventBus.subscribe((event) => {
    if (
      event.type === "repository.created" ||
      event.type === "repository.updated" ||
      event.type === "repository.deleted"
    ) {
      watcherService.reconcileWatchingForRepository(event.repositoryId);
    }
  });

  const reconciler = new StartupReconciler(store, runStore, loopService);
  await reconciler.reconcile();

  // Production watcher lifecycle (Fix #1): every existing enabled repository
  // must be watched automatically after startup without requiring a user
  // edit/save. Idempotent; reconcile subscription keeps create/update/delete
  // in sync thereafter.
  watcherService.start();

  fastify.addHook('onClose', async () => {
    watcherService.stop();
    await browserManager.close();
  });

  await fastify.register(websocket);

  await fastify.register(healthRoutes(dbContext.db));
  await fastify.register(repositoryRoutes(repositoryService));
  await fastify.register(watcherRoutes(watcherService, dispatchStore, repositoryService));
  await fastify.register(executorRoutes(executorService, repositoryService));
  await fastify.register(browserRoutes(browserManager, repositoryService, dispatchStore));
  await fastify.register(runRoutes(loopService, repositoryService));
  await fastify.register(systemRoutes(config.port, browserManager));
  await fastify.register(websocketRoutes(eventBus));

  // FIX #9: Wire BrowserManager SOL_STALLED timeout back to LoopService
  browserManager.setSolStalledHandler(async (repositoryId, runId, errorMessage) => {
    const run = runStore.get(runId);
    if (!run) return;
    const active = runStore.getActiveRun(repositoryId);
    if (!active || active.id !== runId) return;
    if (active.status === "SOL_REVIEWING" || active.status === "SOL_PENDING") {
      runStore.updateStatus(runId, "SOL_STALLED", { lastError: errorMessage, finishedAt: new Date().toISOString() });
      try {
        eventBus.publish({ type: "loop.state_changed", at: new Date().toISOString(), repositoryId, data: { runId, loopState: "SOL_STALLED" } });
      } catch {}
    }
  });

  await registerStaticUi(fastify, config.uiDistDir);

  return {
    fastify,
    dbContext,
    eventBus,
    repositoryService,
    dispatchStore,
    watcherService,
    solControlStore,
    executorStore,
    executorService,
    wakeStore,
    browserManager,
    runStore,
    loopService
  };
}

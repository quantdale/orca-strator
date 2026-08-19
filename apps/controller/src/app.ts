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
import { websocketRoutes } from './events/websocket.js';
import { registerStaticUi } from './http/static-ui.js';
import { DispatchStore } from './watcher/dispatch-store.js';
import { GitClient } from './watcher/git-client.js';
import { CommitInspector } from './watcher/commit-inspector.js';
import { WatcherService } from './watcher/watcher-service.js';
import { ExecutorStore } from './executor/executor-store.js';
import { ExecutorService } from './executor/executor-service.js';

export interface AppInstance {
  fastify: FastifyInstance;
  dbContext: DatabaseContext;
  eventBus: EventBus;
  repositoryService: RepositoryService;
  dispatchStore: DispatchStore;
  watcherService: WatcherService;
  executorStore: ExecutorStore;
  executorService: ExecutorService;
}

export async function buildApp(config: ControllerConfig): Promise<AppInstance> {
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
  const eventBus = new EventBus();
  const repositoryService = new RepositoryService(store, eventBus);

  const gitClient = new GitClient();
  const commitInspector = new CommitInspector(gitClient);
  const watcherService = new WatcherService({
    repoStore: store,
    dispatchStore,
    gitClient,
    commitInspector,
    eventPublisher: (event) => eventBus.publish(event),
    pollIntervalMs: 5000
  });

  const executorService = new ExecutorService({
    repoStore: store,
    dispatchStore,
    executorStore,
    dataDir: config.dataDir,
    eventPublisher: (event) => eventBus.publish(event)
  });

  fastify.addHook('onClose', async () => {
    watcherService.stop();
  });

  await fastify.register(websocket);

  await fastify.register(healthRoutes(dbContext.db));
  await fastify.register(repositoryRoutes(repositoryService));
  await fastify.register(watcherRoutes(watcherService, dispatchStore, repositoryService));
  await fastify.register(executorRoutes(executorService, repositoryService));
  await fastify.register(websocketRoutes(eventBus));

  await registerStaticUi(fastify, config.uiDistDir);

  return {
    fastify,
    dbContext,
    eventBus,
    repositoryService,
    dispatchStore,
    watcherService,
    executorStore,
    executorService
  };
}

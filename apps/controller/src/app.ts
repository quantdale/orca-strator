import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { ControllerConfig } from "./config/load-config.js";
import type { PermissionDecision } from "@orca/shared";
import { initDatabase, type DatabaseContext } from "./db/database.js";
import { RepositoryStore } from "./repositories/repository-store.js";
import { RepositoryService } from "./repositories/repository-service.js";
import { EventBus } from "./events/event-bus.js";
import { errorHandler } from "./http/errors.js";
import { healthRoutes } from "./http/routes/health.js";
import { repositoryRoutes } from "./http/routes/repositories.js";
import { watcherRoutes } from "./http/routes/watcher.js";
import { executorRoutes } from "./http/routes/executor.js";
import { browserRoutes } from "./http/routes/browser.js";
import { runRoutes } from "./http/routes/runs.js";
import { systemRoutes } from "./http/routes/system.js";
import { websocketRoutes } from "./events/websocket.js";
import { registerStaticUi } from "./http/static-ui.js";
import { DispatchStore } from "./watcher/dispatch-store.js";
import { GitClient } from "./watcher/git-client.js";
import { CommitInspector } from "./watcher/commit-inspector.js";
import { WatcherService } from "./watcher/watcher-service.js";
import { SolControlStore } from "./watcher/sol-control-store.js";
import { ExecutorStore } from "./executor/executor-store.js";
import { ExecutorService } from "./executor/executor-service.js";
import { SolWakeStore } from "./browser/sol-wake-store.js";
import { BrowserManager } from "./browser/browser-manager.js";
import { SqliteSolOperationStore } from "./browser/sol-operation-store.js";
import { RunStore } from "./loop/run-store.js";
import { LoopService } from "./loop/loop-service.js";
import { IterationExecutionCoordinator } from "./loop/iteration-execution-coordinator.js";
import { StartupReconciler } from "./loop/startup-reconciler.js";
import { RunPolicyStore } from "./loop/run-policy-store.js";
import { CampaignLedgerStore } from "./ledger/campaign-ledger-store.js";
import { CampaignLedgerService } from "./ledger/campaign-ledger-service.js";
import { CapabilityStore } from "./executor/capability-store.js";
import { CapabilityProbeService } from "./executor/capability-probe-service.js";
import { PermissionStore } from "./permissions/permission-store.js";
import { PermissionPolicyService } from "./permissions/permission-policy-service.js";
import { campaignRoutes } from "./http/routes/campaigns.js";
import { operationalIntelligenceRoutes } from "./http/routes/operational-intelligence.js";
import { usageSchedulerRoutes } from "./http/routes/usage-scheduler.js";
import { UsageTelemetryStore } from "./usage/usage-telemetry-store.js";
import { UsageTelemetryService } from "./usage/usage-telemetry-service.js";
import { SchedulerPolicyStore } from "./scheduler/scheduler-policy-store.js";
import { SchedulerService } from "./scheduler/scheduler-service.js";
import { RoleModelPolicyStore } from "./scheduler/role-model-policy-store.js";
import { RoleModelPolicyService } from "./scheduler/role-model-policy-service.js";
import { WorkPacketStore } from "./packets/work-packet-store.js";
import { WorkPacketService } from "./packets/work-packet-service.js";
import { WorktreeIsolationService } from "./packets/worktree-isolation-service.js";
import { IntegrationService } from "./packets/integration-service.js";
import { workPacketRoutes } from "./http/routes/work-packets.js";
import { StrategyRunStore } from "./strategy/strategy-run-store.js";
import { DagNodeStore } from "./strategy/dag-node-store.js";
import { SwarmExecutionService } from "./strategy/swarm-execution-service.js";
import { DagExecutionService } from "./strategy/dag-execution-service.js";
import { OpenCodeAdapter } from "./executor/adapters/opencode-adapter.js";
import { swarmRoutes } from "./http/routes/swarm.js";
import { dagRoutes } from "./http/routes/dag.js";

import type { BrowserDriver } from "./browser/browser-driver.js";
import type { SystemChromeInfo } from "./browser/chrome-discovery.js";
import type { ExternalSetupLauncherLike } from "./browser/external-setup-browser.js";

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
  iterationExecutionCoordinator: IterationExecutionCoordinator;
  runPolicyStore: RunPolicyStore;
  campaignLedgerStore: CampaignLedgerStore;
  campaignLedgerService: CampaignLedgerService;
  capabilityStore: CapabilityStore;
  capabilityProbeService: CapabilityProbeService;
  openCodeAdapter: OpenCodeAdapter;
  permissionStore: PermissionStore;
  permissionPolicyService: PermissionPolicyService;
  usageStore: UsageTelemetryStore;
  usageTelemetryService: UsageTelemetryService;
  schedulerPolicyStore: SchedulerPolicyStore;
  schedulerService: SchedulerService;
  roleModelPolicyStore: RoleModelPolicyStore;
  roleModelPolicyService: RoleModelPolicyService;
  workPacketStore: WorkPacketStore;
  workPacketService: WorkPacketService;
  worktreeIsolationService: WorktreeIsolationService;
  integrationService: IntegrationService;
  strategyRunStore: StrategyRunStore;
  swarmExecutionService: SwarmExecutionService;
  dagNodeStore: DagNodeStore;
  dagExecutionService: DagExecutionService;
}

export async function buildApp(
  config: ControllerConfig,
  overrides: {
    browserDriver?: BrowserDriver;
    browserManager?: BrowserManager;
    loopService?: LoopService;
    /** Change 023 test seams for the external setup-Chrome flow. */
    discoverSystemChrome?: () => Promise<SystemChromeInfo>;
    setupLauncher?: ExternalSetupLauncherLike;
    requireInstalledChromeForAutomation?: boolean;
  } = {},
): Promise<AppInstance> {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
    },
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
  const repositoryService = new RepositoryService(store, eventBus, runStore);
  const capabilityStore = new CapabilityStore(dbContext.db);
  const runPolicyStore = new RunPolicyStore(dbContext.db);
  const campaignLedgerStore = new CampaignLedgerStore(dbContext.db);
  const strategyRunStore = new StrategyRunStore(dbContext.db);
  const dagNodeStore = new DagNodeStore(dbContext.db);
  const usageStore = new UsageTelemetryStore(dbContext.db);
  const usageTelemetryService = new UsageTelemetryService(
    usageStore,
    (event) => eventBus.publish(event),
    (repositoryId) => capabilityStore.markUsageTelemetry(repositoryId, "READY"),
  );
  const campaignLedgerService = new CampaignLedgerService(
    dbContext.db,
    store,
    runStore,
    runPolicyStore,
    campaignLedgerStore,
    usageStore,
    strategyRunStore,
    dagNodeStore,
  );
  eventBus.subscribe((event) => {
    campaignLedgerService.recordEvent(event);
  });

  const gitClient = new GitClient();
  const commitInspector = new CommitInspector(gitClient);
  const openCodeAdapter = new OpenCodeAdapter();
  const capabilityProbeService = new CapabilityProbeService({
    store: capabilityStore,
    gitClient,
    openCodeAdapter,
    eventPublisher: (event) => eventBus.publish(event),
  });
  const permissionStore = new PermissionStore(dbContext.db);
  const schedulerPolicyStore = new SchedulerPolicyStore(dbContext.db);
  const schedulerService = new SchedulerService(schedulerPolicyStore);
  const roleModelPolicyStore = new RoleModelPolicyStore(dbContext.db);
  const roleModelPolicyService = new RoleModelPolicyService(
    roleModelPolicyStore,
  );
  const workPacketStore = new WorkPacketStore(dbContext.db);
  const workPacketService = new WorkPacketService(workPacketStore);
  const worktreeIsolationService = new WorktreeIsolationService(
    workPacketStore,
    config.dataDir,
  );
  const integrationService = new IntegrationService(workPacketStore);
  const permissionPolicyService = new PermissionPolicyService({
    store: permissionStore,
    // Native enforcement claim comes from the latest capability probe; without
    // a READY probe the policy service records decisions as ADVISORY_ONLY.
    hasNativePermissionApi: (repositoryId) =>
      capabilityStore.latest(repositoryId)?.snapshot.rich.permissionApi ===
      "READY",
    attentionHandler: (decision) => {
      if (!decision.runId) return;
      const run = runStore.get(decision.runId);
      if (!run || run.repositoryId !== decision.repositoryId) return;
      runStore.updateStatus(run.id, "ATTENTION_REQUIRED", {
        lastError: `Permission attention required: ${decision.action}`,
        finishedAt: new Date().toISOString(),
      });
      eventBus.publish({
        type: "loop.state_changed",
        at: new Date().toISOString(),
        repositoryId: decision.repositoryId,
        data: {
          runId: decision.runId,
          iteration: decision.iteration ?? undefined,
          loopState: "ATTENTION_REQUIRED",
          reason: `Permission attention required: ${decision.action}`,
        },
      });
    },
    eventPublisher: (event) => eventBus.publish(event),
  });

  const swarmExecutionService = new SwarmExecutionService({
    repositoryStore: store,
    runStore,
    strategyStore: strategyRunStore,
    packetStore: workPacketStore,
    packetService: workPacketService,
    worktreeService: worktreeIsolationService,
    integrationService,
    schedulerService,
    permissionPolicyService,
    usageTelemetryService,
    gitClient,
    dataDir: config.dataDir,
    openCodeAdapter,
    eventPublisher: (event) => eventBus.publish(event),
  });
  const dagExecutionService = new DagExecutionService({
    repositoryStore: store,
    runStore,
    strategyStore: strategyRunStore,
    nodeStore: dagNodeStore,
    packetStore: workPacketStore,
    packetService: workPacketService,
    executionService: swarmExecutionService,
  });

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
    onControlDetected: (
      repositoryId,
      controlId,
      decision,
      runId,
      iteration,
      relatedDispatchId,
    ) => {
      void loopService.onControlDetected(
        repositoryId,
        controlId,
        decision,
        runId,
        iteration,
        relatedDispatchId,
      );
    },
  });

  const executorService = new ExecutorService({
    repoStore: store,
    dispatchStore,
    executorStore,
    gitClient,
    dataDir: config.dataDir,
    openCodeAdapter,
    runPolicyStore,
    usageTelemetryService,
    onExecutorCompleted: (repositoryId, dispatchId, result) => {
      void loopService.onExecutorCompleted(repositoryId, dispatchId, result);
    },
    eventPublisher: (event) => eventBus.publish(event),
  });

  const browserManager =
    overrides.browserManager ||
    new BrowserManager({
      dataDir: config.dataDir,
      driver: overrides.browserDriver,
      wakeStore,
      solOperationStore: new SqliteSolOperationStore(dbContext.db),
      eventPublisher: (event) => eventBus.publish(event),
      // Change 023: production automation launches discovered installed Chrome
      // against the dedicated profile; interactive setup spawns ordinary Chrome
      // directly (never Playwright).
      discoverSystemChrome: overrides.discoverSystemChrome,
      setupLauncher: overrides.setupLauncher,
      requireInstalledChromeForAutomation:
        overrides.requireInstalledChromeForAutomation ??
        !overrides.browserDriver,
    });

  // Best-effort system-Chrome probe so Settings truthfully shows detected/
  // version state shortly after startup; failures leave UNKNOWN.
  void browserManager.refreshSystemChrome().catch(() => {});

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
      runPolicyStore,
      strategyRunStore,
      eventPublisher: (event) => eventBus.publish(event),
    });

  // Change 020: resolution closes an attention-parked campaign when its last
  // actionable ask settles; active actors are never contradicted.
  const onPermissionResolved = (decision: PermissionDecision): void => {
    try {
      eventBus.publish({
        type: "permission.resolved",
        at: new Date().toISOString(),
        repositoryId: decision.repositoryId,
        data: {
          decisionId: decision.id,
          runId: decision.runId ?? undefined,
          iteration: decision.iteration ?? undefined,
          action: decision.action,
          outcome: decision.outcome,
          enforcement: decision.enforcement,
          resolvedAt: decision.resolvedAt ?? undefined,
        },
      });
      if (!decision.runId) return;
      const run = runStore.getLatestRun(decision.repositoryId);
      if (
        !run ||
        run.id !== decision.runId ||
        run.status !== "ATTENTION_REQUIRED"
      )
        return;
      const stillPending = permissionStore
        .listDecisions(decision.repositoryId)
        .some(
          (candidate) =>
            candidate.actionable &&
            !candidate.resolvedAt &&
            candidate.runId === decision.runId &&
            candidate.id !== decision.id,
        );
      if (stillPending) return;
      void loopService
        .recoverRun(decision.repositoryId, "retry")
        .catch((err) => {
          console.warn(
            "[app] permission-resolution recovery failed:",
            (err as Error | null)?.message ?? String(err),
          );
        });
    } catch (err) {
      console.warn("[app] permission-resolved handling failed:", err);
    }
  };

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

  const reconciler = new StartupReconciler(
    store,
    runStore,
    loopService,
    browserManager,
    executorStore,
  );
  await reconciler.reconcile();
  await dagExecutionService.recoverAll();

  // Scheduler leases live in memory only; after a restart nothing is active
  // yet, so persisted ADMITTED leases become STALE_RECOVERABLE for the owning
  // execution strategy to reconcile.
  schedulerService.recover();

  // Production watcher lifecycle (Fix #1): every existing enabled repository
  // must be watched automatically after startup without requiring a user
  // edit/save. Idempotent; reconcile subscription keeps create/update/delete
  // in sync thereafter.
  // Change 017: single authoritative execution coordinator per iteration.
  const coordinator = new IterationExecutionCoordinator({
    repositoryStore: store,
    runStore,
    strategyRunStore,
    dispatchStore,
    executorService,
    swarmExecutionService,
    dagExecutionService,
    integrationService,
    loopService,
    browserManager,
    eventPublisher: (event) => eventBus.publish(event),
  });
  loopService.setCoordinator(coordinator);

  // Change 018 R2: after restart reconciliation, replay the postflight for
  // completed-but-unconfirmed iterations (same persisted report, no worker
  // rerun). Success consumes the dispatch and wakes Sol; failure stays in
  // recovery with refreshed evidence.
  try {
    await coordinator.retryAllPendingPostflights();
  } catch (err) {
    console.warn(
      "[app] pending postflight retry failed:",
      (err as Error | null)?.message ?? String(err),
    );
  }

  // Change 019: startup reconciliation consumer — recovery is
  // ownership-terminal, so stale admission leases can never be re-admitted;
  // close them with truthful evidence and surface one event per lease.
  for (const lease of schedulerService.reconcileStaleLeases()) {
    eventBus.publish({
      type: "scheduler.lease_reconciled",
      at: new Date().toISOString(),
      repositoryId: lease.repositoryId,
      data: {
        requestId: lease.requestId,
        status: lease.status,
        reason: lease.reason,
      },
    });
  }

  watcherService.start();

  fastify.addHook("onClose", async () => {
    watcherService.stop();
    // F-LOW-1: loop-owned timers (busy-retry + wall-clock) must not fire into
    // teardown or after the DB closes.
    loopService.shutdown();
    try {
      // R5: genuine async shutdown — route KILLs, await engine settlement and
      // in-flight completion callbacks before browser/db teardown continues.
      await coordinator.shutdown();
    } catch {
      /* best-effort during teardown */
    }
    await browserManager.close();
  });

  await fastify.register(websocket);

  await fastify.register(healthRoutes(dbContext.db));
  await fastify.register(
    repositoryRoutes(repositoryService, permissionStore, onPermissionResolved),
  );
  await fastify.register(
    watcherRoutes(watcherService, dispatchStore, repositoryService),
  );
  await fastify.register(
    executorRoutes(executorService, repositoryService, coordinator),
  );
  await fastify.register(
    browserRoutes(browserManager, repositoryService, dispatchStore),
  );
  await fastify.register(runRoutes(loopService, repositoryService));
  await fastify.register(
    campaignRoutes(campaignLedgerService, repositoryService),
  );
  await fastify.register(
    operationalIntelligenceRoutes(
      repositoryService,
      capabilityProbeService,
      permissionPolicyService,
      runPolicyStore,
      runStore,
    ),
  );
  await fastify.register(
    usageSchedulerRoutes(
      repositoryService,
      usageTelemetryService,
      schedulerService,
      roleModelPolicyService,
    ),
  );
  await fastify.register(
    workPacketRoutes(
      repositoryService,
      runStore,
      workPacketService,
      worktreeIsolationService,
      integrationService,
      workPacketStore,
    ),
  );
  await fastify.register(
    swarmRoutes(
      repositoryService,
      runStore,
      swarmExecutionService,
      coordinator,
    ),
  );
  await fastify.register(
    dagRoutes(repositoryService, runStore, dagExecutionService, coordinator),
  );
  await fastify.register(systemRoutes(config.port, browserManager));
  await fastify.register(websocketRoutes(eventBus));

  // FIX #9: Wire BrowserManager SOL_STALLED timeout back to LoopService
  browserManager.setSolStalledHandler(
    async (repositoryId, runId, errorMessage) => {
      const run = runStore.get(runId);
      if (!run) return;
      const active = runStore.getActiveRun(repositoryId);
      if (!active || active.id !== runId) return;
      if (
        active.status === "SOL_REVIEWING" ||
        active.status === "SOL_PENDING"
      ) {
        runStore.updateStatus(runId, "SOL_STALLED", {
          lastError: errorMessage,
          finishedAt: new Date().toISOString(),
        });
        try {
          eventBus.publish({
            type: "loop.state_changed",
            at: new Date().toISOString(),
            repositoryId,
            data: { runId, loopState: "SOL_STALLED" },
          });
        } catch {
          /* best-effort event publish */
        }
      }
    },
  );

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
    loopService,
    runPolicyStore,
    campaignLedgerStore,
    campaignLedgerService,
    capabilityStore,
    capabilityProbeService,
    openCodeAdapter,
    permissionStore,
    permissionPolicyService,
    usageStore,
    usageTelemetryService,
    schedulerPolicyStore,
    schedulerService,
    roleModelPolicyStore,
    roleModelPolicyService,
    workPacketStore,
    workPacketService,
    worktreeIsolationService,
    integrationService,
    strategyRunStore,
    swarmExecutionService,
    dagNodeStore,
    dagExecutionService,
    iterationExecutionCoordinator: coordinator,
  };
}

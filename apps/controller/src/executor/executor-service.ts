import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  generateBootstrapPrompt,
  isResultFilePath,
  validateExecutorResult,
  type ExecutorResult,
  type ExecutorRunRecord,
  type ExecutorStatusResponse,
  type RepositoryMutationEvent,
  type RepositoryRecord,
  type PhaseBudgetPolicy,
  ValidationError,
  RepositoryNotFoundError
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { GitClient, GitContext } from "../watcher/git-client.js";
import type { ExecutorStore } from "./executor-store.js";
import type { RunPolicyStore } from "../loop/run-policy-store.js";
import type { UsageTelemetryService } from "../usage/usage-telemetry-service.js";
import type { ExecutorAdapter } from "./adapters/executor-adapter.js";
import type { OpenCodeAdapter } from "./adapters/opencode-adapter.js";
import { WindowsPowerShellAdapter } from "./adapters/windows-adapter.js";
import { WslAdapter } from "./adapters/wsl-adapter.js";
import { ExecutorRunner } from "./executor-runner.js";
import { LogRotator } from "./log-rotator.js";
import { buildExecutorInvocation, resolveProfile } from "./profiles.js";
import { toWslPath } from "../wsl-path.js";
import type { RepositoryActorLeaseService } from "../ownership/actor-lease-service.js";
import type { ProcessOwnershipStore } from "../ownership/ownership-store.js";
import type { ProcessProbe } from "../ownership/process-probe.js";
import type { OrchestrationTransitionService } from "../ownership/transition-service.js";

export interface ExecutorStartOptions {
  /** Resume an interrupted dispatch; instructs the executor to preserve partial work. */
  recovery?: boolean;
}

export interface ExecutorServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore: DispatchStore;
  executorStore: ExecutorStore;
  gitClient?: GitClient;
  dataDir?: string;
  windowsAdapter?: ExecutorAdapter;
  wslAdapter?: ExecutorAdapter;
  openCodeAdapter?: OpenCodeAdapter;
  /** Separate executor watchdog in ms; 0/disabled by default. Wall-clock ceiling does NOT kill executor. */
  executorWatchdogMs?: number;
  runPolicyStore?: RunPolicyStore;
  usageTelemetryService?: UsageTelemetryService;
  /** Production wiring: called when an executor turn finishes (valid result or null). Promise-aware: may be async. */
  onExecutorCompleted?: (
    repositoryId: string,
    dispatchId: string,
    result: ExecutorResult | null
  ) => void | Promise<void>;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
  /**
   * Change 028 (D4/D5): durable execution-ownership wiring. When present, the
   * direct executor acquires a SINGLE_AGENT actor lease before admission, and
   * each spawned child persists a process ownership record via the onSpawn
   * hook. Absent (legacy/test wiring) the service behaves exactly as before.
   */
  ownership?: ExecutorOwnershipDeps;
  /** Change 028 (D9/D10): when present, dispatch consumption is owned
   * atomically by the loop's transition processor rather than here, so a
   * validated result never marks a dispatch consumed before its run
   * transition is committed. Absent (legacy/test wiring) preserves the prior
   * inline consumption.
   */
  transition?: OrchestrationTransitionService;
}

/** Durable ownership dependencies for the direct-executor path (Change 028). */
export interface ExecutorOwnershipDeps {
  leaseService: RepositoryActorLeaseService;
  processStore: ProcessOwnershipStore;
  probe: ProcessProbe;
  controllerInstanceId: string;
}

const MAX_LAUNCH_ATTEMPTS = 3;
const LAUNCH_RETRY_BASE_MS = 1500;
/** Delay between postflight remote-verification retry attempts (real dogfood finding). */
const POSTFLIGHT_RETRY_BASE_MS = 1500;
/** Tail bound for persisted log reads; matches ExecutorRunner's ring buffer size. */
const MAX_PERSISTED_LOG_LINES = 200;
/** Persisted run attempt IDs are always crypto.randomUUID output (see startRun). */
const RUN_ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Real-world result correlation (Change 023 dogfood finding): executors report
 * their own harness name (e.g. "kimi-code-cli"), which can never equal the
 * user-configured absolute CLI path. Accept the exact configured value, its
 * basename, or a normalized identity match; still reject unrelated harnesses.
 */
export function executorIdentityMatches(configuredCli: string, reportedCli: string): boolean {
  if (reportedCli === configuredCli) return true;
  // Configured CLI values are user-authored Windows or WSL paths. `path.basename`
  // follows the HOST flavour, so on a POSIX host it would return the whole
  // `C:\...\kimi.exe` string and never match a reported harness name. Split on
  // both separators so correlation is identical on every host.
  const configuredStem = (configuredCli.split(/[\\/]/).pop() ?? "")
    .replace(/\.(exe|cmd|bat|ps1)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const reported = reportedCli.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!configuredStem || !reported) return false;
  return reported === configuredStem || reported.includes(configuredStem);
}

export class ExecutorService {
  private readonly repoStore: RepositoryStore;
  private readonly dispatchStore: DispatchStore;
  private readonly executorStore: ExecutorStore;
  private readonly gitClient: GitClient | null;
  private readonly dataDir: string;
  private readonly windowsAdapter: ExecutorAdapter;
  private readonly wslAdapter: ExecutorAdapter;
  private readonly openCodeAdapter?: OpenCodeAdapter;
  private readonly executorWatchdogMs: number;
  private readonly runPolicyStore?: RunPolicyStore;
  private readonly usageTelemetryService?: UsageTelemetryService;
  private readonly onExecutorCompleted?: (
    repositoryId: string,
    dispatchId: string,
    result: ExecutorResult | null
  ) => void | Promise<void>;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;
  private readonly ownership?: ExecutorOwnershipDeps;
  private readonly transition?: OrchestrationTransitionService;
  private readonly logRotator: LogRotator;

  private readonly activeRunners = new Map<string, ExecutorRunner>();
  /** Runners registered from creation until their first successful spawn; closes the launch-retry escape window. */
  private readonly pendingRunners = new Map<string, { runner: ExecutorRunner; runAttemptId: string }>();
  /** Set by shutdown(); aborts in-flight launches and refuses new runs. */
  private shuttingDown = false;
  /** Repositories with a startRun call still inside async setup; closed the concurrent-start TOCTOU window. */
  private readonly startingRepositories = new Set<string>();

  constructor(options: ExecutorServiceOptions) {
    this.repoStore = options.repoStore;
    this.dispatchStore = options.dispatchStore;
    this.executorStore = options.executorStore;
    this.gitClient = options.gitClient ?? null;
    this.dataDir = options.dataDir || path.resolve(".orca-data");
    this.windowsAdapter = options.windowsAdapter || new WindowsPowerShellAdapter();
    this.wslAdapter = options.wslAdapter || new WslAdapter();
    this.openCodeAdapter = options.openCodeAdapter;
    this.executorWatchdogMs = options.executorWatchdogMs ?? 0;
    this.runPolicyStore = options.runPolicyStore;
    this.usageTelemetryService = options.usageTelemetryService;
    this.onExecutorCompleted = options.onExecutorCompleted;
    this.eventPublisher = options.eventPublisher;
    this.ownership = options.ownership;
    this.transition = options.transition;
    this.logRotator = new LogRotator(this.dataDir);
  }

  async startRun(
    repositoryId: string,
    dispatchId: string,
    options: ExecutorStartOptions = {}
  ): Promise<ExecutorRunRecord> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) {
      throw new RepositoryNotFoundError(`Repository ${repositoryId} not found`);
    }

    if (this.shuttingDown) {
      throw new ValidationError(`ExecutorService is shutting down; refusing new run for repository ${repositoryId}`);
    }

    // Synchronous check-and-set before any await: two overlapping starts must
    // not both pass the runner guards below while neither has registered its
    // runner yet (concurrent-start TOCTOU closure).
    if (this.startingRepositories.has(repositoryId)) {
      throw new ValidationError(`Executor start already in progress for repository ${repositoryId}`);
    }
    this.startingRepositories.add(repositoryId);
    try {
      return await this.launchRun(repositoryId, dispatchId, repo, options);
    } finally {
      this.startingRepositories.delete(repositoryId);
    }
  }

  /** Launch one executor run; caller owns the per-repository start-intent guard. */
  private async launchRun(
    repositoryId: string,
    dispatchId: string,
    repo: RepositoryRecord,
    options: ExecutorStartOptions
  ): Promise<ExecutorRunRecord> {
    if (this.activeRunners.has(repositoryId) || this.pendingRunners.has(repositoryId)) {
      throw new ValidationError(`Executor is already running for repository ${repositoryId}`);
    }

    const dispatch = this.dispatchStore.get(dispatchId);
    if (!dispatch) {
      throw new ValidationError(`Dispatch ${dispatchId} not found`);
    }

    const preflightEvidence = await this.runPreflight(repo);
    const policy: PhaseBudgetPolicy | null = this.runPolicyStore?.get(dispatch.runId) ?? null;

    const now = new Date().toISOString();
    const runAttemptId = crypto.randomUUID();
    const logPath = path.join(this.dataDir, "logs", repositoryId, `${runAttemptId}.log`);

    const runRecord: ExecutorRunRecord = {
      id: runAttemptId,
      repositoryId,
      dispatchId,
      runId: dispatch.runId,
      iteration: dispatch.iteration,
      status: "running",
      exitCode: null,
      logPath,
      errorMessage: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.executorStore.create(runRecord);
    this.publishEvent({
      type: "executor.started",
      at: now,
      repositoryId,
      data: {
        runId: dispatch.runId,
        dispatchId: dispatch.id,
        iteration: dispatch.iteration,
        executorCli: repo.executorCli,
        executorModel: repo.executorModel,
        environment: repo.environment
      }
    });

    const prompt = generateBootstrapPrompt({
      repositoryName: repo.displayName,
      dispatchId: dispatch.id,
      changePath: dispatch.changePath,
      goal: dispatch.goal,
      iteration: dispatch.iteration,
      recovery: options.recovery
    });

    const profile = resolveProfile(repo.executorCli);
    const invocation = buildExecutorInvocation(profile, {
      cli: repo.executorCli,
      model: repo.executorModel,
      prompt,
      environment: repo.environment
    });

    const adapter = profile === "opencode" && this.openCodeAdapter
      ? this.openCodeAdapter
      : repo.environment === "wsl" ? this.wslAdapter : this.windowsAdapter;
    // Change 028 (D5.2): acquire a single durable SINGLE_AGENT actor lease
    // BEFORE the direct executor process is admitted. A live/quarantined prior
    // lease (e.g. from a crashed controller) blocks the new start.
    if (this.ownership) {
      const leaseRes = this.ownership.leaseService.acquire(
        repositoryId,
        this.ownership.controllerInstanceId,
        "SINGLE_AGENT",
        { actorId: runAttemptId, runId: dispatch.runId, iteration: dispatch.iteration }
      );
      if (leaseRes.outcome !== "acquired") {
        throw new ValidationError(
          `Repository ${repositoryId} execution actor is ${leaseRes.outcome} ` +
            `(${leaseRes.reason ?? "unknown"}); refusing start`
        );
      }
      this.ownership.leaseService.bindActor(repositoryId, runAttemptId, {
        runId: dispatch.runId
      });
    }

    let spawnedProcessAttemptId: string | null = null;
    let hasSpawnedProcess = false;

    const runner = new ExecutorRunner({
      adapter,
      context: {
        command: invocation.command,
        args: invocation.args,
        cwd: repo.localPath,
        env: {
          ORCA_RUN_ID: dispatch.runId,
          ORCA_DISPATCH_ID: dispatch.id,
          ORCA_DISPATCH_PATH: `.orca/dispatch/${dispatch.id}.json`,
          ORCA_CHANGE_PATH: dispatch.changePath,
          ORCA_ITERATION: dispatch.iteration.toString(),
          ORCA_EXECUTOR_CLI: repo.executorCli,
          ORCA_EXECUTOR_MODEL: repo.executorModel,
          ORCA_ENVIRONMENT: repo.environment,
          ORCA_PREFLIGHT_EVIDENCE: JSON.stringify({ dirty: preflightEvidence.dirty, localHead: preflightEvidence.localHead, remoteHead: preflightEvidence.remoteHead, statusSummary: preflightEvidence.statusSummary }),
          // Propagate deterministic harness controls (qualification tier only)
          ...(process.env.ORCA_SLOW_MS ? { ORCA_SLOW_MS: process.env.ORCA_SLOW_MS } : {}),
          ...(process.env.ORCA_HARNESS_STATUS ? { ORCA_HARNESS_STATUS: process.env.ORCA_HARNESS_STATUS } : {}),
          ...(process.env.ORCA_HARNESS_EXIT_CODE ? { ORCA_HARNESS_EXIT_CODE: process.env.ORCA_HARNESS_EXIT_CODE } : {}),
          ...(options.recovery ? { ORCA_RECOVERY: "true" } : {})
        },
        wslDistribution: repo.wslDistribution
      },
      logPath,
      watchdogMs: policy?.executor.watchdogMs ?? this.executorWatchdogMs,
      onLog: (line) => {
        this.publishLog(repositoryId, dispatch.id, line);
      },
      // Change 028 (D4.1/D4.2/D4.6/D4.8): surface PID after real spawn and persist
      // durable process ownership before admission is reported. Every real OS
      // spawn gets a distinct durable attempt identity (D4.8) correlated to the
      // parent run via actorId = runAttemptId. Post-spawn persistence failure
      // is marked so launch retry does not double-spawn (D4.6).
      onSpawn: this.ownership
        ? async (pid: number) => {
            const own = this.ownership!;
            const evidence = own.probe.capture(pid);
            const processAttemptId = crypto.randomUUID();
            spawnedProcessAttemptId = processAttemptId;
            try {
              own.processStore.insert({
                id: processAttemptId,
                controllerInstanceId: own.controllerInstanceId,
                repositoryId,
                runId: dispatch.runId,
                iteration: dispatch.iteration,
                actorId: runAttemptId,
                packetId: null,
                processKind: "DIRECT_EXECUTOR",
                hostPid: pid,
                executableName: evidence.executableName ?? null,
                startMarker: evidence.startMarker ?? null,
                state: "RUNNING"
              });
              hasSpawnedProcess = true;
              own.leaseService.markActive(repositoryId);
            } catch (err) {
              // D4.3: terminate only if identity verified; otherwise quarantine.
              try {
                own.probe.killVerifiedTree({
                  hostPid: pid,
                  executableName: evidence.executableName,
                  startMarker: evidence.startMarker
                });
              } catch {
                /* best-effort termination */
              }
              own.leaseService.quarantine(
                repositoryId,
                `process ownership persistence failed: ${(err as Error)?.message ?? String(err)}`
              );
              const marked = err as unknown as Error & { __postSpawnPersistenceFailure?: boolean };
              (marked as { __postSpawnPersistenceFailure?: boolean }).__postSpawnPersistenceFailure = true;
              throw marked;
            }
          }
        : undefined,
      onExit: (exitCode, details) => {
        let finalStatus: "completed" | "failed" | "timed_out" | "paused" | "killed" = "completed";
        let errorMessage: string | null = null;
        try {
          this.activeRunners.delete(repositoryId);
          this.pendingRunners.delete(repositoryId);
          // Change 028 (D4.4): persist terminal process state before releasing
          // the repository actor lease so a concurrent start cannot acquire the
          // lease in the intermediate window.
          if (this.ownership) {
            try {
              let rec: { id: string } | null = null;
              if (spawnedProcessAttemptId) {
                const byId = this.ownership.processStore.listByRepository(repositoryId).find((r) => r.id === spawnedProcessAttemptId);
                if (byId) rec = byId;
              }
              if (!rec) {
                const fallback = this.ownership.processStore
                  .listByRepository(repositoryId)
                  .find((r) => r.actorId === runAttemptId);
                if (fallback) rec = fallback;
              }
              if (rec) {
                const terminal =
                  details.wasKilled || details.reason === "EMERGENCY_KILLED"
                    ? "KILL_CONFIRMED"
                    : "EXITED";
                this.ownership.processStore.setState(rec.id, terminal);
              }
              this.ownership.leaseService.release(
                repositoryId,
                this.ownership.controllerInstanceId
              );
            } catch (err) {
              console.warn("[ExecutorService] ownership teardown failed:", err);
            }
          }
          const finishedAt = new Date().toISOString();

          // First-class exit reasons: PAUSED must not become RECOVERY_REQUIRED (item #5).
          if (details.reason === "PAUSED" || details.wasPaused) {
            finalStatus = "paused";
          } else if (details.reason === "EMERGENCY_KILLED" || details.wasKilled) {
            finalStatus = "killed";
          } else if (details.reason === "WATCHDOG_TIMEOUT" || details.timedOut) {
            finalStatus = "timed_out";
            errorMessage = "Executor watchdog timeout";
            this.publishEvent({
              type: "budget.expired",
              at: finishedAt,
              repositoryId,
              data: {
                runId: dispatch.runId,
                dispatchId: dispatch.id,
                iteration: dispatch.iteration,
                failureReason: "EXECUTOR_WATCHDOG_TIMEOUT",
                reason: "EXECUTOR_WATCHDOG_TIMEOUT",
                phase: "EXECUTOR_ACTIVITY"
              }
            });
          } else if (exitCode !== null && exitCode !== 0) {
            // Nonzero exit is not authoritative – still attempt result validation (item #7).
            // Keep failed status for now; result validation may still surface a FAILED/BLOCKED manifest.
            finalStatus = "failed";
            errorMessage = `Executor process exited with non-zero code ${exitCode}`;
          }

          this.executorStore.updateStatus(runAttemptId, finalStatus, {
            exitCode,
            errorMessage,
            finishedAt
          });

          // Bound per-run log retention: prune oldest persisted run logs after each completion.
          try {
            this.logRotator.pruneLogs(repositoryId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.publishLog(repositoryId, dispatch.id, `[system] Log pruning failed: ${msg}`);
          }
        } catch (err) {
          // Teardown-order safety (same contract as the Fix #11 guards): an exit
          // delivered after controller/DB teardown must never escalate into an
          // unhandled exception inside the child's exit emitter.
          console.warn("[ExecutorService] Post-exit handling failed:", err);
        }

        // PAUSED persists any result but does NOT wake Sol or trigger the
        // RECOVERY_REQUIRED path (LoopService owns resume); every other reason
        // flows through the same result-contract completion handler. Async
        // failures surface via reportCompletionFailure instead of stalling silent.
        this.handleTurnCompletion(repositoryId, dispatchId, finalStatus, details, exitCode, adapter, runAttemptId)
          .catch((err) => this.reportCompletionFailure(repositoryId, dispatch.id, finalStatus, err));
      }
    });

    // Register intent BEFORE the first spawn attempt: a kill sweep arriving
    // during the launch-retry window (attempts sleep up to 3s) must still find
    // this runner and terminate it instead of orphaning the spawned child.
    this.pendingRunners.set(repositoryId, { runner, runAttemptId });

    const launchAttempts = policy?.executor.launchAttempts ?? MAX_LAUNCH_ATTEMPTS;
    let started = false;
    try {
      started = await this.launchWithRetry(repo, runner, launchAttempts);
    } catch (err) {
      const maybePost = err as unknown as { __postSpawnPersistenceFailure?: unknown };
      const isPostSpawn = maybePost !== null && typeof maybePost === "object" && "__postSpawnPersistenceFailure" in maybePost && maybePost.__postSpawnPersistenceFailure === true;
      if (isPostSpawn) {
        this.activeRunners.delete(repositoryId);
        this.pendingRunners.delete(repositoryId);
        const msg = err instanceof Error ? err.message : String(err);
        this.executorStore.updateStatus(runAttemptId, "failed", {
          errorMessage: `Executor ownership persistence failed: ${msg}`,
          finishedAt: new Date().toISOString()
        });
        throw new ValidationError(`Executor ownership persistence failed for repository ${repositoryId}: ${msg}`);
      }
      throw err;
    }
    if (!started) {
      this.activeRunners.delete(repositoryId);
      this.pendingRunners.delete(repositoryId);
      this.executorStore.updateStatus(runAttemptId, "failed", {
        errorMessage: `Executor failed to start after ${launchAttempts} attempts (contact/launch unavailable).`,
        finishedAt: new Date().toISOString()
      });
      // Change 028 (D4.9): if all attempts failed before any real child was
      // admitted, release the STARTING lease so the repository is not
      // stranded. If any attempt crossed real spawn without proven termination,
      // quarantine instead of releasing (the onSpawn path already quarantined
      // post-spawn persistence failures, but this covers ambiguous cases).
      if (this.ownership) {
        if (hasSpawnedProcess || spawnedProcessAttemptId !== null) {
          this.ownership.leaseService.quarantine(repositoryId, "launch failed after real spawn without proven termination");
        } else {
          const procs = this.ownership.processStore.listByActor(runAttemptId);
          if (procs.length === 0) {
            try {
              this.ownership.leaseService.release(repositoryId, this.ownership.controllerInstanceId);
            } catch {
              // best-effort release
            }
          } else {
            this.ownership.leaseService.quarantine(repositoryId, "launch failed with ambiguous process state");
          }
        }
      }
      throw new ValidationError(
        `Executor failed to start for repository ${repositoryId} after ${launchAttempts} attempts`
      );
    }

    this.activeRunners.set(repositoryId, runner);
    // First spawn succeeded: the runner graduates out of the pending intent map
    // (see registration invariant above); leaving it tracked would make the
    // pause->resume re-dispatch hit the already-running guard below.
    this.pendingRunners.delete(repositoryId);
    return runRecord;
  }
  private async launchWithRetry(
    repo: RepositoryRecord,
    runner: ExecutorRunner,
    maxAttempts = MAX_LAUNCH_ATTEMPTS
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Abort between attempts: controller shutdown or an emergency kill must
      // never be followed by another spawn of this runner.
      if (this.shuttingDown || runner.killRequested()) {
        this.publishEvent({
          type: "executor.log",
          at: new Date().toISOString(),
          repositoryId: repo.id,
          data: {
            logMessage: `[system] Launch sequence aborted before attempt ${attempt}/${maxAttempts}: ${this.shuttingDown ? "controller shutdown" : "emergency kill"}`
          }
        });
        return false;
      }
      try {
        await runner.start();
        return true;
      } catch (err) {
        const maybePost = err as unknown as { __postSpawnPersistenceFailure?: unknown };
        const isPostSpawn = maybePost !== null && typeof maybePost === "object" && "__postSpawnPersistenceFailure" in maybePost && maybePost.__postSpawnPersistenceFailure === true;
        if (isPostSpawn) {
          const message = err instanceof Error ? err.message : String(err);
          this.publishEvent({
            type: "executor.log",
            at: new Date().toISOString(),
            repositoryId: repo.id,
            data: {
              logMessage: `[system] Post-spawn ownership persistence failed; aborting launch sequence without retry (quarantined): ${message}`
            }
          });
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) {
          this.publishEvent({
            type: "executor.log",
            at: new Date().toISOString(),
            repositoryId: repo.id,
            data: {
              logMessage: `[system] Launch attempt ${attempt}/${maxAttempts} failed: ${message}; retrying`
            }
          });
          await new Promise<void>((resolve) =>
            setTimeout(resolve, LAUNCH_RETRY_BASE_MS * attempt)
          );
          continue;
        }
        this.publishEvent({
          type: "executor.log",
          at: new Date().toISOString(),
          repositoryId: repo.id,
          data: {
            logMessage: `[system] Launch failed after ${maxAttempts} attempts: ${message}`
          }
        });
        return false;
      }
    }
    return false;
  }

  /**
   * Result-contract handling (E) + postflight (F).
   * A process exit 0 with no valid committed result manifest is INVALID, not success.
   * Item #7: nonzero exit does NOT discard a valid BLOCKED/NEEDS_HUMAN/FAILED manifest.
   */
  private async handleTurnCompletion(
    repositoryId: string,
    dispatchId: string,
    finalStatus: "completed" | "failed" | "timed_out" | "paused" | "killed",
    _details: { timedOut: boolean; wasKilled: boolean; wasPaused: boolean; reason?: string },
    exitCode?: number | null,
    adapter?: ExecutorAdapter,
    executorRunId?: string
  ): Promise<void> {
    // PAUSED is not an error completion path – just persist if present, do not trigger recovery.
    if (finalStatus === "paused") {
      const persisted = this.gitClient ? await this.readAndValidateResult(repositoryId, dispatchId) : null;
      if (persisted) this.dispatchStore.updateStatus(dispatchId, "consumed");
      // Do not call onExecutorCompleted for PAUSED – LoopService will handle via pauseRun state.
      return;
    }

    // For any ordinary exit (including nonzero), inspect for a valid durable manifest when safe.
    let result: ExecutorResult | null = null;
    const shouldInspect = this.gitClient && (finalStatus === "completed" || finalStatus === "failed");
    if (shouldInspect) {
      result = await this.readAndValidateResult(repositoryId, dispatchId, { exitCode });
    } else if (finalStatus === "timed_out" || finalStatus === "killed") {
      result = null;
    }

    if (result) {
      // Change 028 (D10.1): when a durable transition processor is wired, the
      // dispatch is consumed atomically with the run transition by the loop's
      // transition processor (see LoopService.applyIterationCompletion). Do NOT
      // consume it here, or a crash could strand a consumed dispatch whose run
      // transition never applied.
      if (!this.transition) {
        // Mark consumed only when a valid, committed result exists (E).
        this.dispatchStore.updateStatus(dispatchId, "consumed");
      }
    }

    const completionDispatch = this.dispatchStore.get(dispatchId);
    this.publishEvent({
      type: "executor.completed",
      at: new Date().toISOString(),
      repositoryId,
      data: {
        runId: completionDispatch?.runId,
        dispatchId,
        iteration: completionDispatch?.iteration,
        resultStatus: result?.status ?? null,
        resultSha: result?.resultSha ?? null,
        summary: result?.summary ?? null,
        failureReason: result ? undefined : "INVALID_OR_INCOMPLETE_RESULT"
      }
    });

    if (adapter && executorRunId && this.usageTelemetryService) {
      const repo = this.repoStore.get(repositoryId);
      const dispatch = this.dispatchStore.get(dispatchId);
      if (repo && dispatch) {
        await this.usageTelemetryService.captureAdapterUsage(adapter, {
          repositoryId,
          runId: dispatch.runId,
          iteration: dispatch.iteration,
          dispatchId,
          executorRunId,
          executor: repo.executorCli,
          model: repo.executorModel
        });
      }
    }

    if (this.onExecutorCompleted) {
      try {
        await this.onExecutorCompleted(repositoryId, dispatchId, result);
      } catch (err) {
        this.reportCompletionFailure(repositoryId, dispatchId, "COMPLETED", err);
      }
    }
  }

  /** Surface swallowed completion failures (e.g., DB teardown) on the executor.log bus. */
  private reportCompletionFailure(
    repositoryId: string,
    dispatchId: string,
    finalStatus: string,
    err: any
  ): void {
    const message = err?.message || String(err);
    this.publishLog(
      repositoryId,
      dispatchId,
      `[system] Turn completion handling failed (${finalStatus}): ${message}`
    );
  }

  /** Read, validate, and postflight-verify the durable result manifest (E/F, item #6/#7). */
  private async readAndValidateResult(
    repositoryId: string,
    dispatchId: string,
    _opts: { exitCode?: number | null } = {}
  ): Promise<ExecutorResult | null> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo || !this.gitClient) return null;

    const dispatch = this.dispatchStore.get(dispatchId);
    if (!dispatch) return null;

    const ctx: GitContext =
      repo.environment === "wsl"
        ? {
            environment: "wsl",
            workingPath: repo.localPath,
            linuxPath: toWslPath(repo.localPath),
            wslDistribution: repo.wslDistribution
          }
        : { environment: "windows", workingPath: repo.localPath };

    const resultPath = `.orca/results/${dispatchId}.json`;
    if (!isResultFilePath(resultPath)) return null;

    let raw: string;
    try {
      raw = await this.gitClient.readWorkingTreeFile(ctx, resultPath);
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    let validated: ExecutorResult;
    try {
      validated = validateExecutorResult(parsed);
    } catch {
      return null;
    }

    // Item #6 hard checks: exact correlation required.
    // baseSha: dispatch.baseSha is the parent of the dispatch commit; harness captures baseSha
    // as current HEAD before work (i.e., the dispatch commit SHA itself). Accept either to
    // enforce dispatch correlation without brittle mismatch while still preventing cross-dispatch reuse.
    if (validated.dispatchId !== dispatch.id) return null;
    if (validated.runId !== dispatch.runId) return null;
    if (validated.iteration !== dispatch.iteration) return null;
    if (validated.baseSha !== dispatch.baseSha && validated.baseSha !== dispatch.commitSha) return null;
    if (!executorIdentityMatches(repo.executorCli, validated.executor.cli)) return null;
    if (validated.executor.model !== repo.executorModel) return null;
    if (validated.executor.environment !== repo.environment) return null;

    // Postflight (F): resultSha ancestry, manifest committed, remote reached.
    const head = await this.gitClient.getCurrentSha(ctx);
    if (!head) return null;
    const headOk = head === validated.resultSha || (await this.gitClient.isAncestor(validated.resultSha, head, ctx));
    if (!headOk) return null;
    // Manifest itself must be committed (not just working tree).
    try {
      await this.gitClient.getFileContentAtCommit(ctx, head, resultPath);
    } catch {
      return null;
    }
    // Remote verification: if remote is reachable, require resultSha ancestry in remote main.
    // Do NOT silently accept local-only proof when remote verification is possible but failed (item #6).
    // Transient network blips (observed in real dogfood, 2026-08-23) retry once before surfacing
    // RECOVERY_REQUIRED; final failure semantics are unchanged — never local-only acceptance.
    const remoteUrl = repo.environment === "wsl" ? toWslPath(repo.githubRemote) : repo.githubRemote;
    const POSTFLIGHT_REMOTE_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= POSTFLIGHT_REMOTE_ATTEMPTS; attempt++) {
      try {
        await this.gitClient.fetch(ctx, "origin", "main");
        const remoteHead = await this.gitClient.getRemoteHeadSha(remoteUrl, "main", ctx);
        if (remoteHead) {
          const remoteOk =
            remoteHead === validated.resultSha ||
            (await this.gitClient.isAncestor(validated.resultSha, remoteHead, ctx));
          const manifestOnRemoteOk = await this.gitClient.isAncestor(head, remoteHead, ctx).catch(() => false);
          if (!remoteOk || !manifestOnRemoteOk) return null;
        }
        // remoteHead === null => no remote branch yet (test repo without origin); accept local proof.
        break;
      } catch {
        if (attempt < POSTFLIGHT_REMOTE_ATTEMPTS) {
          this.publishEvent({
            type: "executor.log",
            at: new Date().toISOString(),
            repositoryId,
            data: { logMessage: `[postflight] transient remote verification failure (attempt ${attempt}/${POSTFLIGHT_REMOTE_ATTEMPTS}); retrying` }
          });
          await new Promise<void>((resolve) => setTimeout(resolve, POSTFLIGHT_RETRY_BASE_MS));
          continue;
        }
        // Persistent remote failure while git client is present: treat as retryable postflight,
        // not silent local success (item #6). Caller surfaces RECOVERY_REQUIRED and can retry later.
        return null;
      }
    }

    return validated;
  }

  /** Preflight (#15): inspect and record dirty tree / local HEAD / remote HEAD / ahead-behind-diverged; never reset/clean; safe fast-forward/rebase where possible; pass evidence to bootstrap. */
  private async runPreflight(repo: RepositoryRecord): Promise<{ dirty: boolean; localHead: string | null; remoteHead: string | null; statusSummary: string }> {
    if (!this.gitClient) return { dirty: false, localHead: null, remoteHead: null, statusSummary: "no-git-client" };
    const ctx: GitContext =
      repo.environment === "wsl"
        ? { environment: "wsl", workingPath: repo.localPath, linuxPath: toWslPath(repo.localPath), wslDistribution: repo.wslDistribution }
        : { environment: "windows", workingPath: repo.localPath };

    const result: { dirty: boolean; localHead: string | null; remoteHead: string | null; statusSummary: string } = { dirty: false, localHead: null, remoteHead: null, statusSummary: "" };
    try {
      // #12: WSL remote probe must route through WSL git so WSL-only credentials work
      const remoteUrl = repo.environment === "wsl" ? toWslPath(repo.githubRemote) : repo.githubRemote;
      let remoteHead: string | null = null;
      try {
        remoteHead = await this.gitClient.getRemoteHeadSha(remoteUrl, "main", ctx);
      } catch (e: any) {
        this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] remote HEAD probe failed: ${e?.message ?? String(e)}` } });
      }
      result.remoteHead = remoteHead;

      result.localHead = await this.gitClient.getCurrentSha(ctx);
      try { result.dirty = await this.gitClient.hasUncommittedChanges(ctx); } catch {}

      // Fetch so referenced commits exist; never force-fetch or reset.
      try { await this.gitClient.fetch(ctx, "origin", "main"); } catch (err: any) {
        this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] fetch warning: ${err?.message ?? String(err)}` } });
      }

      // Determine relation
      let relation = "unknown";
      if (result.localHead && result.remoteHead) {
        const local = result.localHead;
        const remote = result.remoteHead;
        const isAncestor = await this.gitClient.isAncestor(local, remote, ctx).catch(() => false);
        const remoteIsAncestor = await this.gitClient.isAncestor(remote, local, ctx).catch(() => false);
        if (local === remote) relation = "up-to-date";
        else if (remoteIsAncestor) relation = "ahead";
        else if (isAncestor) relation = "behind (fast-forwardable)";
        else relation = "diverged";
      } else if (result.localHead) relation = "no-remote";
      else relation = "no-local-head";

      result.statusSummary = `dirty=${result.dirty} local=${result.localHead?.slice(0, 7) ?? "none"} remote=${result.remoteHead?.slice(0, 7) ?? "none"} relation=${relation}`;
      // Attempt safe fast-forward/rebase only if clean and behind; if dirty or diverged, leave to executor (evidence passed via env)
      if (!result.dirty && relation === "behind (fast-forwardable)") {
        try {
          await this.gitClient.fetch(ctx, "origin", "main");
          this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] fast-forwardable: ${result.statusSummary}` } });
        } catch {}
      } else if (relation !== "up-to-date") {
        this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] ${result.statusSummary}` } });
      }

      return result;
    } catch (err: any) {
      this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] inspection failed: ${err?.message ?? String(err)}` } });
      return result;
    }
  }

  async pauseRun(repositoryId: string): Promise<void> {
    const runner = this.activeRunners.get(repositoryId);
    if (!runner) return;

    await runner.pause();
    this.activeRunners.delete(repositoryId);

    const activeRun = this.executorStore.getActiveRun(repositoryId);
    if (activeRun) {
      this.executorStore.updateStatus(activeRun.id, "paused", {
        finishedAt: new Date().toISOString()
      });
    }
  }

  async killRun(repositoryId: string): Promise<void> {
    const runner = this.activeRunners.get(repositoryId) ?? this.pendingRunners.get(repositoryId)?.runner;
    if (!runner) return;

    await runner.kill();
    this.activeRunners.delete(repositoryId);
    this.pendingRunners.delete(repositoryId);

    const activeRun = this.executorStore.getActiveRun(repositoryId);
    if (activeRun) {
      this.executorStore.updateStatus(activeRun.id, "killed", {
        finishedAt: new Date().toISOString()
      });
    }
  }

  /**
   * Controller-side kill sweep covering BOTH live runners and runners still in
   * their launch-retry window. A runner that only registered intent (no child
   * spawned yet) is aborted via its kill flag so no later retry spawns; a live
   * child dies through the adapter's bounded process-tree kill. Resolves once
   * every kill completed; late onExit callbacks stay safe against closed stores
   * via the post-exit teardown guard.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    const targets = new Map<string, ExecutorRunner>();
    for (const [repositoryId, pending] of this.pendingRunners) {
      targets.set(repositoryId, pending.runner);
    }
    for (const [repositoryId, runner] of this.activeRunners) {
      targets.set(repositoryId, runner);
    }

    await Promise.all(
      [...targets].map(([repositoryId, runner]) =>
        runner.kill().catch((err: any) => {
          // One failed kill must not abort the sweep; surface and continue.
          console.warn(
            `[ExecutorService] Shutdown kill failed for repository ${repositoryId}:`,
            err?.message || String(err)
          );
        })
      )
    );
  }

  getStatus(repositoryId: string): ExecutorStatusResponse {
    const isRunning = this.activeRunners.has(repositoryId) || this.pendingRunners.has(repositoryId);
    const activeRun = this.executorStore.getActiveRun(repositoryId);
    const runner = this.activeRunners.get(repositoryId);
    const recentLogs = runner ? runner.getLogs() : [];

    return {
      repositoryId,
      isRunning,
      activeRun,
      recentLogs
    };
  }

  getLogs(repositoryId: string, runAttemptId?: string): string[] {
    const runner = this.activeRunners.get(repositoryId);
    if (runner) return runner.getLogs();
    return this.readPersistedLogTail(repositoryId, runAttemptId);
  }

  /** Serve a bounded tail of a persisted per-run log (latest by default) when no runner is active. */
  private readPersistedLogTail(repositoryId: string, runAttemptId?: string): string[] {
    const repoLogDir = path.join(this.dataDir, "logs", repositoryId);
    // runAttemptId is a raw query param on a tailnet-published origin, so it
    // crosses the trust boundary: reject anything that is not a
    // crypto.randomUUID-shaped ID before any filesystem access.
    if (runAttemptId && !RUN_ATTEMPT_ID_PATTERN.test(runAttemptId)) {
      throw new ValidationError("runAttemptId must be a UUID.");
    }
    const requestedPath =
      runAttemptId != null ? path.join(repoLogDir, `${runAttemptId}.log`) : null;
    // Defense in depth: the resolved log must stay inside this repo's log dir.
    if (
      requestedPath &&
      !path.resolve(requestedPath).startsWith(path.resolve(repoLogDir) + path.sep)
    ) {
      throw new ValidationError("runAttemptId must not escape the repository log directory.");
    }
    try {
      const logPath = requestedPath ?? this.latestPersistedLog(repoLogDir);
      if (!logPath || !fs.existsSync(logPath)) return [];
      const lines = fs.readFileSync(logPath, "utf8").split("\n");
      while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      return lines.slice(-MAX_PERSISTED_LOG_LINES);
    } catch {
      return [];
    }
  }

  private latestPersistedLog(repoLogDir: string): string | null {
    let latest: { fullPath: string; mtimeMs: number } | null = null;
    for (const file of fs.readdirSync(repoLogDir)) {
      if (!file.endsWith(".log")) continue;
      const fullPath = path.join(repoLogDir, file);
      const mtimeMs = fs.statSync(fullPath).mtimeMs;
      if (!latest || mtimeMs > latest.mtimeMs) latest = { fullPath, mtimeMs };
    }
    return latest?.fullPath ?? null;
  }

  private publishLog(repositoryId: string, dispatchId: string, line: string): void {
    this.publishEvent({
      type: "executor.log",
      at: new Date().toISOString(),
      repositoryId,
      data: { logMessage: line, dispatchId }
    });
  }

  private publishEvent(event: RepositoryMutationEvent): void {
    if (this.eventPublisher) {
      try {
        this.eventPublisher(event);
      } catch (err) {
        console.warn("[ExecutorService] Failed to publish event:", err);
      }
    }
  }
}

import type {
  RepositoryRecord,
  RepositoryMutationEvent,
  WatcherStatusResponse,
  DispatchRecord,
  SolControlDecision
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "./dispatch-store.js";
import type { SolControlStore } from "./sol-control-store.js";
import type { GitClient, GitContext } from "./git-client.js";
import type { CommitInspector, CommitInspectionResult } from "./commit-inspector.js";
import { toWslPath } from "../wsl-path.js";

export interface WatcherServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore: DispatchStore;
  solControlStore: SolControlStore;
  gitClient: GitClient;
  commitInspector: CommitInspector;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
  pollIntervalMs?: number;
  onDispatchDetected?: (repositoryId: string, dispatchId: string) => void;
  onControlDetected?: (
    repositoryId: string,
    controlId: string,
    decision: SolControlDecision,
    runId: string
  ) => void;
}

export class WatcherService {
  private readonly repoStore: RepositoryStore;
  private readonly dispatchStore: DispatchStore;
  private readonly solControlStore: SolControlStore;
  private readonly gitClient: GitClient;
  private readonly commitInspector: CommitInspector;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;
  private readonly pollIntervalMs: number;
  private readonly onDispatchDetected?: (repositoryId: string, dispatchId: string) => void;
  private readonly onControlDetected?: (
    repositoryId: string,
    controlId: string,
    decision: SolControlDecision,
    runId: string
  ) => void;

  private readonly activeTimers = new Map<string, NodeJS.Timeout>();
  private readonly inFlightPolls = new Set<string>();
  private isRunning = false;

  constructor(options: WatcherServiceOptions) {
    this.repoStore = options.repoStore;
    this.dispatchStore = options.dispatchStore;
    this.solControlStore = options.solControlStore;
    this.gitClient = options.gitClient;
    this.commitInspector = options.commitInspector;
    this.eventPublisher = options.eventPublisher;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.onDispatchDetected = options.onDispatchDetected;
    this.onControlDetected = options.onControlDetected;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    for (const repo of this.repoStore.list()) {
      if (repo.enabled) {
        this.startWatchingRepo(repo.id);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    for (const [repoId, timer] of this.activeTimers.entries()) {
      clearInterval(timer);
      this.activeTimers.delete(repoId);
    }
    this.inFlightPolls.clear();
  }

  startWatchingRepo(repositoryId: string): void {
    if (this.activeTimers.has(repositoryId)) return;

    const timer = setInterval(() => {
      this.pollRepository(repositoryId).catch(() => {});
    }, this.pollIntervalMs);

    this.activeTimers.set(repositoryId, timer);
  }

  stopWatchingRepo(repositoryId: string): void {
    const timer = this.activeTimers.get(repositoryId);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(repositoryId);
    }
  }

  /** Begin or stop watching a repository in response to config changes. */
  reconcileWatchingForRepository(repositoryId: string): void {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) {
      this.stopWatchingRepo(repositoryId);
      return;
    }
    if (repo.enabled) {
      this.startWatchingRepo(repositoryId);
    } else {
      this.stopWatchingRepo(repositoryId);
    }
  }

  async pollRepository(repositoryId: string): Promise<void> {
    if (this.inFlightPolls.has(repositoryId)) {
      return; // Skip overlapping poll
    }

    this.inFlightPolls.add(repositoryId);
    try {
      const repo = this.repoStore.get(repositoryId);
      if (!repo) {
        this.stopWatchingRepo(repositoryId);
        return;
      }

      await this.executePollCycle(repo);
    } finally {
      this.inFlightPolls.delete(repositoryId);
    }
  }

  private buildGitContext(repo: RepositoryRecord): GitContext {
    return repo.environment === "wsl"
      ? {
          environment: "wsl",
          workingPath: repo.localPath,
          linuxPath: toWslPath(repo.localPath),
          wslDistribution: repo.wslDistribution
        }
      : { environment: "windows", workingPath: repo.localPath };
  }

  private async executePollCycle(repo: RepositoryRecord): Promise<void> {
    const now = new Date().toISOString();
    const currentState = this.dispatchStore.getWatcherState(repo.id);
    const lastObservedSha = currentState?.lastObservedSha ?? null;
    const ctx = this.buildGitContext(repo);

    let remoteHeadSha: string | null = null;
    try {
      remoteHeadSha = await this.gitClient.getRemoteHeadSha(repo.githubRemote, "main");
    } catch (err: any) {
      const errorMsg = err.message || "Failed to query remote HEAD";
      this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastPolledAt: now,
        lastError: errorMsg
      });
      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: { reason: errorMsg }
      });
      return;
    }

    if (!remoteHeadSha) {
      this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastPolledAt: now,
        lastError: "Remote branch 'main' not found"
      });
      return;
    }

    if (remoteHeadSha === lastObservedSha) {
      this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastPolledAt: now,
        lastError: null
      });
      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: {}
      });
      return;
    }

    // Remote HEAD moved. Fetch so every referenced commit object exists locally,
    // then walk EVERY unseen commit from lastObservedSha..remoteHeadSha in order.
    try {
      await this.gitClient.fetch(ctx, "origin", "main");
    } catch (err: any) {
      const errorMsg = `Fetch failed: ${err.message}`;
      this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastPolledAt: now,
        lastError: errorMsg
      });
      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: { reason: errorMsg }
      });
      return;
    }

    let commitsToInspect: string[];
    if (lastObservedSha === null) {
      commitsToInspect = [remoteHeadSha];
    } else {
      try {
        commitsToInspect = await this.gitClient.getRevList(ctx, lastObservedSha, remoteHeadSha);
      } catch (err: any) {
        const errorMsg = `rev-list failed: ${err.message}`;
        this.dispatchStore.upsertWatcherState({
          repositoryId: repo.id,
          lastPolledAt: now,
          lastError: errorMsg
        });
        this.publishEvent({
          type: "watcher.poll_completed",
          at: now,
          repositoryId: repo.id,
          data: { reason: errorMsg }
        });
        return;
      }
      if (commitsToInspect.length === 0) {
        // Nothing new to inspect (e.g. HEAD moved but no new commits); advance safely.
        this.dispatchStore.upsertWatcherState({
          repositoryId: repo.id,
          lastObservedSha: remoteHeadSha,
          lastPolledAt: now,
          lastError: null
        });
        this.publishEvent({
          type: "watcher.poll_completed",
          at: now,
          repositoryId: repo.id,
          data: {}
        });
        return;
      }
    }

    // Walk commits chronologically. Do NOT advance lastObservedSha past a commit
    // that cannot be safely inspected; record an actionable error instead.
    let advancedTo: string | null = lastObservedSha;
    try {
      for (const sha of commitsToInspect) {
        const inspection = await this.commitInspector.inspectCommit(ctx, sha);
        await this.handleInspection(repo, sha, inspection);
        advancedTo = sha;
      }
    } catch (err: any) {
      const errorMsg = `Commit inspection error for ${advancedTo ?? "initial"}..${remoteHeadSha}: ${err.message}`;
      this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastObservedSha: advancedTo,
        lastPolledAt: now,
        lastError: errorMsg
      });
      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: { reason: errorMsg }
      });
      return;
    }

    const updatedState = this.dispatchStore.upsertWatcherState({
      repositoryId: repo.id,
      lastObservedSha: remoteHeadSha,
      lastPolledAt: now,
      lastError: null
    });

    this.publishEvent({
      type: "watcher.poll_completed",
      at: now,
      repositoryId: repo.id,
      data: { watcherState: updatedState }
    });
  }

  private async handleInspection(
    repo: RepositoryRecord,
    commitSha: string,
    inspection: CommitInspectionResult
  ): Promise<void> {
    const now = new Date().toISOString();

    if (inspection.type === "VALID_DISPATCH") {
      if (!this.dispatchStore.hasDispatch(inspection.dispatchId)) {
        const dispatchRecord: DispatchRecord = {
          id: inspection.dispatchId,
          dispatchId: inspection.dispatchId,
          repositoryId: repo.id,
          runId: inspection.dispatch.runId,
          iteration: inspection.dispatch.iteration,
          commitSha,
          baseSha: inspection.dispatch.baseSha,
          changePath: inspection.dispatch.changePath,
          goal: inspection.dispatch.goal,
          instructionsVersion: inspection.dispatch.instructionsVersion,
          schemaVersion: 1,
          type: "dispatch",
          status: "detected",
          rejectionReason: null,
          createdAt: inspection.dispatch.createdAt,
          updatedAt: now
        };
        this.dispatchStore.create(dispatchRecord);

        this.publishEvent({
          type: "watcher.dispatch_detected",
          at: now,
          repositoryId: repo.id,
          data: { dispatch: dispatchRecord }
        });

        if (this.onDispatchDetected) {
          this.onDispatchDetected(repo.id, inspection.dispatchId);
        }
      }
    } else if (inspection.type === "REJECTED_DISPATCH") {
      const rejectionId =
        inspection.dispatchId || `rejected-${commitSha.slice(0, 8)}-${Date.now()}`;
      if (!this.dispatchStore.hasDispatch(rejectionId)) {
        const rejectedRecord: DispatchRecord = {
          id: rejectionId,
          dispatchId: rejectionId,
          repositoryId: repo.id,
          runId: "unknown",
          iteration: 0,
          commitSha,
          baseSha: commitSha,
          changePath: "",
          goal: "",
          instructionsVersion: 1,
          schemaVersion: 1,
          type: "dispatch",
          status: "rejected",
          rejectionReason: inspection.reason,
          createdAt: now,
          updatedAt: now
        };
        this.dispatchStore.create(rejectedRecord);

        this.publishEvent({
          type: "watcher.dispatch_rejected",
          at: now,
          repositoryId: repo.id,
          data: { dispatch: rejectedRecord, reason: inspection.reason }
        });
      }
    } else if (inspection.type === "SOL_CONTROL") {
      if (!this.solControlStore.hasControl(inspection.controlId)) {
        this.solControlStore.create({
          id: inspection.controlId,
          repositoryId: repo.id,
          runId: inspection.control.runId,
          controlId: inspection.controlId,
          decision: inspection.control.decision,
          iteration: inspection.control.iteration,
          commitSha,
          relatedDispatchId: inspection.control.relatedDispatchId,
          status: "detected",
          rejectionReason: null,
          createdAt: now,
          updatedAt: now
        });

        this.publishEvent({
          type: "watcher.control_detected",
          at: now,
          repositoryId: repo.id,
          data: {
            controlId: inspection.controlId,
            decision: inspection.control.decision,
            runId: inspection.control.runId
          }
        });

        if (this.onControlDetected) {
          this.onControlDetected(
            repo.id,
            inspection.controlId,
            inspection.control.decision,
            inspection.control.runId
          );
        }
      }
    } else if (inspection.type === "REJECTED_SOL_CONTROL") {
      const rejectionId =
        inspection.controlId || `rejected-control-${commitSha.slice(0, 8)}-${Date.now()}`;
      if (!this.solControlStore.hasControl(rejectionId)) {
        this.solControlStore.create({
          id: rejectionId,
          repositoryId: repo.id,
          runId: "unknown",
          controlId: rejectionId,
          decision: "BLOCKED",
          iteration: 0,
          commitSha,
          relatedDispatchId: null,
          status: "rejected",
          rejectionReason: inspection.reason,
          createdAt: now,
          updatedAt: now
        });
      }
    }
  }

  getWatcherStatus(repositoryId: string): WatcherStatusResponse {
    const state = this.dispatchStore.getWatcherState(repositoryId);
    const dispatches = this.dispatchStore.getByRepository(repositoryId);
    const detected = dispatches.find((d) => d.status === "detected");

    return {
      repositoryId,
      isWatching: this.activeTimers.has(repositoryId),
      lastObservedSha: state?.lastObservedSha ?? null,
      lastPolledAt: state?.lastPolledAt ?? null,
      lastError: state?.lastError ?? null,
      activeDispatchId: detected ? detected.id : null
    };
  }

  private publishEvent(event: RepositoryMutationEvent): void {
    if (this.eventPublisher) {
      try {
        this.eventPublisher(event);
      } catch (err) {
        console.warn("[WatcherService] Failed to publish event:", err);
      }
    }
  }
}

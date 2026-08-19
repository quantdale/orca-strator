import type {
  RepositoryRecord,
  RepositoryMutationEvent,
  WatcherStatusResponse,
  DispatchRecord
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "./dispatch-store.js";
import type { GitClient } from "./git-client.js";
import type { CommitInspector } from "./commit-inspector.js";

export interface WatcherServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore: DispatchStore;
  gitClient: GitClient;
  commitInspector: CommitInspector;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
  pollIntervalMs?: number;
}

export class WatcherService {
  private readonly repoStore: RepositoryStore;
  private readonly dispatchStore: DispatchStore;
  private readonly gitClient: GitClient;
  private readonly commitInspector: CommitInspector;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;
  private readonly pollIntervalMs: number;

  private readonly activeTimers = new Map<string, NodeJS.Timeout>();
  private readonly inFlightPolls = new Set<string>();
  private isRunning = false;

  constructor(options: WatcherServiceOptions) {
    this.repoStore = options.repoStore;
    this.dispatchStore = options.dispatchStore;
    this.gitClient = options.gitClient;
    this.commitInspector = options.commitInspector;
    this.eventPublisher = options.eventPublisher;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const repos = this.repoStore.list();
    for (const repo of repos) {
      this.startWatchingRepo(repo.id);
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

  private async executePollCycle(repo: RepositoryRecord): Promise<void> {
    const now = new Date().toISOString();
    const currentState = this.dispatchStore.getWatcherState(repo.id);
    const lastObservedSha = currentState?.lastObservedSha ?? null;

    let remoteHeadSha: string | null = null;
    try {
      remoteHeadSha = await this.gitClient.getRemoteHeadSha(repo.githubRemote, "main");
    } catch (err: any) {
      const errorMsg = err.message || "Failed to query remote HEAD";
      const updatedState = this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastPolledAt: now,
        lastError: errorMsg
      });

      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: { watcherState: updatedState, reason: errorMsg }
      });
      return;
    }

    if (!remoteHeadSha) {
      // Remote branch main does not exist or empty
      this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastPolledAt: now,
        lastError: "Remote branch 'main' not found"
      });
      return;
    }

    // If remote HEAD has not moved and we have seen it before, no-op
    if (lastObservedSha === remoteHeadSha) {
      const updatedState = this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastPolledAt: now,
        lastError: null
      });
      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: { watcherState: updatedState }
      });
      return;
    }

    // Remote HEAD moved or first poll: inspect the commit(s)
    try {
      // If we have a local path for the repository, inspect the commit
      const inspection = await this.commitInspector.inspectCommit(repo.localPath, remoteHeadSha);

      if (inspection.type === "VALID_DISPATCH") {
        let dispatchRecord: DispatchRecord;
        if (!this.dispatchStore.hasDispatch(inspection.dispatchId)) {
          dispatchRecord = {
            id: inspection.dispatchId,
            dispatchId: inspection.dispatchId,
            repositoryId: repo.id,
            runId: inspection.dispatch.runId,
            iteration: inspection.dispatch.iteration,
            commitSha: remoteHeadSha,
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
        }
      } else if (inspection.type === "REJECTED_DISPATCH") {
        const rejectionId = inspection.dispatchId || `rejected-${remoteHeadSha.slice(0, 8)}-${Date.now()}`;
        if (!this.dispatchStore.hasDispatch(rejectionId)) {
          const rejectedRecord: DispatchRecord = {
            id: rejectionId,
            dispatchId: rejectionId,
            repositoryId: repo.id,
            runId: "unknown",
            iteration: 0,
            commitSha: remoteHeadSha,
            baseSha: remoteHeadSha,
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
      }

      const updatedState = this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastObservedSha: remoteHeadSha,
        lastPolledAt: now,
        lastError: inspection.type === "REJECTED_DISPATCH" ? inspection.reason : null
      });

      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: { watcherState: updatedState }
      });
    } catch (err: any) {
      const errorMsg = `Commit inspection error for ${remoteHeadSha}: ${err.message}`;
      const updatedState = this.dispatchStore.upsertWatcherState({
        repositoryId: repo.id,
        lastObservedSha: remoteHeadSha,
        lastPolledAt: now,
        lastError: errorMsg
      });

      this.publishEvent({
        type: "watcher.poll_completed",
        at: now,
        repositoryId: repo.id,
        data: { watcherState: updatedState, reason: errorMsg }
      });
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

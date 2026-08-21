import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  IntegrationReport,
  PublicationEvidence,
  RemoteMainRelation,
  RemotePublishResult,
  RepositoryRecord,
  StrategyExecutionReport,
  WorkPacket,
  WorkPacketResult,
} from "@orca/shared";
import { toWslPath } from "../wsl-path.js";
import type { WorkPacketStore } from "./work-packet-store.js";

const execFileAsync = promisify(execFile);

export class IntegrationService {
  /**
   * Change 018 R1#F3: per-repository publish mutex tails. Each publishToRemote
   * call chains onto the tail for its repository; the stored tail swallows
   * rejections so one failed publication never breaks the chain.
   */
  private readonly publishLocks = new Map<string, Promise<void>>();

  constructor(private readonly store: WorkPacketStore) {}

  async integrate(
    repository: RepositoryRecord,
    runId: string,
    iteration: number,
    packets: WorkPacket[],
    inputResults: WorkPacketResult[],
  ): Promise<IntegrationReport> {
    const createdAt = new Date().toISOString();
    const results = new Map(
      inputResults.map((result) => [result.packetId, result]),
    );
    const order = this.topologicalOrder(packets);
    if (order.blocker)
      return this.persist(repository, {
        schemaVersion: 1,
        repositoryId: repository.id,
        runId,
        iteration,
        status: "BLOCKED",
        integratedPacketIds: [],
        results: inputResults,
        finalCommitSha: null,
        blocker: order.blocker,
        createdAt,
      });

    let mainStatus: string;
    try {
      mainStatus = await this.git(
        repository,
        ["status", "--porcelain"],
        repository.localPath,
      );
    } catch (error: any) {
      return this.persist(repository, {
        schemaVersion: 1,
        repositoryId: repository.id,
        runId,
        iteration,
        status: "BLOCKED",
        integratedPacketIds: [],
        results: inputResults,
        finalCommitSha: null,
        blocker: `MAIN_STATUS_UNAVAILABLE: ${error?.message ?? String(error)}`,
        createdAt,
      });
    }
    if (mainStatus.trim()) {
      return this.persist(repository, {
        schemaVersion: 1,
        repositoryId: repository.id,
        runId,
        iteration,
        status: "BLOCKED",
        integratedPacketIds: [],
        results: inputResults,
        finalCommitSha: null,
        blocker:
          "Persistent main checkout is dirty; integration refuses to overwrite user work.",
        createdAt,
      });
    }

    const integratedPacketIds: string[] = [];
    const integratedPaths = new Set<string>();
    let conflict = false;
    for (const packet of order.packets) {
      let result = results.get(packet.packetId);
      const dependencyResults = packet.dependencies.map((dependency) =>
        results.get(dependency),
      );
      const dependencyFailed = dependencyResults.some(
        (candidate) => !candidate || candidate.status !== "COMPLETED",
      );
      if (!result && (dependencyFailed || packet.dependencies.length > 0)) {
        result = this.synthetic(
          packet,
          "SKIPPED_DEPENDENCY",
          "A dependency did not complete successfully.",
        );
        results.set(packet.packetId, result);
        this.store.saveResult(result, repository.id);
        this.store.updateStatus(packet.packetId, "SKIPPED_DEPENDENCY");
      }
      if (!result) {
        result = this.synthetic(
          packet,
          "BLOCKED",
          "No durable worker result was recorded.",
        );
        results.set(packet.packetId, result);
        this.store.saveResult(result, repository.id);
        this.store.updateStatus(packet.packetId, "BLOCKED");
      }
      if (result.status !== "COMPLETED") continue;
      if (
        dependencyResults.some(
          (candidate) =>
            candidate && !integratedPacketIds.includes(candidate.packetId),
        )
      ) {
        const blocked = {
          ...result,
          status: "SKIPPED_DEPENDENCY" as const,
          blocker: "A dependency was not integrated successfully.",
        };
        results.set(packet.packetId, blocked);
        this.store.saveResult(blocked, repository.id);
        this.store.updateStatus(packet.packetId, "SKIPPED_DEPENDENCY");
        continue;
      }
      const overlap = result.filesChanged
        .map((value) => value.replace(/\\/g, "/"))
        .find((value) => integratedPaths.has(value));
      if (overlap) {
        const blocked = {
          ...result,
          status: "INTEGRATION_CONFLICT" as const,
          blocker: `Changed path overlaps an already integrated sibling: ${overlap}`,
        };
        results.set(packet.packetId, blocked);
        this.store.saveResult(blocked, repository.id);
        this.store.updateStatus(packet.packetId, "BLOCKED");
        conflict = true;
        continue;
      }
      if (!result.worktree?.commitSha || !result.worktree.branch) {
        const blocked = {
          ...result,
          status: "BLOCKED" as const,
          blocker: "Completed result has no worktree branch/commit provenance.",
        };
        results.set(packet.packetId, blocked);
        this.store.saveResult(blocked, repository.id);
        this.store.updateStatus(packet.packetId, "BLOCKED");
        continue;
      }
      try {
        const persistedWorktree = this.store.getWorktree(
          result.worktree.worktreeId,
        );
        if (
          !persistedWorktree ||
          persistedWorktree.repositoryId !== repository.id ||
          persistedWorktree.packetId !== packet.packetId ||
          persistedWorktree.branch !== result.worktree.branch
        ) {
          throw new Error(
            "Persisted worktree provenance is missing or mismatched.",
          );
        }
        await this.assertCommitOnBranch(
          repository,
          result.worktree.commitSha,
          result.worktree.branch,
        );
        await this.git(
          repository,
          ["cherry-pick", result.worktree.commitSha],
          repository.localPath,
        );
        integratedPacketIds.push(packet.packetId);
        this.store.updateStatus(packet.packetId, "COMPLETED");
        for (const file of result.filesChanged)
          integratedPaths.add(file.replace(/\\/g, "/"));
      } catch (error: any) {
        try {
          await this.git(
            repository,
            ["cherry-pick", "--abort"],
            repository.localPath,
          );
        } catch {}
        const blocked = {
          ...result,
          status: "INTEGRATION_CONFLICT" as const,
          blocker: `Git integration failed and was aborted: ${error?.message ?? String(error)}`,
        };
        results.set(packet.packetId, blocked);
        this.store.saveResult(blocked, repository.id);
        this.store.updateStatus(packet.packetId, "BLOCKED");
        conflict = true;
      }
    }

    let finalCommitSha: string | null = null;
    try {
      finalCommitSha = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );
    } catch {}
    const finalResults = [...results.values()];
    const hasFailure = finalResults.some((result) =>
      [
        "FAILED",
        "BLOCKED",
        "CANCELLED",
        "SKIPPED",
        "SKIPPED_DEPENDENCY",
      ].includes(result.status),
    );
    const status = conflict
      ? "INTEGRATION_CONFLICT"
      : integratedPacketIds.length === packets.length && !hasFailure
        ? "COMPLETED"
        : integratedPacketIds.length > 0
          ? "PARTIAL"
          : "BLOCKED";
    return this.persist(repository, {
      schemaVersion: 1,
      repositoryId: repository.id,
      runId,
      iteration,
      status,
      integratedPacketIds,
      results: finalResults,
      finalCommitSha,
      blocker: conflict
        ? "One or more worker results could not be integrated without conflict."
        : hasFailure
          ? "Some packet results were not successfully integrated."
          : null,
      createdAt,
    });
  }

  /**
   * Item #6 / #13 / Change 018: make the integrated `main` durable on the
   * remote.
   *
   * Inspects local `main`, fetches remote `main`, classifies the local/remote
   * relation (UP_TO_DATE, LOCAL_AHEAD, REMOTE_AHEAD, DIVERGED), reconciles
   * ordinary non-overlapping advancement BEFORE writing the result manifest,
   * refuses to force-push, and only after a clean push verifies the remote
   * contains the actual final HEAD and the result manifest. The pre-rebase
   * SHAs are historical provenance only; all evidence is anchored at the
   * actual local HEAD resolved immediately before the manifest commit, on
   * every attempt, so a stale integration SHA left behind by an earlier
   * failed attempt's reconciliation can never ship as finalCommitSha.
   */
  async publishToRemote(
    repository: RepositoryRecord,
    runId: string,
    iteration: number,
    dispatchId: string,
    report: StrategyExecutionReport | null,
  ): Promise<RemotePublishResult> {
    // Change 018 R1#F3: overlapping publications against one repository
    // checkout serialize through a per-repository promise-chain mutex (same
    // pattern as SwarmExecutionService.withIntegrationLock) so interleaved
    // fetch/add/commit/push sequences cannot produce mixed manifest commits
    // or index.lock failures. The entire publish body runs under the lock.
    return this.withPublishLock(repository.id, () =>
      this.publishToRemoteLocked(
        repository,
        runId,
        iteration,
        dispatchId,
        report,
      ),
    );
  }

  private async publishToRemoteLocked(
    repository: RepositoryRecord,
    runId: string,
    iteration: number,
    dispatchId: string,
    report: StrategyExecutionReport | null,
  ): Promise<RemotePublishResult> {
    const details: Record<string, unknown> = {};
    const safe = (value: string): string =>
      value.replace(/[^A-Za-z0-9._-]/g, "-");
    try {
      // Defense in depth: the integrate paths already refuse a dirty main,
      // but reconciliation (ff/rebase) and the result commit both require a
      // clean tree, so publish re-checks before touching anything.
      let mainStatus: string;
      try {
        mainStatus = await this.git(
          repository,
          ["status", "--porcelain"],
          repository.localPath,
        );
      } catch (error: any) {
        return {
          status: "BLOCKED",
          pushedSha: null,
          resultSha: null,
          remoteVerified: false,
          blocker: `MAIN_STATUS_UNAVAILABLE: ${error?.message ?? String(error)}`,
          details,
        };
      }
      if (mainStatus.trim()) {
        return {
          status: "BLOCKED",
          pushedSha: null,
          resultSha: null,
          remoteVerified: false,
          blocker:
            "Persistent main checkout is dirty; publish refuses to overwrite user work.",
          details,
        };
      }

      const localHead = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );
      details.localHead = localHead;
      await this.git(repository, ["fetch", "origin"], repository.localPath);
      let remoteHead = "";
      try {
        remoteHead = await this.git(
          repository,
          ["rev-parse", "origin/main"],
          repository.localPath,
        );
      } catch {
        remoteHead = "";
      }
      details.remoteHead = remoteHead;

      // Classify how local main relates to origin/main (Change 018 R1).
      let relation: RemoteMainRelation;
      if (!remoteHead || remoteHead === localHead) {
        relation = "UP_TO_DATE";
      } else if (await this.isAncestor(repository, localHead, remoteHead)) {
        // Local is strictly behind: remote advanced while we integrated.
        relation = "REMOTE_AHEAD";
      } else if (await this.isAncestor(repository, remoteHead, localHead)) {
        relation = "LOCAL_AHEAD";
      } else {
        relation = "DIVERGED";
      }
      details.relation = relation;

      // Reconcile BEFORE writing the result manifest so the manifest commit
      // lands on the advanced main, never on a stale branch.
      let reconciled = false;
      if (relation === "REMOTE_AHEAD") {
        // Local is strictly behind remote main: fast-forward is the safe
        // replay. If ff-only is unexpectedly impossible, fall back to rebase.
        const fastForwarded = await this.git(
          repository,
          ["merge", "--ff-only", "origin/main"],
          repository.localPath,
        )
          .then(() => true)
          .catch(() => false);
        if (!fastForwarded) {
          const rebased = await this.rebaseOntoRemoteMain(repository);
          if (!rebased.ok)
            return {
              status: "BLOCKED",
              pushedSha: null,
              resultSha: null,
              remoteVerified: false,
              blocker: `Unsafe remote advancement: cannot fast-forward or rebase local main onto remote main. ${rebased.error}`,
              details,
            };
        }
        reconciled = true;
      } else if (relation === "DIVERGED") {
        // Neither side contains the other: replay local integrated commits on
        // top of remote main; conflicts abort to a structured blocker.
        const rebased = await this.rebaseOntoRemoteMain(repository);
        if (!rebased.ok)
          return {
            status: "BLOCKED",
            pushedSha: null,
            resultSha: null,
            remoteVerified: false,
            blocker: `Unsafe remote advancement: cannot reconcile local main with remote main. ${rebased.error}`,
            details,
          };
        reconciled = true;
      }
      details.reconciled = reconciled;

      // SHA truth (Change 018 R2 / audit H1): after any reconciliation the
      // integrated SHAs may have been rewritten, and an earlier FAILED attempt
      // can leave rewritten commits on main without ever publishing them. So
      // resolve the actual local HEAD immediately before the manifest commit
      // and treat THAT as the durable anchor on every attempt; caller-supplied
      // SHAs stay provenance only.
      const preManifestHead = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );
      details.preManifestHead = preManifestHead;

      // Publication evidence on the integration report is IN-MEMORY ONLY:
      // this mutation lands on the caller's report copy after the engine
      // already persisted the strategy record, so it never reaches durable
      // storage. The durable carrier of publication evidence is the pushed
      // .orca/results/<dispatchId>.json manifest below (plus
      // RemotePublishResult.details transiently), not the persisted record.
      // SHA truth (Change 018 R2 / audit H1): the durable integration history
      // IS the anchored pre-manifest HEAD; the caller-supplied integration SHA
      // survives as explicit provenance whenever it differs from that anchor —
      // both when THIS attempt rebased and when an earlier failed attempt's
      // rebase already rewrote the reported SHA out of ancestry.
      const preReconciliationIntegrationSha =
        report?.integration?.finalCommitSha ?? null;
      const publication: PublicationEvidence = {
        relation,
        reconciled,
        finalHead: preManifestHead,
      };
      if (
        preReconciliationIntegrationSha &&
        preReconciliationIntegrationSha !== preManifestHead
      )
        publication.preReconciliationIntegrationSha =
          preReconciliationIntegrationSha;
      if (report?.integration) report.integration.publication = publication;

      // Write the canonical result manifest on the (reconciled) local main.
      const resultPath = `.orca/results/${safe(dispatchId)}.json`;
      const manifest = {
        schemaVersion: 1,
        repositoryId: repository.id,
        runId,
        iteration,
        dispatchId,
        strategy: report?.strategy ?? null,
        strategyStatus: report?.status ?? null,
        integrationStatus: report?.integration?.status ?? null,
        // Always the actual local HEAD resolved above; never the
        // caller-supplied integration SHA, which reconciliation (this attempt
        // or an earlier failed one) may have rewritten out of origin/main
        // ancestry. Pre-rebase provenance lives in
        // publication.preReconciliationIntegrationSha.
        finalCommitSha: preManifestHead,
        createdAt: new Date().toISOString(),
        publication,
      };
      const manifestJson = JSON.stringify(manifest, null, 2);
      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.mkdirSync(path.join(repository.localPath, ".orca", "results"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(repository.localPath, resultPath),
        manifestJson,
      );
      // R1#F5: the pre-manifest HEAD captured above doubles as the rollback
      // point so a failed push can unwind exactly Orca's own manifest commit
      // (see the PUSH_FAILED handler).
      await this.git(repository, ["add", resultPath], repository.localPath);
      await this.git(
        repository,
        [
          "commit",
          "-m",
          `chore(orca): durable iteration result for ${safe(dispatchId)}`,
        ],
        repository.localPath,
      );
      const resultSha = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );

      try {
        await this.git(
          repository,
          ["push", "origin", "main"],
          repository.localPath,
        );
      } catch (error: any) {
        // R1#F5: roll back EXACTLY Orca's own just-created manifest commit
        // with a mixed reset (`git reset preManifestHead`): the branch pointer
        // returns to the pre-commit HEAD and the staged manifest entry is
        // dropped, leaving the manifest file on disk as untracked content
        // that the next retry overwrites. This narrow reset does not violate
        // the no-destructive-recovery policy: publish verified the tree
        // clean before starting, the per-repository lock serialized every
        // mutation in between, so the reset can only unwind Orca's own
        // commit — user work is never touched. Best-effort: if the reset
        // itself fails, the commit is kept and flagged via details.
        try {
          await this.git(
            repository,
            ["reset", preManifestHead],
            repository.localPath,
          );
        } catch (rollbackError: any) {
          details.rollbackFailed = true;
          details.rollbackError =
            rollbackError?.message ?? String(rollbackError);
        }
        return {
          status: "BLOCKED",
          pushedSha: null,
          resultSha,
          remoteVerified: false,
          blocker: `PUSH_FAILED: ${error?.message ?? String(error)}`,
          details,
        };
      }

      const pushHead = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );
      // Verify the ACTUAL final HEAD landed on origin/main and the manifest
      // blob is present at that HEAD. Pre-rebase provenance SHAs are checked
      // informationally only: a reconciliation legitimately rewrites them out
      // of remote ancestry and must not fail verification.
      const finalOnRemote = await this.isAncestor(
        repository,
        resultSha,
        "origin/main",
      );
      const manifestOnRemote = await this.git(
        repository,
        ["cat-file", "-e", `origin/main:${resultPath}`],
        repository.localPath,
      )
        .then(() => true)
        .catch(() => false);
      const remoteVerified = finalOnRemote && manifestOnRemote;
      if (
        preReconciliationIntegrationSha &&
        preReconciliationIntegrationSha !== preManifestHead
      )
        details.preRebaseIntegrationShaOnRemote = await this.isAncestor(
          repository,
          preReconciliationIntegrationSha,
          "origin/main",
        );
      details.pushedSha = pushHead;
      details.resultSha = resultSha;
      details.remoteVerified = remoteVerified;
      return {
        status: remoteVerified ? "PUBLISHED" : "BLOCKED",
        pushedSha: pushHead,
        resultSha,
        remoteVerified,
        blocker: remoteVerified
          ? null
          : "Remote verification failed after push.",
        details,
      };
    } catch (error: any) {
      return {
        status: "BLOCKED",
        pushedSha: null,
        resultSha: null,
        remoteVerified: false,
        blocker: error?.message ? String(error.message) : String(error),
        details,
      };
    }
  }

  /**
   * Change 018 R1#F3: serialize publications for one repository through a
   * promise chain. Each caller chains onto the stored tail; rejections are
   * swallowed in the stored tail so the chain never breaks, while the caller
   * still receives its own outcome.
   */
  private withPublishLock<T>(
    repositoryId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.publishLocks.get(repositoryId) ?? Promise.resolve();
    const run = previous.then(operation);
    this.publishLocks.set(
      repositoryId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async isAncestor(
    repository: RepositoryRecord,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return this.git(
      repository,
      ["merge-base", "--is-ancestor", ancestor, descendant],
      repository.localPath,
    )
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Replay local main onto origin/main. Requires a clean tree (checked by the
   * caller); any failure aborts the rebase so no partial state is left behind.
   */
  private async rebaseOntoRemoteMain(
    repository: RepositoryRecord,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.git(
        repository,
        ["rebase", "origin/main"],
        repository.localPath,
      );
      return { ok: true };
    } catch (error: any) {
      try {
        await this.git(
          repository,
          ["rebase", "--abort"],
          repository.localPath,
        );
      } catch {}
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  private topologicalOrder(packets: WorkPacket[]): {
    packets: WorkPacket[];
    blocker: string | null;
  } {
    const byId = new Map(packets.map((packet) => [packet.packetId, packet]));
    for (const packet of packets)
      for (const dependency of packet.dependencies)
        if (!byId.has(dependency))
          return {
            packets: [],
            blocker: `Missing packet dependency: ${dependency}`,
          };
    const incoming = new Map(
      packets.map((packet) => [packet.packetId, new Set(packet.dependencies)]),
    );
    const output: WorkPacket[] = [];
    const ready = packets
      .filter((packet) => incoming.get(packet.packetId)?.size === 0)
      .sort((a, b) => a.packetId.localeCompare(b.packetId));
    while (ready.length > 0) {
      const packet = ready.shift()!;
      output.push(packet);
      for (const candidate of packets) {
        const deps = incoming.get(candidate.packetId)!;
        deps.delete(packet.packetId);
        if (
          deps.size === 0 &&
          !output.includes(candidate) &&
          !ready.includes(candidate)
        )
          ready.push(candidate);
      }
      ready.sort((a, b) => a.packetId.localeCompare(b.packetId));
    }
    return output.length === packets.length
      ? { packets: output, blocker: null }
      : { packets: [], blocker: "Packet dependency graph contains a cycle." };
  }

  private synthetic(
    packet: WorkPacket,
    status: WorkPacketResult["status"],
    blocker: string,
  ): WorkPacketResult {
    return {
      schemaVersion: 1,
      packetId: packet.packetId,
      campaignId: packet.campaignId,
      runId: packet.runId,
      iteration: packet.iteration,
      status,
      worktree: null,
      filesChanged: [],
      verification: [],
      findings: [],
      risks: [],
      artifacts: [],
      dependenciesAffected: packet.dependencies,
      usageMetricIds: [],
      summary: blocker,
      blocker,
      createdAt: new Date().toISOString(),
    };
  }

  private async assertCommitOnBranch(
    repository: RepositoryRecord,
    commitSha: string,
    branch: string,
  ): Promise<void> {
    await this.git(
      repository,
      ["cat-file", "-e", `${commitSha}^{commit}`],
      repository.localPath,
    );
    await this.git(
      repository,
      ["merge-base", "--is-ancestor", commitSha, branch],
      repository.localPath,
    );
  }

  private async git(
    repository: RepositoryRecord,
    args: string[],
    cwd: string,
  ): Promise<string> {
    let command = "git";
    let commandArgs = args;
    let commandCwd: string | undefined = cwd;
    if (repository.environment === "wsl") {
      command = "wsl.exe";
      commandCwd = undefined;
      commandArgs = [];
      if (repository.wslDistribution)
        commandArgs.push("-d", repository.wslDistribution);
      commandArgs.push("--cd", toWslPath(cwd), "--", "git", ...args);
    }
    try {
      const result = await execFileAsync(command, commandArgs, {
        cwd: commandCwd,
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return result.stdout.toString().trim();
    } catch (error: any) {
      const stderr = error?.stderr?.toString().trim();
      throw new Error(
        `Git integration error (${command} ${commandArgs.join(" ")}): ${stderr || error?.message || String(error)}`,
      );
    }
  }

  private persist(
    repository: RepositoryRecord,
    report: IntegrationReport,
  ): IntegrationReport {
    return this.store.saveIntegration(report, repository.id);
  }
}

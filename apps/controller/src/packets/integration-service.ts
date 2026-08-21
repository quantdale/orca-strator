import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  IntegrationReport,
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
   * Item #8: integrate a single completed packet's commit onto persistent main.
   * Used by the DAG runner so a dependent node is allocated from a base that
   * already contains its dependencies' accepted output. The dependency commits
   * are assumed already integrated (the caller guarantees ordering).
   */
  async integrateSingleCommit(
    repository: RepositoryRecord,
    packet: WorkPacket,
    result: WorkPacketResult,
  ): Promise<IntegrationReport> {
    const createdAt = new Date().toISOString();
    if (!result.worktree?.commitSha || !result.worktree.branch) {
      return this.persist(repository, {
        schemaVersion: 1,
        repositoryId: repository.id,
        runId: packet.runId,
        iteration: packet.iteration,
        status: "BLOCKED",
        integratedPacketIds: [],
        results: [result],
        finalCommitSha: null,
        blocker: "Completed result has no worktree branch/commit provenance.",
        createdAt,
      });
    }
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
        runId: packet.runId,
        iteration: packet.iteration,
        status: "BLOCKED",
        integratedPacketIds: [],
        results: [result],
        finalCommitSha: null,
        blocker: `MAIN_STATUS_UNAVAILABLE: ${error?.message ?? String(error)}`,
        createdAt,
      });
    }
    if (mainStatus.trim()) {
      return this.persist(repository, {
        schemaVersion: 1,
        repositoryId: repository.id,
        runId: packet.runId,
        iteration: packet.iteration,
        status: "BLOCKED",
        integratedPacketIds: [],
        results: [result],
        finalCommitSha: null,
        blocker:
          "Persistent main checkout is dirty; integration refuses to overwrite user work.",
        createdAt,
      });
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
    } catch (error: any) {
      try {
        await this.git(
          repository,
          ["cherry-pick", "--abort"],
          repository.localPath,
        );
      } catch {}
      return this.persist(repository, {
        schemaVersion: 1,
        repositoryId: repository.id,
        runId: packet.runId,
        iteration: packet.iteration,
        status: "INTEGRATION_CONFLICT",
        integratedPacketIds: [],
        results: [result],
        finalCommitSha: null,
        blocker: `Git integration failed and was aborted: ${error?.message ?? String(error)}`,
        createdAt,
      });
    }
    let finalCommitSha: string | null = null;
    try {
      finalCommitSha = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );
    } catch {}
    return this.persist(repository, {
      schemaVersion: 1,
      repositoryId: repository.id,
      runId: packet.runId,
      iteration: packet.iteration,
      status: "COMPLETED",
      integratedPacketIds: [packet.packetId],
      results: [result],
      finalCommitSha,
      blocker: null,
      createdAt,
    });
  }

  /**
   * Item #6 / #13: make the integrated `main` durable on the remote.
   *
   * Inspects local `main`, fetches remote `main`, reconciles ordinary
   * non-overlapping advancement (e.g. a dispatch commit pushed by Sol), refuses
   * to force-push, and only after a clean push writes the canonical
   * `.orca/results/<dispatchId>.json` result manifest and verifies the remote
   * contains both the integration and the result.
   */
  async publishToRemote(
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

      // Reconcile ordinary non-overlapping advancement (e.g. a Sol dispatch
      // commit that landed on remote main while the strategy ran). If remote
      // is ahead, rebase our local main onto it; additive non-conflicting
      // changes replay cleanly. Conflicts abort to a structured blocker.
      if (remoteHead && remoteHead !== localHead) {
        const isAncestor = await this.git(
          repository,
          ["merge-base", "--is-ancestor", localHead, remoteHead],
          repository.localPath,
        )
          .then(() => true)
          .catch(() => false);
        if (!isAncestor) {
          // Local is not an ancestor of remote: remote diverged. Try a rebase
          // onto remote main; if it cannot be reconciled, stop with a blocker.
          try {
            await this.git(
              repository,
              ["rebase", "origin/main"],
              repository.localPath,
            );
          } catch (error: any) {
            try {
              await this.git(
                repository,
                ["rebase", "--abort"],
                repository.localPath,
              );
            } catch {}
            return {
              status: "BLOCKED",
              pushedSha: null,
              resultSha: null,
              remoteVerified: false,
              blocker: `Unsafe remote advancement: cannot reconcile local main with remote main. ${error?.message ?? String(error)}`,
              details,
            };
          }
        }
      }

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
        finalCommitSha: report?.integration?.finalCommitSha ?? null,
        createdAt: new Date().toISOString(),
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

      await this.git(
        repository,
        ["push", "origin", "main"],
        repository.localPath,
      );

      const pushHead = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );
      // Verify remote contains the integration commit and the result commit.
      const integrationSha = report?.integration?.finalCommitSha ?? null;
      let remoteVerified = true;
      if (integrationSha) {
        remoteVerified = await this.git(
          repository,
          ["merge-base", "--is-ancestor", integrationSha, "origin/main"],
          repository.localPath,
        )
          .then(() => true)
          .catch(() => false);
      }
      remoteVerified =
        remoteVerified &&
        (await this.git(
          repository,
          ["merge-base", "--is-ancestor", resultSha, "origin/main"],
          repository.localPath,
        )
          .then(() => true)
          .catch(() => false));
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

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type CapabilityProbeRequest,
  type CapabilityReadiness,
  type ExecutorCapabilitySnapshot,
  type ExecutorRichCapabilities,
  type RepositoryRecord,
  type ProbeLevel,
  ValidationError
} from "@orca/shared";
import { resolveProfile } from "./profiles.js";
import type { CapabilityStore, StoredCapabilityProbe } from "./capability-store.js";
import type { OpenCodeAdapter } from "./adapters/opencode-adapter.js";
import type { GitClient, GitContext } from "../watcher/git-client.js";
import { toWslPath } from "../wsl-path.js";

const execFileAsync = promisify(execFile);

export interface CapabilityProbeServiceOptions {
  store: CapabilityStore;
  gitClient: GitClient;
  openCodeAdapter?: OpenCodeAdapter;
  eventPublisher?: (event: {
    type: "executor.capability_probed";
    at: string;
    repositoryId: string;
    data?: Record<string, unknown>;
  }) => void;
}

export class CapabilityProbeService {
  constructor(private readonly options: CapabilityProbeServiceOptions) {}

  latest(repositoryId: string): StoredCapabilityProbe | null {
    return this.options.store.latest(repositoryId);
  }

  history(repositoryId: string): StoredCapabilityProbe[] {
    return this.options.store.list(repositoryId);
  }

  async probe(repository: RepositoryRecord, request: CapabilityProbeRequest = {}): Promise<StoredCapabilityProbe> {
    const level: ProbeLevel = request.level ?? "STATIC";
    if (level === "INFERENCE" && request.allowInference !== true) {
      throw new ValidationError("INFERENCE probes require explicit allowInference=true; Settings never burns inference implicitly.");
    }

    const profile = resolveProfile(repository.executorCli);
    const probedAt = new Date().toISOString();
    const issues: ExecutorCapabilitySnapshot["issues"] = [];
    const invocation = await this.probeInvocation(repository, profile, issues);
    const openCodeProbe = profile === "opencode" && this.options.openCodeAdapter
      ? await this.options.openCodeAdapter.probeServer()
      : null;
    if (openCodeProbe) issues.push(...openCodeProbe.issues);
    const workingDirectoryAccessible = level === "STATIC"
      ? "UNKNOWN" as const
      : await this.probeWorkingDirectory(repository, issues);
    const git = level === "STATIC"
      ? { gitAvailable: "UNKNOWN" as const, fetchUsable: "UNKNOWN" as const, pushUsable: "UNKNOWN" as const, remoteMainUsable: "UNKNOWN" as const }
      : await this.probeGit(repository, level, issues);
    const installed = invocation.installed;
    const testProfile = profile === "test";
    const rich: ExecutorRichCapabilities = {
      structuredEvents: testProfile ? "NOT_APPLICABLE" : "UNKNOWN",
      sessionResume: "UNKNOWN",
      subagents: "UNKNOWN",
      permissionApi: "UNKNOWN",
      nativeCancellation: "NOT_APPLICABLE",
      sessionHistory: "UNKNOWN",
      usageTelemetry: "UNKNOWN",
      nativeStatus: "UNKNOWN"
    };
    if (openCodeProbe) {
      const routes = openCodeProbe.details.routes;
      rich.structuredEvents = routes.events;
      rich.sessionResume = routes.sessions === "READY" && routes.sessionHistory === "READY" ? "READY" : routes.sessions === "UNSUPPORTED" ? "UNSUPPORTED" : "UNKNOWN";
      rich.subagents = routes.subagents;
      rich.permissionApi = routes.permissions;
      rich.nativeCancellation = routes.cancellation;
      rich.sessionHistory = routes.sessionHistory;
      rich.usageTelemetry = routes.usage;
      rich.nativeStatus = routes.health;
    }

    const snapshot: ExecutorCapabilitySnapshot = {
      schemaVersion: 1,
      cli: repository.executorCli,
      profile,
      installed,
      version: invocation.version,
      executablePath: invocation.executablePath,
      environment: repository.environment,
      wslDistribution: repository.wslDistribution,
      workingDirectoryAccessible,
      gitAvailable: git.gitAvailable,
      fetchUsable: git.fetchUsable,
      pushUsable: git.pushUsable,
      remoteMainUsable: git.remoteMainUsable,
      headlessSupported: installed ? "READY" : "NOT_READY",
      commandProfileValid: invocation.profileValid,
      resumeSupported: "UNKNOWN",
      cancellationSupported: installed ? "READY" : "NOT_READY",
      authStatus: testProfile ? "NOT_APPLICABLE" : "UNKNOWN",
      configuredModel: repository.executorModel,
      modelRecognition: testProfile ? "RECOGNIZED" : "UNKNOWN",
      rich,
      ...(openCodeProbe ? { opencode: openCodeProbe.details } : {}),
      overall: this.overall(installed, workingDirectoryAccessible, git, testProfile, level),
      probeLevel: level,
      probedAt,
      issues
    };

    if (level === "INFERENCE") {
      snapshot.issues.push({
        class: "PROBE_NOT_AUTHORIZED",
        message: "No provider inference request is implemented by this probe; auth/model readiness remains UNKNOWN without a provider response.",
        retryable: false
      });
    }

    const stored: StoredCapabilityProbe = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      cli: repository.executorCli,
      model: repository.executorModel,
      environment: repository.environment,
      probeLevel: level,
      overall: snapshot.overall,
      snapshot,
      probedAt
    };
    this.options.store.save(stored);
    this.options.eventPublisher?.({
      type: "executor.capability_probed",
      at: probedAt,
      repositoryId: repository.id,
      data: {
        probeLevel: level,
        overall: snapshot.overall,
        cli: repository.executorCli,
        model: repository.executorModel
      }
    });
    return stored;
  }

  private async probeInvocation(
    repository: RepositoryRecord,
    profile: string,
    issues: ExecutorCapabilitySnapshot["issues"]
  ): Promise<{ installed: boolean; version: string | null; executablePath: string | null; profileValid: CapabilityReadiness }> {
    if (profile === "test" && !process.env.ORCA_TEST_EXECUTOR_HARNESS) {
      issues.push({ class: "INVOCATION_UNSUPPORTED", message: "Deterministic test profile requires ORCA_TEST_EXECUTOR_HARNESS.", retryable: false });
      return { installed: false, version: null, executablePath: null, profileValid: "NOT_READY" };
    }
    try {
      const version = await this.runCommand(repository, repository.executorCli, ["--version"]);
      const executablePath = await this.resolveCommand(repository, repository.executorCli);
      return { installed: true, version: version.stdout.trim() || version.stderr.trim() || "unknown", executablePath, profileValid: "READY" };
    } catch (error: any) {
      issues.push({
        class: error?.code === "ENOENT" ? "CLI_NOT_FOUND" : "CLI_VERSION_FAILED",
        message: error?.message ?? String(error),
        retryable: error?.code !== "ENOENT"
      });
      return { installed: false, version: null, executablePath: null, profileValid: "NOT_READY" };
    }
  }

  private async probeWorkingDirectory(repository: RepositoryRecord, issues: ExecutorCapabilitySnapshot["issues"]): Promise<CapabilityReadiness> {
    try {
      if (repository.environment === "windows") {
        await fs.access(repository.localPath);
      } else {
        await this.runWsl(repository, ["pwd"]);
      }
      return "READY";
    } catch (error: any) {
      issues.push({ class: repository.environment === "wsl" ? "WSL_UNAVAILABLE" : "WORKING_DIRECTORY_UNAVAILABLE", message: error?.message ?? String(error), retryable: true });
      return "NOT_READY";
    }
  }

  private async probeGit(repository: RepositoryRecord, level: ProbeLevel, issues: ExecutorCapabilitySnapshot["issues"]): Promise<{
    gitAvailable: CapabilityReadiness;
    fetchUsable: CapabilityReadiness;
    pushUsable: CapabilityReadiness;
    remoteMainUsable: CapabilityReadiness;
  }> {
    const ctx: GitContext = repository.environment === "wsl"
      ? { environment: "wsl", workingPath: repository.localPath, linuxPath: this.linuxPath(repository), wslDistribution: repository.wslDistribution }
      : { environment: "windows", workingPath: repository.localPath };
    try {
      const head = await this.options.gitClient.getCurrentSha(ctx);
      if (!head) throw new Error("Git repository HEAD could not be read.");
      const remote = await this.options.gitClient.getRemoteHeadSha(repository.githubRemote, "main", ctx);
      let fetchUsable: CapabilityReadiness = remote ? "READY" : "UNKNOWN";
      let pushUsable: CapabilityReadiness = "UNKNOWN";
      if (level !== "STATIC" && remote) {
        // Fetch is a read-only remote synchronization operation; it does not
        // change the checked-out branch or discard user work.
        try {
          await this.options.gitClient.fetch(ctx, "origin", "main");
          fetchUsable = "READY";
        } catch (error: any) {
          fetchUsable = "NOT_READY";
          issues.push({ class: "REMOTE_UNAVAILABLE", message: error?.message ?? String(error), retryable: true });
        }
        // Push permission is intentionally never inferred from a normal probe.
        // A dry-run may be added by an explicit user action; report unknown here.
        pushUsable = "UNKNOWN";
      }
      return { gitAvailable: "READY", fetchUsable, pushUsable, remoteMainUsable: remote ? "READY" : "NOT_READY" };
    } catch (error: any) {
      issues.push({ class: "GIT_UNAVAILABLE", message: error?.message ?? String(error), retryable: true });
      return { gitAvailable: "NOT_READY", fetchUsable: "UNKNOWN", pushUsable: "UNKNOWN", remoteMainUsable: "UNKNOWN" };
    }
  }

  private overall(
    installed: boolean,
    workingDirectory: CapabilityReadiness,
    git: { gitAvailable: CapabilityReadiness; remoteMainUsable: CapabilityReadiness },
    testProfile: boolean,
    level: ProbeLevel
  ): CapabilityReadiness {
    if (!installed || workingDirectory === "NOT_READY" || git.gitAvailable === "NOT_READY") return "NOT_READY";
    if (testProfile && level !== "INFERENCE") return "READY";
    if (git.remoteMainUsable === "NOT_READY") return "NOT_READY";
    return "UNKNOWN";
  }

  private async resolveCommand(repository: RepositoryRecord, command: string): Promise<string | null> {
    try {
      if (repository.environment === "wsl") {
        const result = await this.runWsl(repository, ["which", command]);
        return result.stdout.trim() || null;
      }
      const result = await execFileAsync("where.exe", [command], { windowsHide: true, timeout: 10_000 });
      return result.stdout.toString().split(/\r?\n/).find((line) => line.trim())?.trim() ?? null;
    } catch {
      return null;
    }
  }

  private async runCommand(repository: RepositoryRecord, command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    if (repository.environment === "wsl") return this.runWsl(repository, [command, ...args]);
    const result = await execFileAsync(command, args, { windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  }

  private async runWsl(repository: RepositoryRecord, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const wslArgs: string[] = [];
    if (repository.wslDistribution) wslArgs.push("-d", repository.wslDistribution);
    wslArgs.push("--cd", this.linuxPath(repository), "--", ...args);
    const result = await execFileAsync("wsl.exe", wslArgs, { windowsHide: true, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  }

  private linuxPath(repository: RepositoryRecord): string {
    return repository.localPath.startsWith("/") ? repository.localPath : toWslPath(repository.localPath);
  }
}

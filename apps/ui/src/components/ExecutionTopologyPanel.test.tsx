// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CampaignDetail } from "@orca/shared";
import { ExecutionTopologyPanel } from "./ExecutionTopologyPanel.js";

afterEach(() => cleanup());

const baseCampaign = (): CampaignDetail => ({
  repository: {
    id: "repo-topology",
    displayName: "Topology repo",
    githubRemote: "https://example.invalid/repo.git",
    localPath: "C:\\repo",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "model-primary",
    solConversationUrl: "https://chatgpt.com/c/test",
    maxIterations: 3,
    maxRuntimeMinutes: 60,
    enabled: true,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z"
  },
  run: {
    id: "run-topology",
    repositoryId: "repo-topology",
    goal: "Qualify topology",
    status: "SOL_REVIEWING",
    currentIteration: 1,
    maxIterations: 3,
    activeDispatchId: null,
    lastError: null,
    startedAt: "2026-08-20T10:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    drainReason: null
  },
  summary: {} as CampaignDetail["summary"],
  iterations: [],
  timeline: [],
  dispatches: [],
  executorRuns: [],
  wakes: [],
  controls: [],
  effectivePolicy: null,
  usage: [],
  usageSummary: {
    metricCount: 0,
    knownMetricCount: 0,
    unknownMetricCount: 0,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    requestCount: null,
    latencyMs: null,
    retryCount: null,
    rateLimitEvents: null,
    exactCost: null,
    estimatedCost: null,
    currencies: [],
    providers: [],
    models: []
  },
  strategyRuns: [],
  dagNodes: []
});

describe("ExecutionTopologyPanel", () => {
  it("renders the real single-agent Sol handoff sequence", () => {
    render(<ExecutionTopologyPanel campaign={baseCampaign()} />);

    expect(screen.getByTestId("topology-strategy").textContent).toBe("SINGLE_AGENT");
    expect(screen.getByText("Sol wake")).toBeTruthy();
    expect(screen.getByText("Dispatch")).toBeTruthy();
    expect(screen.getByText("Executor")).toBeTruthy();
    expect(screen.getByText("Result + Git")).toBeTruthy();
    expect(screen.getByText("Sol review")).toBeTruthy();
    expect(screen.getByText(/not graph authoring/i)).toBeTruthy();
  });

  it("renders actual DAG dependency and partial integration evidence", () => {
    const campaign = baseCampaign();
    campaign.strategyRuns = [{
      schemaVersion: 1,
      strategyRunId: "strategy-dag",
      repositoryId: campaign.repository.id,
      campaignId: campaign.run.id,
      runId: campaign.run.id,
      iteration: 1,
      strategy: "DAG",
      status: "PARTIAL",
      maxConcurrency: 2,
      packetIds: ["packet-a", "packet-b"],
      controlState: "NONE",
      startedAt: "2026-08-20T10:00:01.000Z",
      finishedAt: "2026-08-20T10:00:04.000Z",
      lastError: "integration conflict",
      report: {
        schemaVersion: 1,
        strategyRunId: "strategy-dag",
        repositoryId: campaign.repository.id,
        runId: campaign.run.id,
        iteration: 1,
        strategy: "DAG",
        status: "PARTIAL",
        maxConcurrency: 2,
        packetIds: ["packet-a", "packet-b"],
        nodeIds: ["a", "b"],
        nodes: [],
        results: [{
          schemaVersion: 1,
          packetId: "packet-a",
          campaignId: campaign.run.id,
          runId: campaign.run.id,
          iteration: 1,
          status: "COMPLETED",
          worktree: null,
          filesChanged: [],
          verification: [],
          findings: [],
          risks: [],
          artifacts: [],
          dependenciesAffected: [],
          usageMetricIds: [],
          summary: "audit complete",
          blocker: null,
          createdAt: "2026-08-20T10:00:03.000Z"
        }],
        integration: {
          schemaVersion: 1,
          repositoryId: campaign.repository.id,
          runId: campaign.run.id,
          iteration: 1,
          status: "INTEGRATION_CONFLICT",
          integratedPacketIds: ["packet-a"],
          results: [],
          finalCommitSha: null,
          blocker: "shared path conflict",
          createdAt: "2026-08-20T10:00:04.000Z"
        },
        schedulerDecisionIds: [],
        controlIds: [],
        blocker: "shared path conflict",
        startedAt: "2026-08-20T10:00:01.000Z",
        finishedAt: "2026-08-20T10:00:04.000Z"
      },
      createdAt: "2026-08-20T10:00:01.000Z",
      updatedAt: "2026-08-20T10:00:04.000Z"
    }];
    campaign.dagNodes = [{
      schemaVersion: 1,
      strategyRunId: "strategy-dag",
      nodeId: "a",
      packetId: "packet-a",
      dependsOn: [],
      status: "COMPLETED",
      budget: { maxRuntimeMs: 1000, maxRetries: 0, maxTokens: null, maxSpend: null },
      attempt: 1,
      maxRetries: 0,
      waitingReason: null,
      startedAt: "2026-08-20T10:00:02.000Z",
      finishedAt: "2026-08-20T10:00:03.000Z",
      resultId: null,
      createdAt: "2026-08-20T10:00:01.000Z",
      updatedAt: "2026-08-20T10:00:03.000Z"
    }, {
      schemaVersion: 1,
      strategyRunId: "strategy-dag",
      nodeId: "b",
      packetId: "packet-b",
      dependsOn: ["a"],
      status: "WAITING_DEPENDENCY",
      budget: { maxRuntimeMs: 1000, maxRetries: 0, maxTokens: null, maxSpend: null },
      attempt: 0,
      maxRetries: 0,
      waitingReason: "dependency pending",
      startedAt: null,
      finishedAt: null,
      resultId: null,
      createdAt: "2026-08-20T10:00:01.000Z",
      updatedAt: "2026-08-20T10:00:02.000Z"
    }];

    render(<ExecutionTopologyPanel campaign={campaign} />);

    expect(screen.getAllByTestId("topology-strategy").find((element) => element.textContent === "DAG")?.textContent).toBe("DAG");
    expect(screen.getByText("Node b")).toBeTruthy();
    expect(screen.getByTestId("topology-dependencies-packet-packet-b")).toBeTruthy();
    expect(screen.getByText("WAITING_DEPENDENCY")).toBeTruthy();
    expect(screen.getByText("INTEGRATION_CONFLICT")).toBeTruthy();
    expect(screen.getAllByText("usage UNKNOWN").length).toBeGreaterThan(0);
  });

  it("shows reusable presets as reference data without authoring controls", () => {
    render(<ExecutionTopologyPanel campaign={baseCampaign()} />);

    expect(screen.getAllByTestId("strategy-presets").length).toBeGreaterThan(0);
    expect(screen.getByText("Feature Development")).toBeTruthy();
    expect(screen.getByText("Migration")).toBeTruthy();
    expect(screen.getByText(/never auto-start/i)).toBeTruthy();
    expect(screen.queryByText(/drag|drop|create node/i)).toBeNull();
  });
});

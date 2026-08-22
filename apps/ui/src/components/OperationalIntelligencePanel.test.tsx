// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  AutonomyPermissionPolicy,
  PermissionDecision,
} from "@orca/shared";
import { apiClient } from "../lib/api-client.js";
import { OperationalIntelligencePanel } from "./OperationalIntelligencePanel.js";

afterEach(() => cleanup());

const permissionPolicy = (): AutonomyPermissionPolicy => ({
  schemaVersion: 1,
  repositoryId: "repo-perm",
  preset: "BALANCED",
  rules: [],
  updatedAt: "2026-08-22T08:00:00.000Z",
});

const decision = (
  overrides: Partial<PermissionDecision>,
): PermissionDecision => ({
  id: "decision-1",
  repositoryId: "repo-perm",
  runId: "run-perm",
  iteration: 1,
  action: "REPOSITORY_FILE_WRITE",
  outcome: "ASK",
  enforcement: "ADVISORY_ONLY",
  rationale: "policy requires attention",
  actionable: true,
  createdAt: "2026-08-22T08:00:00.000Z",
  resolvedAt: null,
  ...overrides,
});

vi.mock("../lib/api-client.js", () => ({
  apiClient: {
    listCampaigns: vi.fn(async () => ({ campaigns: [] })),
    getExecutorCapabilities: vi.fn(async () => ({
      capability: null,
      history: [],
    })),
    getPhasePolicy: vi.fn(async () => ({ policy: null })),
    getPermissions: vi.fn(async () => ({ policy: null, decisions: [] })),
    getUsage: vi.fn(async () => ({ metrics: [], summary: {} })),
    getSchedulerPolicy: vi.fn(async () => ({ policy: null })),
    getSchedulerDecisions: vi.fn(async () => ({ decisions: [] })),
    getRoleModelPolicy: vi.fn(async () => ({ policy: null })),
    resolvePermissionDecision: vi.fn(async () => ({ decision: {} })),
  },
}));

const mockedApi = vi.mocked(apiClient, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OperationalIntelligencePanel permission resolution (Change 020)", () => {
  it("renders resolve controls only for unresolved actionable decisions and refreshes after success", async () => {
    mockedApi.getPermissions.mockResolvedValue({
      policy: permissionPolicy(),
      decisions: [
        decision({ id: "ask-open" }),
        decision({
          id: "ask-settled",
          outcome: "ALLOW_ONCE",
          resolvedAt: "2026-08-22T08:05:00.000Z",
        }),
      ],
    });

    render(<OperationalIntelligencePanel repositoryId="repo-perm" />);

    await waitFor(() =>
      expect(screen.getByTestId("pending-permission-decisions")).toBeTruthy(),
    );
    expect(screen.getByTestId("resolve-ask-open-DENY")).toBeTruthy();
    expect(screen.getByTestId("resolve-ask-open-ALLOW")).toBeTruthy();
    expect(screen.getByTestId("resolve-ask-open-ALLOW_ONCE")).toBeTruthy();
    expect(screen.queryByTestId("resolve-ask-settled-ALLOW")).toBeNull();

    fireEvent.click(screen.getByTestId("resolve-ask-open-DENY"));

    await waitFor(() =>
      expect(mockedApi.resolvePermissionDecision).toHaveBeenCalledWith(
        "repo-perm",
        "ask-open",
        "DENY",
      ),
    );
    await waitFor(() =>
      expect(mockedApi.getPermissions).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByTestId("permission-resolve-error")).toBeNull();
  });

  it("surfaces a truthful already-resolved error without removing decision history", async () => {
    mockedApi.getPermissions.mockResolvedValue({
      policy: permissionPolicy(),
      decisions: [decision({ id: "ask-raced" })],
    });
    mockedApi.resolvePermissionDecision.mockRejectedValue(
      new Error(
        'Permission decision "ask-raced" has already been resolved at 2026-08-22T08:06:00.000Z.',
      ),
    );

    render(<OperationalIntelligencePanel repositoryId="repo-perm" />);

    await waitFor(() =>
      expect(screen.getByTestId("pending-permission-decisions")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("resolve-ask-raced-ALLOW"));

    const banner = await screen.findByTestId("permission-resolve-error");
    expect(banner.textContent).toMatch(/already been resolved/);
    // The action code renders in both the recent-decisions badge and the
    // pending row; history must still show it after the failed resolve.
    expect(screen.getAllByText(/REPOSITORY_FILE_WRITE/).length).toBeGreaterThan(
      0,
    );
    expect(mockedApi.getPermissions).toHaveBeenCalledTimes(1);
  });
});

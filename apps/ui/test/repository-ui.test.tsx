// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RepositoryList } from "../src/components/RepositoryList.js";
import { RepositoryForm } from "../src/components/RepositoryForm.js";
import { RepositoryDetail } from "../src/components/RepositoryDetail.js";
import type { RepositoryRecord } from "@orca/shared";

describe("Repository UI & UX (Tests 8)", () => {
  afterEach(() => {
    cleanup();
  });

  const mockRepos: RepositoryRecord[] = [
    {
      id: "repo-1",
      displayName: "TabDock",
      githubRemote: "https://github.com/quantdale/tabdock.git",
      localPath: "D:\\Projects\\TabDock",
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6-luna-xhigh",
      solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z"
    },
    {
      id: "repo-2",
      displayName: "Nightwatch",
      githubRemote: "https://github.com/quantdale/nightwatch.git",
      localPath: "/home/dale/projects/nightwatch",
      environment: "wsl",
      wslDistribution: "Ubuntu-24.04",
      executorCli: "kimi",
      executorModel: "deepseek-v4-flash",
      solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 10,
      maxRuntimeMinutes: 300,
      createdAt: "2026-08-19T11:00:00.000Z",
      updatedAt: "2026-08-19T11:00:00.000Z"
    }
  ];

  it("8.T1 renders multiple repositories independently and shows empty state when 0 repos", () => {
    const { rerender } = render(
      <RepositoryList
        repositories={mockRepos}
        status="connected"
        isLoading={false}
        onSelectRepo={vi.fn()}
        onEditRepo={vi.fn()}
        onAddRepo={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText("TabDock")).toBeDefined();
    expect(screen.getByText("Nightwatch")).toBeDefined();
    expect(screen.getByText("WSL (Ubuntu-24.04)")).toBeDefined();

    // Rerender with empty list
    rerender(
      <RepositoryList
        repositories={[]}
        status="connected"
        isLoading={false}
        onSelectRepo={vi.fn()}
        onEditRepo={vi.fn()}
        onAddRepo={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId("empty-repos-state")).toBeDefined();
    expect(screen.getByText("No repositories configured yet")).toBeDefined();
  });

  it("8.T2 offline state is distinct from empty repository list", () => {
    render(
      <RepositoryList
        repositories={[]}
        status="disconnected"
        isLoading={false}
        onSelectRepo={vi.fn()}
        onEditRepo={vi.fn()}
        onAddRepo={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId("offline-banner")).toBeDefined();
    expect(screen.getByText(/Controller offline/i)).toBeDefined();
  });

  it("8.T3 Windows and WSL form behavior toggles WSL distribution field", () => {
    render(
      <RepositoryForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isEditing={false}
      />
    );

    // Default is windows -> no wslDistribution input
    expect(screen.queryByTestId("input-wslDistribution")).toBeNull();

    // Select WSL
    const envSelect = screen.getByTestId("select-environment");
    fireEvent.change(envSelect, { target: { value: "wsl" } });

    // Now wslDistribution input is rendered
    expect(screen.getByTestId("input-wslDistribution")).toBeDefined();
  });

  it("8.T4 server validation preserves form input values", async () => {
    const mockSubmit = vi.fn().mockRejectedValue({
      message: "Validation failed",
      details: [{ field: "displayName", message: "Display name cannot be empty" }]
    });

    render(
      <RepositoryForm
        onSubmit={mockSubmit}
        onCancel={vi.fn()}
        isEditing={false}
      />
    );

    const remoteInput = screen.getByTestId("input-githubRemote") as HTMLInputElement;
    fireEvent.change(remoteInput, { target: { value: "https://github.com/quantdale/custom.git" } });

    const form = screen.getByTestId("repository-form");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByTestId("form-general-error")).toBeDefined();
      expect(screen.getByTestId("error-displayName")).toBeDefined();
      expect(remoteInput.value).toBe("https://github.com/quantdale/custom.git");
    });
  });

  it("8.T6 no branch input is rendered anywhere in form", () => {
    render(
      <RepositoryForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isEditing={false}
      />
    );

    expect(screen.queryByLabelText(/branch/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/branch/i)).toBeNull();
    expect(screen.queryByTestId("input-branch")).toBeNull();
  });

  it("8.T7 detail view displays main branch as fixed and shows ceilings", () => {
    render(
      <RepositoryDetail
        repository={mockRepos[0]}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("TabDock")).toBeDefined();
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("(Automatic invariant)")).toBeDefined();
    expect(screen.getByText(/480/)).toBeDefined();
  });

  it("8.T8 App renders list route by default at /", async () => {
    const { App } = await import("../src/App.js");
    const { apiClient } = await import("../src/lib/api-client.js");
    vi.spyOn(apiClient, "listRepositories").mockResolvedValue({ repositories: mockRepos });

    window.history.pushState(null, "", "/");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("TabDock")).toBeDefined();
      expect(screen.getByText("Nightwatch")).toBeDefined();
    });
  });

  it("8.T9 App deep links directly to /repositories/new", async () => {
    const { App } = await import("../src/App.js");
    const { apiClient } = await import("../src/lib/api-client.js");
    vi.spyOn(apiClient, "listRepositories").mockResolvedValue({ repositories: mockRepos });

    window.history.pushState(null, "", "/repositories/new");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("repository-form")).toBeDefined();
      expect(screen.getByText("Add New Repository")).toBeDefined();
    });
  });

  it("8.T10 App deep links directly to /repositories/:id", async () => {
    const { App } = await import("../src/App.js");
    const { apiClient } = await import("../src/lib/api-client.js");
    vi.spyOn(apiClient, "listRepositories").mockResolvedValue({ repositories: mockRepos });

    window.history.pushState(null, "", "/repositories/repo-1");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("repo-detail-view")).toBeDefined();
      expect(screen.getByText("TabDock")).toBeDefined();
    });
  });

  it("8.T11 App deep links directly to /repositories/:id/edit", async () => {
    const { App } = await import("../src/App.js");
    const { apiClient } = await import("../src/lib/api-client.js");
    vi.spyOn(apiClient, "listRepositories").mockResolvedValue({ repositories: mockRepos });

    window.history.pushState(null, "", "/repositories/repo-1/edit");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("repository-form")).toBeDefined();
      expect(screen.getByText("Edit TabDock")).toBeDefined();
    });
  });
});

import { describe, it, expect } from "vitest";
import { CommitInspector } from "../src/watcher/commit-inspector.js";
import { GitClient } from "../src/watcher/git-client.js";
import type { DispatchMarker } from "@orca/shared";

describe("CommitInspector (Task 3)", () => {
  const inspector = new CommitInspector(new GitClient());

  const validPayload: DispatchMarker = {
    schemaVersion: 1,
    type: "dispatch",
    runId: "run-101",
    dispatchId: "disp-101",
    iteration: 1,
    createdAt: "2026-08-19T12:00:00.000Z",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/002-repository-watch-dispatch",
    goal: "Implement watcher",
    instructionsVersion: 1
  };

  it("3.T1 returns NO_DISPATCH for ordinary commits", async () => {
    const changes = [
      { status: "M", path: "src/index.ts" },
      { status: "A", path: "README.md" }
    ];
    const result = await inspector.inspectChanges(
      changes,
      async () => "",
      "commit-1"
    );

    expect(result.type).toBe("NO_DISPATCH");
  });

  it("3.T2 accepts a valid isolated dispatch commit", async () => {
    const changes = [{ status: "A", path: ".orca/dispatch/disp-101.json" }];
    const result = await inspector.inspectChanges(
      changes,
      async () => JSON.stringify(validPayload),
      "commit-2"
    );

    expect(result.type).toBe("VALID_DISPATCH");
    if (result.type === "VALID_DISPATCH") {
      expect(result.dispatchId).toBe("disp-101");
      expect(result.dispatch).toEqual(validPayload);
    }
  });

  it("3.T3 rejects mixed commits with source files and dispatch file", async () => {
    const changes = [
      { status: "A", path: ".orca/dispatch/disp-101.json" },
      { status: "M", path: "src/app.ts" }
    ];
    const result = await inspector.inspectChanges(
      changes,
      async () => JSON.stringify(validPayload),
      "commit-3"
    );

    expect(result.type).toBe("REJECTED_DISPATCH");
    if (result.type === "REJECTED_DISPATCH") {
      expect(result.reason).toContain("Mixed commit rejected");
      expect(result.reason).toContain("src/app.ts");
    }
  });

  it("3.T4 rejects multiple dispatch files in single commit", async () => {
    const changes = [
      { status: "A", path: ".orca/dispatch/disp-101.json" },
      { status: "A", path: ".orca/dispatch/disp-102.json" }
    ];
    const result = await inspector.inspectChanges(
      changes,
      async () => JSON.stringify(validPayload),
      "commit-4"
    );

    expect(result.type).toBe("REJECTED_DISPATCH");
    if (result.type === "REJECTED_DISPATCH") {
      expect(result.reason).toContain("Multiple dispatch files");
    }
  });

  it("3.T5 rejects modifications to existing dispatch files", async () => {
    const changes = [{ status: "M", path: ".orca/dispatch/disp-101.json" }];
    const result = await inspector.inspectChanges(
      changes,
      async () => JSON.stringify(validPayload),
      "commit-5"
    );

    expect(result.type).toBe("REJECTED_DISPATCH");
    if (result.type === "REJECTED_DISPATCH") {
      expect(result.reason).toContain("Dispatch immutability violation");
    }
  });

  it("3.T6 rejects dispatch ID mismatch between filename and payload", async () => {
    const changes = [{ status: "A", path: ".orca/dispatch/disp-mismatch.json" }];
    const result = await inspector.inspectChanges(
      changes,
      async () => JSON.stringify(validPayload), // has dispatchId: "disp-101"
      "commit-6"
    );

    expect(result.type).toBe("REJECTED_DISPATCH");
    if (result.type === "REJECTED_DISPATCH") {
      expect(result.reason).toContain("Dispatch ID mismatch");
    }
  });

  it("3.T7 rejects malformed JSON in dispatch file", async () => {
    const changes = [{ status: "A", path: ".orca/dispatch/disp-101.json" }];
    const result = await inspector.inspectChanges(
      changes,
      async () => "{ invalid json ...",
      "commit-7"
    );

    expect(result.type).toBe("REJECTED_DISPATCH");
    if (result.type === "REJECTED_DISPATCH") {
      expect(result.reason).toContain("Malformed JSON");
    }
  });
});

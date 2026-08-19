import { describe, it, expect } from "vitest";
import { generateSolWakeMessage } from "../src/index.js";

describe("Sol Wake Message Generation (Task 1)", () => {
  it("1.T1 generates standard trusted wake message", () => {
    const msg = generateSolWakeMessage({
      repositoryName: "TabDock",
      runId: "run-2026-001",
      iteration: 3,
      dispatchId: "disp-2026-003",
      resultStatus: "COMPLETED"
    });

    expect(msg).toContain("Orca-Strator executor turn completed for TabDock.");
    expect(msg).toContain("Run: run-2026-001");
    expect(msg).toContain("Iteration: 3");
    expect(msg).toContain("Dispatch: disp-2026-003");
    expect(msg).toContain("Result status: COMPLETED");
    expect(msg).toContain("Review the latest GitHub main state");
    expect(msg).toContain(".orca/results/disp-2026-003.json");
  });
});

import { describe, it, expect } from "vitest";
import { isTerminalLoopState, getActiveActor, type LoopState } from "../src/index.js";

describe("Loop State Machine Helpers (Task 1)", () => {
  it("1.T1 identifies terminal loop states", () => {
    expect(isTerminalLoopState("GOAL_COMPLETE")).toBe(true);
    expect(isTerminalLoopState("BLOCKED")).toBe(true);
    expect(isTerminalLoopState("NEEDS_HUMAN")).toBe(true);
    expect(isTerminalLoopState("STOPPED")).toBe(true);
    expect(isTerminalLoopState("SOL_STALLED")).toBe(true);
    expect(isTerminalLoopState("EXECUTOR_UNAVAILABLE")).toBe(true);

    expect(isTerminalLoopState("IDLE")).toBe(false);
    expect(isTerminalLoopState("SOL_PENDING")).toBe(false);
    expect(isTerminalLoopState("SOL_REVIEWING")).toBe(false);
    expect(isTerminalLoopState("EXECUTOR_PENDING")).toBe(false);
    expect(isTerminalLoopState("EXECUTING")).toBe(false);
    expect(isTerminalLoopState("PAUSED")).toBe(false);
  });

  it("1.T2 maps active actor from loop state", () => {
    expect(getActiveActor("SOL_PENDING")).toBe("SOL");
    expect(getActiveActor("SOL_REVIEWING")).toBe("SOL");
    expect(getActiveActor("EXECUTOR_PENDING")).toBe("EXECUTOR");
    expect(getActiveActor("EXECUTING")).toBe("EXECUTOR");
    expect(getActiveActor("IDLE")).toBe("NONE");
    expect(getActiveActor("PAUSED")).toBe("NONE");
  });
});

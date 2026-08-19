import { describe, it, expect } from "vitest";
import { shouldNotifyLoopState } from "../src/index.js";

describe("Notification Filtering (Task 2)", () => {
  it("2.T1 surfaces notification for terminal and problem states", () => {
    expect(shouldNotifyLoopState("GOAL_COMPLETE")).toBe(true);
    expect(shouldNotifyLoopState("NEEDS_HUMAN")).toBe(true);
    expect(shouldNotifyLoopState("BLOCKED")).toBe(true);
    expect(shouldNotifyLoopState("SOL_STALLED")).toBe(true);
    expect(shouldNotifyLoopState("EXECUTOR_UNAVAILABLE")).toBe(true);
    expect(shouldNotifyLoopState("RECOVERY_REQUIRED")).toBe(true);
    expect(shouldNotifyLoopState("STOPPED")).toBe(true);
  });

  it("2.T2 keeps regular iterations and progression quiet", () => {
    expect(shouldNotifyLoopState("IDLE")).toBe(false);
    expect(shouldNotifyLoopState("SOL_PENDING")).toBe(false);
    expect(shouldNotifyLoopState("SOL_REVIEWING")).toBe(false);
    expect(shouldNotifyLoopState("EXECUTOR_PENDING")).toBe(false);
    expect(shouldNotifyLoopState("EXECUTING")).toBe(false);
    expect(shouldNotifyLoopState("PAUSED")).toBe(false);
    expect(shouldNotifyLoopState("DRAINING")).toBe(false);
  });
});

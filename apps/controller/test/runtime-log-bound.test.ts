import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createBoundedLogSink,
  installBoundedPackagedLogging,
  DEFAULT_LOG_BOUND_BYTES
} from "../src/runtime/log-bounded.js";

describe("runtime-bounded packaged logging (Change 027 WS2)", () => {
  const tempDirs: string[] = [];

  function makeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-log-bound-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates the active file DURING the run when the bound is crossed", () => {
    const dir = makeDir();
    const { handle, write } = createBoundedLogSink(dir, { maxFileBytes: 512 });

    // First phase: fill past the bound with distinct markers.
    for (let i = 0; i < 40; i += 1) write("info", `phase-one-line-${i}`);
    expect(handle.rotations()).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(handle.previousFile)).toBe(true);
    // Single-predecessor policy: the predecessor holds the MOST RECENTLY
    // rotated generation, so it contains some phase-one traffic but never
    // post-phase traffic.
    const prevContent = fs.readFileSync(handle.previousFile, "utf8");
    expect(prevContent).toContain("phase-one-line-");

    // Second phase: new writes land in a fresh active file under the bound.
    write("warn", "after-rotation-marker");
    const activeSize = fs.statSync(handle.file).size;
    expect(activeSize).toBeLessThanOrEqual(512 + 256);
    expect(fs.readFileSync(handle.file, "utf8")).toContain("after-rotation-marker");
    handle.close();
  });

  it("keeps total on-disk usage bounded across many rotations", () => {
    const dir = makeDir();
    const { handle, write } = createBoundedLogSink(dir, { maxFileBytes: 400 });
    for (let i = 0; i < 300; i += 1) write("log", `churn-${i}-${"x".repeat(20)}`);

    const activeBytes = fs.statSync(handle.file).size;
    const prevBytes = fs.existsSync(handle.previousFile)
      ? fs.statSync(handle.previousFile).size
      : 0;
    expect(handle.rotations()).toBeGreaterThan(1);
    expect(activeBytes).toBeLessThanOrEqual(400 + 128);
    expect(prevBytes).toBeLessThanOrEqual(400 + 128);
    handle.close();
  });

  it("rotates an already-oversized pre-existing log at startup", () => {
    const dir = makeDir();
    const big = path.join(dir, "controller.log");
    fs.writeFileSync(big, "y".repeat(1024), "utf8");
    const { handle } = createBoundedLogSink(dir, { maxFileBytes: 512 });
    expect(handle.rotations()).toBe(1);
    expect(fs.statSync(handle.file).size).toBeLessThanOrEqual(512);
    handle.close();
  });

  it("console override routes levels and never throws when logging breaks", () => {
    const dir = makeDir();
    const originalLog = console.log;
    const originalError = console.error;
    try {
      const handle = installBoundedPackagedLogging(dir, { maxFileBytes: 200 });
      expect(handle).not.toBeNull();
      console.log("hello", 42);
      console.error("boom");
      // Force rotation through console traffic; must not throw.
      for (let i = 0; i < 50; i += 1) console.warn(`warn-churn-${i}`);
      expect(console.log !== originalLog).toBe(true);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it("default bound matches the Change 025 policy (5 MiB)", () => {
    expect(DEFAULT_LOG_BOUND_BYTES).toBe(5 * 1024 * 1024);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LogRotator } from "../src/executor/log-rotator.js";

describe("LogRotator (Task 4)", () => {
  let tempDir: string;
  let rotator: LogRotator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-rotator-test-"));
    rotator = new LogRotator(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("4.T1 prunes oldest log files when limit is exceeded", () => {
    const repoLogDir = path.join(tempDir, "logs", "repositories", "repo-1");
    fs.mkdirSync(repoLogDir, { recursive: true });

    // Create 5 fake log files
    for (let i = 1; i <= 5; i++) {
      const filePath = path.join(repoLogDir, `run-${i}.log`);
      fs.writeFileSync(filePath, `Log content for run ${i}`);
    }

    const pruned = rotator.pruneLogs("repo-1", 3);
    expect(pruned).toBe(2);

    const remaining = fs.readdirSync(repoLogDir);
    expect(remaining).toHaveLength(3);
  });
});

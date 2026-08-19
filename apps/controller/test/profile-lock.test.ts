import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProfileLockManager } from "../src/browser/profile-lock.js";

describe("ProfileLockManager (Task 3)", () => {
  let tempDir: string;
  let lockManager: ProfileLockManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-lock-test-"));
    lockManager = new ProfileLockManager(tempDir);
  });

  afterEach(() => {
    lockManager.release();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("3.T1 acquires lock when unlocked and releases when requested", () => {
    expect(lockManager.isLocked()).toBe(false);

    const acquired = lockManager.acquire("automated_wake");
    expect(acquired).toBe(true);
    expect(lockManager.isLocked()).toBe(true);

    const info = lockManager.getLockInfo();
    expect(info?.pid).toBe(process.pid);
    expect(info?.reason).toBe("automated_wake");

    lockManager.release();
    expect(lockManager.isLocked()).toBe(false);
  });

  it("3.T2 stale lock from dead PID is automatically recovered", () => {
    const lockFile = path.join(tempDir, "profile.lock");
    // Pick an impossibly dead PID (like 99999999)
    const deadPid = 99999999;
    fs.writeFileSync(
      lockFile,
      JSON.stringify({
        pid: deadPid,
        acquiredAt: "2026-08-19T00:00:00.000Z",
        reason: "old_crashed_browser"
      })
    );

    // Should detect dead PID, clean it up, and acquire successfully
    const acquired = lockManager.acquire("fresh_run");
    expect(acquired).toBe(true);

    const info = lockManager.getLockInfo();
    expect(info?.pid).toBe(process.pid);
    expect(info?.reason).toBe("fresh_run");
  });
});

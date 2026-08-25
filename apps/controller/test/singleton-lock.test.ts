import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ControllerRuntimeLock,
  isPidAlive,
  type RuntimeLockMetadata
} from "../src/runtime/singleton-lock.js";
import { ORCA_PROTOCOL_VERSION } from "@orca/shared";

async function deadPid(): Promise<number> {
  // Spawn a trivially exiting process and wait for it; its PID is then dead.
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return child.pid as number;
}

describe("Change 025 controller singleton runtime lock (9.1/9.2)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-lock-test-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function lockFor(pid?: number): ControllerRuntimeLock {
    return new ControllerRuntimeLock(path.join(dataDir, "controller.lock"), pid ? { pid } : {});
  }

  it("acquires an absent lock and writes truthful metadata", () => {
    const lock = lockFor();
    const result = lock.acquire("9.9.9-test");
    expect(result.outcome).toBe("acquired");
    expect(lock.isOwned).toBe(true);

    const meta = JSON.parse(fs.readFileSync(lock.path, "utf8")) as RuntimeLockMetadata;
    expect(meta.service).toBe("orca-controller");
    expect(meta.version).toBe("9.9.9-test");
    expect(meta.protocol).toBe(ORCA_PROTOCOL_VERSION);
    expect(meta.pid).toBe(process.pid);
    expect(typeof meta.startedAt).toBe("string");
  });

  it("preserves the control token across refresh metadata rewrites (Change 027)", () => {
    // Regression: readMetadata() dropped controlToken, so the post-bind
    // refresh({endpoint}) rewrote the lock WITHOUT the token and every
    // desktop replacement/upgrade flow silently lost its authenticated
    // shutdown path (found by the upgrade-preservation harness).
    const lock = lockFor();
    expect(lock.acquire("1.0.0-token-regression").outcome).toBe("acquired");
    lock.refresh({ endpoint: "http://127.0.0.1:47444" });

    const meta = JSON.parse(fs.readFileSync(lock.path, "utf8")) as RuntimeLockMetadata;
    expect(meta.endpoint).toBe("http://127.0.0.1:47444");
    expect(typeof meta.controlToken).toBe("string");
    expect(meta.controlToken).toBe(lock.currentControlToken);
  });

  it("refuses with busy while the owning PID is alive and never deletes its file", async () => {
    const owner = lockFor();
    expect(owner.acquire("1.0.0").outcome).toBe("acquired");

    const contender = lockFor(await deadPid());
    // Contender's simulated PID is irrelevant: the FILE holds the live owner.
    const result = contender.acquire("2.0.0");
    expect(result.outcome).toBe("busy");
    if (result.outcome === "busy") {
      expect(result.current.pid).toBe(process.pid);
      expect(result.current.version).toBe("1.0.0");
    }
    expect(fs.existsSync(contender.path)).toBe(true);
  });

  it("reclaims a demonstrably stale lock whose recorded PID is dead", async () => {
    const staleOwnerPid = await deadPid();
    const stale = new ControllerRuntimeLock(path.join(dataDir, "controller.lock"), { pid: staleOwnerPid });
    expect(stale.acquire("1.0.0").outcome).toBe("acquired");
    // The owner crashed without releasing: the lock file stays behind.

    const next = lockFor();
    const result = next.acquire("2.0.0");
    expect(result.outcome).toBe("reclaimed-stale");
    if (result.outcome === "reclaimed-stale") {
      expect(result.previous?.pid).toBe(staleOwnerPid);
      expect(result.reason).toContain("not-alive");
    }
    expect(JSON.parse(fs.readFileSync(next.path, "utf8")).pid).toBe(process.pid);
  });

  it("reclaims a corrupt/unrecognized lock file safely", () => {
    const lockPath = path.join(dataDir, "controller.lock");
    fs.writeFileSync(lockPath, "not-json at all", "utf8");
    const lock = lockFor();
    const result = lock.acquire("3.0.0");
    expect(result.outcome).toBe("reclaimed-stale");
    if (result.outcome === "reclaimed-stale") {
      expect(result.previous).toBeNull();
      expect(result.reason).toContain("unrecognized-lock-content");
    }
  });

  it("resolves concurrent acquisition so exactly one contender wins", async () => {
    const a = lockFor();
    const b = lockFor();
    const results = await Promise.all([a.acquire("a"), b.acquire("b")]);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes[0]).toBe("acquired");
    expect(["busy", "reclaimed-stale"]).toContain(outcomes[1]);
    // Only one of them may consider itself the owner afterwards.
    expect(a.isOwned !== b.isOwned || outcomes.every((o) => o === "acquired" && false)).toBe(true);
  });

  it("release removes only our own lock, not a foreign one", async () => {
    const impostor = new ControllerRuntimeLock(path.join(dataDir, "controller.lock"), { pid: 424242 });
    // Simulate a foreign-but-alive-looking lock by writing directly.
    fs.writeFileSync(
      path.join(dataDir, "controller.lock"),
      JSON.stringify({
        service: "orca-controller",
        pid: process.pid,
        startedAt: new Date().toISOString(),
        version: "foreign",
        protocol: ORCA_PROTOCOL_VERSION
      })
    );
    // Force ownership flag without acquire to exercise guarded release path.
    impostor["owned"] = true;
    impostor.release();
    expect(fs.existsSync(path.join(dataDir, "controller.lock"))).toBe(true);
  });
});

describe("isPidAlive liveness probe", () => {
  it("reports own PID alive and a fresh dead PID not alive", async () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(await deadPid())).toBe(false);
  });

  it("treats invalid PIDs as dead", () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-5)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });
});

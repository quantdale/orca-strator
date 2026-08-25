import { describe, it, expect, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import {
  buildControllerSpawnPlan,
  buildDevFallbackSpawnPlan,
  ensureController,
  parseIdentityBody,
  probeController,
  type EnsureControllerDeps,
  type ProbeOutcome
} from "../src/controller-supervisor.js";

const BASE = "http://127.0.0.1:47100";

interface FakeChild {
  pid: number;
  exited: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  exitListeners: Array<(code: number | null, signal: string | null) => void>;
  unref: ReturnType<typeof vi.fn>;
}

function fakeChild(pid = 5555): FakeChild {
  return {
    pid,
    exited: false,
    exitCode: null,
    exitSignal: null,
    exitListeners: [],
    unref: vi.fn()
  };
}

type ExitListener = (code: number | null, signal: string | null) => void;

function makeSpawnFn(children: FakeChild[]): {
  fn: NonNullable<EnsureControllerDeps["spawnFn"]>;
  exitAll: (code: number | null, signal?: string | null) => void;
} {
  const fn = vi.fn((_command: string, _args: string[], _opts: unknown): ChildProcess => {
    const child = fakeChild(5000 + children.length);
    children.push(child);
    // Minimal ChildProcess-compatible stand-in for the supervisor contract.
    return {
      pid: child.pid,
      once(event: string, cb: ExitListener) {
        if (event === "exit") {
          child.exitListeners.push(cb);
        }
        return this as unknown as ChildProcess;
      },
      unref: () => undefined
    } as unknown as ChildProcess;
  }) as unknown as NonNullable<EnsureControllerDeps["spawnFn"]>;
  return {
    fn,
    exitAll(code, signal = null) {
      for (const child of children) {
        child.exited = true;
        child.exitCode = code;
        child.exitSignal = signal;
        for (const cb of child.exitListeners) cb(code, signal);
      }
    }
  };
}

function identity(overrides: Record<string, unknown> = {}) {
  return { service: "orca-controller", version: "0.1.0", protocol: 1, pid: 1234, ...overrides };
}

function fixedProbe(outcome: ProbeOutcome): NonNullable<EnsureControllerDeps["probeFn"]> {
  return async () => outcome;
}

/** Probe that yields each scripted outcome once, repeating the last one. */
function sequencedProbe(...sequence: ProbeOutcome[]): NonNullable<EnsureControllerDeps["probeFn"]> {
  let i = 0;
  return async () => sequence[Math.min(i++, sequence.length - 1)];
}

/** Sleeps block on a one-shot gate until release() opens it (deterministic polls). */
function gatedSleep(): { fn: NonNullable<EnsureControllerDeps["sleepFn"]>; release: () => void } {
  let releaseFn!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  const fn = vi.fn(async () => {
    await gate;
  }) as unknown as NonNullable<EnsureControllerDeps["sleepFn"]>;
  return { fn, release: () => releaseFn() };
}

function baseDeps(over: Partial<EnsureControllerDeps> = {}): EnsureControllerDeps {
  return {
    baseUrl: BASE,
    version: "9.9.9",
    electronExecPath: "electron.exe",
    resourcesPath: "C:/app/resources",
    desktopDistDir: ".",
    packaged: true,
    spawnFn: (() => {
      throw new Error("spawn should not be called");
    }) as unknown as NonNullable<EnsureControllerDeps["spawnFn"]>,
    sleepFn: async () => {},
    budgetMs: 1000,
    ...over
  };
}

describe("Change 025 desktop controller supervision", () => {
  it("reuses an exactly-matching live controller without spawning (9.4 / 026-A)", async () => {
    const onState = vi.fn();
    const result = await ensureController(
      baseDeps({
        version: "0.1.0",
        probeFn: fixedProbe({ kind: "compatible", identity: identity() }),
        onState
      })
    );
    expect(result.outcome).toBe("connected");
    if (result.outcome === "connected") {
      expect(result.reused).toBe(true);
    }
    const states = onState.mock.calls.map((c) => c[0]);
    expect(states).toEqual(["CHECKING_CONTROLLER", "CONNECTED"]);
  });

  it("refuses an incompatible Orca controller terminally (9.4)", async () => {
    const onState = vi.fn();
    const result = await ensureController(
      baseDeps({
        probeFn: fixedProbe({
          kind: "incompatible",
          identity: identity({ protocol: 999 }),
          reason: "protocol mismatch"
        }),
        onState
      })
    );
    expect(result).toMatchObject({ outcome: "terminal", state: "INCOMPATIBLE_CONTROLLER" });
    expect(onState).toHaveBeenCalledWith("INCOMPATIBLE_CONTROLLER", expect.any(String));
  });

  it("reports PORT_CONFLICT for a foreign listener and never spawns (9.3)", async () => {
    const spawnFn = vi.fn(() => {
      throw new Error("must not spawn");
    });
    const result = await ensureController(
      baseDeps({ probeFn: fixedProbe({ kind: "foreign", status: 200 }), spawnFn: spawnFn as never })
    );
    expect(result).toMatchObject({ outcome: "terminal", state: "PORT_CONFLICT" });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("spawns exactly one packaged Node-mode process and connects on readiness (9.6)", async () => {
    const children: FakeChild[] = [];
    const { fn: spawnFn } = makeSpawnFn(children);
    const probe = sequencedProbe(
      { kind: "absent" },
      { kind: "compatible", identity: identity({ pid: 7777, version: "9.9.9" }) }
    );
    const { fn: sleepFn, release } = gatedSleep();

    const promise = ensureController(baseDeps({ probeFn: probe, spawnFn, sleepFn }));
    release();
    const result = await promise;

    expect(result).toMatchObject({ outcome: "connected", reused: false });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(children[0].unref ?? null).toBeDefined();

    const call = (spawnFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const planEnv = call[2].env as NodeJS.ProcessEnv;
    const planArgs = call[1] as string[];
    expect(planEnv.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(planEnv.ORCA_PACKAGED).toBe("1");
    expect(planEnv.ORCA_BUILD_VERSION).toBe("9.9.9");
    expect(planArgs[0].replace(/\\/g, "/")).toContain("resources/controller/dist/index.js");
  });

  it("maps an early child exit 11 to PORT_CONFLICT after losing the ownership race", async () => {
    const children: FakeChild[] = [];
    const { fn: spawnFn, exitAll } = makeSpawnFn(children);
    const probe = sequencedProbe({ kind: "absent" }, { kind: "absent" }, { kind: "absent" });
    const { fn: sleepFn, release } = gatedSleep();

    const promise = ensureController(baseDeps({ probeFn: probe, spawnFn, sleepFn }));
    // Let the initial probe resolve and the spawn occur before signalling exit.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(children).toHaveLength(1);
    exitAll(11);
    release();
    const result = await promise;

    expect(result).toMatchObject({ outcome: "terminal", state: "PORT_CONFLICT" });
  });

  it("reports STARTUP_FAILED when the readiness budget is exhausted", async () => {
    const children: FakeChild[] = [];
    const { fn: spawnFn } = makeSpawnFn(children);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ kind: "absent" }));
    const result = await ensureController(
      baseDeps({ probeFn: probe as never, spawnFn, budgetMs: 0 })
    );
    expect(result).toMatchObject({ outcome: "terminal", state: "STARTUP_FAILED" });
    // Two probes: the initial pre-spawn check plus the final post-budget check.
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("dev fallback refuses to spawn without the explicit gate flag", () => {
    delete process.env.ORCA_ALLOW_DEV_CONTROLLER_SPAWN;
    const plan = buildDevFallbackSpawnPlan({
      electronExecPath: "e.exe",
      desktopDistDir: path.join("apps", "desktop", "dist"),
      version: "0.1.0"
    });
    expect(plan).toBeNull();
  });

  it("packaged spawn plan targets the staged controller entry in Node mode", () => {
    const plan = buildControllerSpawnPlan({
      electronExecPath: "C:/app/Orca.exe",
      resourcesPath: "C:/app/resources",
      version: "1.2.3"
    });
    expect(plan.command).toBe("C:/app/Orca.exe");
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(plan.env.NODE_ENV).toBe("production");
    expect(plan.args[0].replace(/\\/g, "/")).toBe("C:/app/resources/controller/dist/index.js".replace(/\//g, "/"));
  });

  it("identity parsing accepts only well-formed orca-controller identities", () => {
    expect(parseIdentityBody(JSON.stringify(identity()))).not.toBeNull();
    expect(parseIdentityBody(JSON.stringify({ identity: identity() }))).not.toBeNull();
    expect(parseIdentityBody(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseIdentityBody("<html>router page</html>")).toBeNull();
  });

  it("probeController stays absent against an unreachable port", async () => {
    const absent = await probeController("http://127.0.0.1:9");
    expect(absent.kind).toBe("absent");
  });
});

// ---------------------------------------------------------------------------
// Change 026: exact-build compatibility, safe replacement, downgrade states
// ---------------------------------------------------------------------------

import {
  attemptControllerReplacement,
  readControllerLockInfo,
  fetchLifecycleStatus,
  requestGracefulShutdown,
  type ControllerLockInfo,
  type ReplacementDeps,
  type ReplacementOutcome
} from "../src/controller-supervisor.js";
import fs from "node:fs";
import os from "node:os";

describe("Change 026 controller compatibility policy", () => {
  it("A: exact build (version+buildId) is reused", async () => {
    const spawnFn = vi.fn(() => {
      throw new Error("must not spawn");
    });
    const result = await ensureController(
      baseDeps({
        version: "1.2.3",
        buildId: "abc123",
        spawnFn: spawnFn as never,
        probeFn: fixedProbe({ kind: "compatible", identity: identity({ version: "1.2.3", buildId: "abc123" }) })
      })
    );
    expect(result).toMatchObject({ outcome: "connected", reused: true });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("B: packaged desktop detects a different installed build instead of reusing", async () => {
    const onState = vi.fn();
    const replacement = vi.fn(async (): Promise<ReplacementOutcome> => ({
      outcome: "active-campaigns",
      detail: "2 active campaigns still running under the previous controller.",
      activeCampaigns: []
    }));
    const result = await ensureController(
      baseDeps({
        version: "0.2.0",
        buildId: "newbuild",
        dataDir: "C:/data/orca",
        probeFn: fixedProbe({ kind: "compatible", identity: identity({ version: "0.1.0", buildId: "oldbuild" }) }),
        replacementFn: replacement,
        onState
      })
    );
    expect(result.outcome).toBe("restart-pending");
    expect(replacement).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledWith("RESTART_PENDING", expect.stringContaining("background work continues"));
  });

  it("B: packaged desktop replaces a mismatched idle build and spawns its own", async () => {
    const children: FakeChild[] = [];
    const { fn: spawnFn } = makeSpawnFn(children);
    const replacement = vi.fn(async (): Promise<ReplacementOutcome> => ({
      outcome: "replaced",
      detail: "Previous controller exited gracefully and released ownership."
    }));
    // After replacement the old owner is gone; probes see absent then our build ready.
    const probe = sequencedProbe(
      { kind: "compatible", identity: identity({ version: "0.1.0", buildId: "old" }) },
      { kind: "absent" },
      { kind: "compatible", identity: identity({ version: "9.9.9", buildId: undefined }) }
    );
    const result = await ensureController(
      baseDeps({ dataDir: "C:/data/orca", probeFn: probe, spawnFn, replacementFn: replacement })
    );
    expect(result).toMatchObject({ outcome: "connected", reused: false });
    expect(replacement).toHaveBeenCalledOnce();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("B: dev mode tolerates version skew with protocol match (looser reuse)", async () => {
    const result = await ensureController(
      baseDeps({
        version: "0.1.0",
        packaged: false,
        buildId: undefined,
        probeFn: fixedProbe({ kind: "compatible", identity: identity({ version: "0.0.9-dev", pid: 4242 }) })
      })
    );
    expect(result).toMatchObject({ outcome: "connected", reused: true });
  });

  it("C: protocol mismatch is rejected without lifecycle requests or spawning", async () => {
    const spawnFn = vi.fn(() => {
      throw new Error("must not spawn");
    });
    const replacement = vi.fn(async (): Promise<ReplacementOutcome> => ({ outcome: "replaced", detail: "x" }));
    const result = await ensureController(
      baseDeps({
        version: "0.1.0",
        dataDir: "C:/data/orca",
        spawnFn: spawnFn as never,
        replacementFn: replacement,
        probeFn: fixedProbe({ kind: "incompatible", identity: identity({ protocol: 999 }), reason: "protocol mismatch" })
      })
    );
    expect(result).toMatchObject({ outcome: "terminal", state: "INCOMPATIBLE_CONTROLLER" });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("E/F: second desktop facing mismatched owner cannot create a duplicate controller", async () => {
    // Both desktops race; replacement refuses while campaigns are active so no
    // new controller may be spawned against the same data directory.
    const children: FakeChild[] = [];
    const { fn: spawnFn } = makeSpawnFn(children);
    const replacement = vi.fn(async (): Promise<ReplacementOutcome> => ({
      outcome: "active-campaigns",
      detail: "active campaigns",
      activeCampaigns: []
    }));
    const deps = () =>
      baseDeps({
        version: "0.2.0",
        dataDir: "C:/data/orca",
        spawnFn,
        replacementFn: replacement,
        probeFn: fixedProbe({ kind: "compatible", identity: identity({ version: "0.1.0", buildId: "old" }) })
      });
    const [a, b] = await Promise.all([ensureController(deps()), ensureController(deps())]);
    expect(a.outcome).toBe("restart-pending");
    expect(b.outcome).toBe("restart-pending");
    expect(spawnFn).not.toHaveBeenCalled();
    expect(children).toHaveLength(0);
  });

  it("DATABASE_INCOMPATIBLE surfaces DATABASE_TOO_NEW recovery state", async () => {
    const onState = vi.fn();
    const result = await ensureController(
      baseDeps({
        version: "0.1.0",
        maxSchemaVersion: 23,
        probeFn: fixedProbe({
          kind: "compatible",
          identity: identity({ version: "0.1.0", maxSchemaVersion: 25 })
        }),
        onState
      })
    );
    expect(result).toMatchObject({ outcome: "terminal", state: "DATABASE_TOO_NEW" });
    expect(onState).toHaveBeenCalledWith("DATABASE_TOO_NEW", expect.stringContaining("not modified"));
  });

  it("maps child exit code 12 to DATABASE_TOO_NEW", async () => {
    const children: FakeChild[] = [];
    const { fn: spawnFn, exitAll } = makeSpawnFn(children);
    const probe = sequencedProbe({ kind: "absent" }, { kind: "absent" }, { kind: "absent" });
    // Real timer yields let the test's exitAll macrotask interleave with polls.
    const promise = ensureController(
      baseDeps({ version: "0.1.0", probeFn: probe, spawnFn, sleepFn: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) })
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(children).toHaveLength(1);
    exitAll(12);
    const result = await promise;
    expect(result).toMatchObject({ outcome: "terminal", state: "DATABASE_TOO_NEW" });
  });

  it("identity parsing validates additive 026 fields when present", () => {
    expect(parseIdentityBody(JSON.stringify(identity({ buildId: "abc", mode: "packaged", maxSchemaVersion: 23 })))).not.toBeNull();
    expect(parseIdentityBody(JSON.stringify(identity({ mode: "bogus" })))).toBeNull();
    expect(parseIdentityBody(JSON.stringify(identity({ maxSchemaVersion: "nope" })))).toBeNull();
    expect(parseIdentityBody(JSON.stringify(identity({ buildId: 42 })))).toBeNull();
  });
});

describe("Change 026 authenticated graceful replacement", () => {
  function lockInfo(over: Partial<ControllerLockInfo> = {}): ControllerLockInfo {
    return { pid: process.pid, controlToken: "tok-123", version: "0.1.0", ...over };
  }

  function baseReplacementDeps(over: Partial<ReplacementDeps> = {}): ReplacementDeps {
    return {
      baseUrl: BASE,
      dataDir: "C:/data/orca",
      sleepFn: async () => {},
      ...over
    };
  }

  it("refuses to act when ownership metadata is absent (never guesses)", async () => {
    const outcome = await attemptControllerReplacement(
      baseReplacementDeps({ lockInfoFn: () => null })
    );
    expect(outcome.outcome).toBe("lock-absent");
  });

  it("treats a demonstrably dead owner as stale rather than replaceable", async () => {
    const outcome = await attemptControllerReplacement(
      baseReplacementDeps({ lockInfoFn: () => lockInfo({ pid: 999999 }) })
    );
    expect(outcome.outcome).toBe("owner-dead");
  });

  it("refuses pre-026 controllers without control tokens (cannot prove safety)", async () => {
    const lifecycle = vi.fn();
    const shutdown = vi.fn();
    const outcome = await attemptControllerReplacement(
      baseReplacementDeps({
        lockInfoFn: () => lockInfo({ controlToken: undefined }),
        lifecycleFn: lifecycle as never,
        shutdownFn: shutdown as never
      })
    );
    expect(outcome.outcome).toBe("not-replaceable");
    expect(lifecycle).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("reports active campaigns truthfully without terminating anything", async () => {
    const lifecycle = vi.fn(async () => ({
      ok: true as const,
      status: {
        state: "active-campaigns" as const,
        activeCampaigns: [{ repositoryId: "r1", runId: "run1", loopState: "EXECUTING" }]
      }
    }));
    const shutdown = vi.fn();
    const outcome = await attemptControllerReplacement(
      baseReplacementDeps({
        lockInfoFn: () => lockInfo(),
        lifecycleFn: lifecycle as never,
        shutdownFn: shutdown as never
      })
    );
    expect(outcome.outcome).toBe("active-campaigns");
    if (outcome.outcome === "active-campaigns") {
      expect(outcome.activeCampaigns).toHaveLength(1);
    }
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("token rejection from the lifecycle endpoint blocks replacement", async () => {
    const lifecycle = vi.fn(async () => ({ ok: false as const, reason: "token-rejected" }));
    const outcome = await attemptControllerReplacement(
      baseReplacementDeps({
        lockInfoFn: () => lockInfo(),
        lifecycleFn: lifecycle as never,
        shutdownFn: vi.fn() as never
      })
    );
    expect(outcome.outcome).toBe("not-replaceable");
  });

  it("idle controller: accepted shutdown waits for real exit + lock release", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orca-replace-"));
    const lockPath = path.join(tmp, "controller.lock");
    fs.writeFileSync(lockPath, JSON.stringify(lockInfo()));
    let lockRemoved = false;
    let ownerAlive = true;
    const lifecycle = vi.fn(async () => ({ ok: true as const, status: { state: "idle" as const } }));
    const shutdown = vi.fn(async () => {
      ownerAlive = false; // graceful exit happens between accept and teardown
      return { accepted: true as const };
    });
    const lockInfoFn = vi.fn(() => (lockRemoved ? null : lockInfo()));
    const outcome = await attemptControllerReplacement(
      baseReplacementDeps({
        dataDir: tmp,
        lockInfoFn: lockInfoFn as never,
        aliveFn: () => ownerAlive,
        lifecycleFn: lifecycle as never,
        shutdownFn: shutdown as never,
        sleepFn: async () => {
          if (!ownerAlive && !lockRemoved) {
            lockRemoved = true;
            try { fs.rmSync(lockPath); } catch { /* already gone */ }
          }
        }
      })
    );
    expect(outcome.outcome).toBe("replaced");
    expect(shutdown).toHaveBeenCalledOnce();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("accepted shutdown that never exits becomes a truthful timeout", async () => {
    const lifecycle = vi.fn(async () => ({ ok: true as const, status: { state: "idle" as const } }));
    const shutdown = vi.fn(async () => ({ accepted: true as const }));
    const outcome = await attemptControllerReplacement(
      baseReplacementDeps({
        lockInfoFn: () => lockInfo(),
        aliveFn: () => true,
        lifecycleFn: lifecycle as never,
        shutdownFn: shutdown as never,
        shutdownTimeoutMs: 30,
        sleepFn: async () => {}
      })
    );
    expect(outcome.outcome).toBe("shutdown-timeout");
  });

  it("readControllerLockInfo parses service-tagged metadata only", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orca-lockinfo-"));
    try {
      expect(readControllerLockInfo(tmp)).toBeNull();
      fs.writeFileSync(path.join(tmp, "controller.lock"), "{service:'other'}");
      expect(readControllerLockInfo(tmp)).toBeNull();
      fs.writeFileSync(
        path.join(tmp, "controller.lock"),
        JSON.stringify({ service: "orca-controller", pid: 7, controlToken: "t" })
      );
      const info = readControllerLockInfo(tmp);
      expect(info).toMatchObject({ pid: 7, controlToken: "t" });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

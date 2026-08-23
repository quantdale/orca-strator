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
  it("reuses a compatible live controller without spawning (9.4)", async () => {
    const onState = vi.fn();
    const result = await ensureController(
      baseDeps({ probeFn: fixedProbe({ kind: "compatible", identity: identity() }), onState })
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
    const probe = sequencedProbe({ kind: "absent" }, { kind: "compatible", identity: identity({ pid: 7777 }) });
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

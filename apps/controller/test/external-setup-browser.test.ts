import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  ExternalSetupBrowserLauncher,
  SETUP_LOGIN_URL,
  type CapturedSpawnInvocation,
  type SpawnFunction,
} from "../src/browser/external-setup-browser.js";

/**
 * Deterministic fake Chrome process: records spawn invocations, exposes a
 * controllable pid/exit lifecycle. No OS quirks, no real binary required.
 */
class FakeChildProcess extends EventEmitter {
  constructor(
    public readonly pid: number,
    public exitCode: number | null = null,
    public signalCode: NodeJS.Signals | null = null,
  ) {
    super();
  }

  killSignal(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.exitCode ??= 0;
      this.emit("exit", this.exitCode, signal);
    });
    return true;
  }
}

function fakeSpawnSeam(): {
  spawnFn: SpawnFunction;
  invocations: CapturedSpawnInvocation[];
  children: FakeChildProcess[];
} {
  const invocations: CapturedSpawnInvocation[] = [];
  const children: FakeChildProcess[] = [];
  let nextPid = 4242;
  const spawnFn: SpawnFunction = ((
    exe: string,
    args: readonly string[],
    options: any,
  ) => {
    invocations.push({ executablePath: exe, args: [...args], options });
    const child = new FakeChildProcess(nextPid++);
    children.push(child);
    return child as unknown as ChildProcess;
  }) as SpawnFunction;
  return { spawnFn, invocations, children };
}

function realSpawnSeam(): SpawnFunction {
  // Lazy import keeps vitest happy about ESM/CJS interop of node:child_process.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } =
    require("node:child_process") as typeof import("node:child_process");
  return spawn as unknown as SpawnFunction;
}

describe("External setup-browser launcher (Change 023)", () => {
  const PROFILE = "C:\\orca\\dedicated\\profile";
  const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  let launcher: ExternalSetupBrowserLauncher;

  beforeEach(() => {
    launcher = new ExternalSetupBrowserLauncher();
  });

  afterEach(async () => {
    await launcher.close().catch(() => {});
  });

  it("spawns with EXACTLY [--user-data-dir=<profile>, login URL] — pinned argv snapshot", () => {
    const { spawnFn, invocations } = fakeSpawnSeam();
    const pinned = new ExternalSetupBrowserLauncher(spawnFn);

    const { pid } = pinned.spawn(CHROME, PROFILE, SETUP_LOGIN_URL);
    expect(pid).toBe(4242);

    expect(invocations).toHaveLength(1);
    expect(invocations[0].executablePath).toBe(CHROME);
    // The FULL argument list — nothing else may ever appear here.
    expect(invocations[0].args).toEqual([
      `--user-data-dir=${PROFILE}`,
      SETUP_LOGIN_URL,
    ]);
    expect(invocations[0].args).toHaveLength(2);

    // Prohibited flags can never appear in any launcher argv.
    const joined = invocations[0].args.join(" ").toLowerCase();
    expect(joined).not.toContain("automationcontrolled");
    expect(joined).not.toContain("--no-sandbox");
    expect(joined).not.toContain("user-agent");
    expect(joined).not.toContain("remote-debugging");
    expect(joined).not.toContain("headless");
  });

  it("reports PID liveness while running and resolves exit on process exit", async () => {
    const { spawnFn, children } = fakeSpawnSeam();
    const pinned = new ExternalSetupBrowserLauncher(spawnFn);

    const { pid, exit } = pinned.spawn(CHROME, PROFILE, SETUP_LOGIN_URL);
    expect(pid).toBe(children[0].pid);
    expect(pinned.isRunning()).toBe(true);

    children[0].killSignal("SIGTERM");
    const result = await exit;
    expect(result.code).toBe(0);
    expect(pinned.isRunning()).toBe(false);
  });

  it("close() signals the child and waits for exit", async () => {
    const { spawnFn, children } = fakeSpawnSeam();
    const pinned = new ExternalSetupBrowserLauncher(spawnFn, async () => {
      // Simulate the real tree-kill (taskkill /T /F) terminating the process.
      children[0].killSignal("SIGKILL");
    });

    pinned.spawn(CHROME, PROFILE, SETUP_LOGIN_URL);
    await pinned.close();

    expect(children[0].signalCode).not.toBeNull();
    expect(pinned.isRunning()).toBe(false);
  });

  it("close() is safe when nothing is running", async () => {
    await expect(launcher.close()).resolves.toBeUndefined();
  });

  it("refuses a second concurrent spawn from the same launcher", () => {
    const { spawnFn } = fakeSpawnSeam();
    const pinned = new ExternalSetupBrowserLauncher(spawnFn);

    pinned.spawn(CHROME, PROFILE, SETUP_LOGIN_URL);
    expect(() => pinned.spawn(CHROME, PROFILE, SETUP_LOGIN_URL)).toThrow(
      /already running/,
    );
  });

  it("spawn returning an undefined pid surfaces a thrown error", () => {
    const brokenSpawn: SpawnFunction = (() => {
      const child = new FakeChildProcess(undefined as unknown as number);
      return child as unknown as ChildProcess;
    }) as SpawnFunction;
    const pinned = new ExternalSetupBrowserLauncher(brokenSpawn);

    expect(() => pinned.spawn(CHROME, PROFILE, SETUP_LOGIN_URL)).toThrow(
      /Failed to spawn/,
    );
  });

  it("SETUP_LOGIN_URL is the ChatGPT auth login page", () => {
    expect(SETUP_LOGIN_URL).toBe("https://chatgpt.com/auth/login");
  });

  describe("real-process mechanics (node.exe as stand-in binary)", () => {
    it("spawn yields a live OS pid whose exit resolves the promise", async () => {
      // node --user-data-dir=... exits immediately with a bad-option error —
      // which is exactly what we need: a REAL os process with REAL exit event.
      const real = new ExternalSetupBrowserLauncher(realSpawnSeam());
      const { pid, exit } = real.spawn(
        process.execPath,
        PROFILE,
        SETUP_LOGIN_URL,
      );

      expect(Number.isFinite(pid)).toBe(true);
      const result = await Promise.race([
        exit,
        new Promise<{ code: number | null }>((r) =>
          setTimeout(() => r({ code: -99 }), 8000),
        ),
      ]);
      expect(result.code).not.toBeNull(); // exited (any code) — event wiring proven
      expect(real.isRunning()).toBe(false);
    }, 15000);
  });
});

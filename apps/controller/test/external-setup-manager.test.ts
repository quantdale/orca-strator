import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { ProfileLockManager } from "../src/browser/profile-lock.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type {
  ExternalSetupLauncherLike,
  ExternalSpawnResult,
} from "../src/browser/external-setup-browser.js";
import type { SystemChromeInfo } from "../src/browser/chrome-discovery.js";

/** Deterministic fake external Chrome process owned by the test. */
class FakeExternalLauncher implements ExternalSetupLauncherLike {
  public spawned: { exe: string; profile: string; url: string }[] = [];
  public closeCalls = 0;

  private nextPid: number;
  private current: {
    pid: number;
    resolve: (r: { code: number | null }) => void;
    exited: boolean;
  } | null = null;

  /** pidSeed lets a test use a REAL live pid (e.g. process.pid) for liveness semantics. */
  constructor(private readonly pidSeed?: number) {
    this.nextPid = pidSeed ?? 5000;
  }

  spawn(exe: string, profile: string, url: string): ExternalSpawnResult {
    if (this.current && !this.current.exited) {
      throw new Error("External setup Chrome is already running");
    }
    this.spawned.push({ exe, profile, url });
    const pid = this.nextPid++;
    let resolve!: (r: { code: number | null }) => void;
    const exit = new Promise<{ code: number | null }>((r) => (resolve = r));
    this.current = { pid, resolve, exited: false };
    return { pid, exit };
  }
  async close(): Promise<void> {
    this.closeCalls += 1;
    this.simulateExit(0);
  }

  isRunning(): boolean {
    return !!this.current && !this.current.exited;
  }

  simulateExit(code: number): void {
    if (this.current && !this.current.exited) {
      this.current.exited = true;
      this.current.resolve({ code });
    }
  }

  get pid(): number | null {
    return this.current?.pid ?? null;
  }
}

const FOUND_CHROME: SystemChromeInfo = {
  status: "FOUND",
  executablePath: "C:\\fake\\Google\\Chrome\\Application\\chrome.exe",
  version: "142.0.7444.60",
  source: "test",
};

describe("BrowserManager external setup-Chrome flow (Change 023)", () => {
  let tempDir: string;
  let mockDriver: MockBrowserDriver;
  let fakeLauncher: FakeExternalLauncher;
  let discoveryResult: SystemChromeInfo;
  let browserManager: BrowserManager;
  let wakeStore: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-ext-mgr-"));
    mockDriver = new MockBrowserDriver();
    fakeLauncher = new FakeExternalLauncher();
    discoveryResult = { ...FOUND_CHROME };
    // Minimal SolWakeStore stand-in: manager tests here never persist wakes.
    wakeStore = {
      create: () => {},
      updateStatus: () => {},
      get: () => null,
    };
    browserManager = new BrowserManager({
      dataDir: tempDir,
      driver: mockDriver,
      wakeStore: wakeStore as any,
      discoverSystemChrome: async () => discoveryResult,
      setupLauncher: fakeLauncher,
    });
  });

  afterEach(async () => {
    await browserManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("opens setup as ordinary Chrome with ZERO automation-driver launches", async () => {
    await browserManager.openSetupBrowser();

    // The Playwright driver was NEVER touched during INTERACTIVE_SETUP.
    expect(mockDriver.launchCalls).toHaveLength(0);
    expect(mockDriver.isRunning()).toBe(false);

    expect(fakeLauncher.spawned).toHaveLength(1);
    expect(fakeLauncher.spawned[0]).toEqual({
      exe: FOUND_CHROME.executablePath,
      profile: path.join(tempDir, "browser", "profile"),
      url: "https://chatgpt.com/auth/login",
    });

    const status = browserManager.getStatus();
    expect(status.isSetupOpen).toBe(true);
    expect(status.setupPid).toBe(fakeLauncher.pid);
    expect(status.setupLauncherKind).toBe("external-chrome");
    expect(status.lockHolderPid).toBe(fakeLauncher.pid);
  });

  it("AUTOMATED acquisition is refused while the external Chrome PID owns the lock", async () => {
    // Seed the fake with a REAL live pid so durable liveness checks behave
    // exactly as they would against an actual running chrome.exe.
    const liveLauncher = new FakeExternalLauncher(process.pid);
    const liveManager = new BrowserManager({
      dataDir: tempDir,
      driver: mockDriver,
      wakeStore: wakeStore as any,
      discoverSystemChrome: async () => discoveryResult,
      setupLauncher: liveLauncher,
    });

    await liveManager.openSetupBrowser();

    // A sibling ProfileLockManager over the SAME profile sees the external PID.
    const sibling = new ProfileLockManager(
      path.join(tempDir, "browser", "profile"),
    );
    expect(sibling.isLocked()).toBe(true);
    expect(sibling.getLockInfo()?.mode).toBe("INTERACTIVE_SETUP");
    // AUTOMATED is a different mode even within one process -> refused (J).
    expect(sibling.acquire("AUTOMATED")).toBe(false);
    // NOTE: same-mode acquire with the SAME live owner pid is legitimately
    // re-entrant per ProfileLockManager semantics; a real chrome.exe has its
    // own distinct pid, which every other acquirer then fails to match.

    await liveManager.closeSetupBrowser();
  });

  it("releases ownership when the human closes Chrome, freeing AUTOMATED", async () => {
    await browserManager.openSetupBrowser();
    const pid = fakeLauncher.pid!;

    fakeLauncher.simulateExit(0);
    await new Promise((r) => setTimeout(r, 20)); // exit-event propagation

    const status = browserManager.getStatus();
    expect(status.isSetupOpen).toBe(false);
    expect(status.setupPid).toBeNull();
    expect(status.setupLauncherKind).toBeNull();

    const lock = new ProfileLockManager(
      path.join(tempDir, "browser", "profile"),
    );
    expect(lock.isLocked()).toBe(false);
    expect(lock.acquire("AUTOMATED")).toBe(true);
    expect(browserManager.getStatus().lockHolderPid).not.toBe(pid);
  });

  it("recovers a stale external-PID lock through durable liveness checks", async () => {
    const profileDir = path.join(tempDir, "browser", "profile");
    fs.mkdirSync(profileDir, { recursive: true });
    const deadPid = 99999999;
    fs.writeFileSync(
      path.join(profileDir, "profile.lock"),
      JSON.stringify({
        pid: deadPid,
        acquiredAt: "2026-08-22T00:00:00.000Z",
        mode: "INTERACTIVE_SETUP",
        reason: "INTERACTIVE_SETUP_EXTERNAL_CHROME",
      }),
    );

    // Dead external PID -> stale recovery -> open succeeds.
    await browserManager.openSetupBrowser();
    expect(fakeLauncher.spawned).toHaveLength(1);
    expect(browserManager.getStatus().setupPid).toBe(fakeLauncher.pid);
  });

  it("refuses to open while automation holds the profile and spawns nothing", async () => {
    const lock = new ProfileLockManager(
      path.join(tempDir, "browser", "profile"),
    );
    expect(lock.acquire("AUTOMATED_wake")).toBe(true); // live controller PID

    await expect(browserManager.openSetupBrowser()).rejects.toThrow(
      /owns the profile/i,
    );
    expect(fakeLauncher.spawned).toHaveLength(0);
    expect(mockDriver.launchCalls).toHaveLength(0);

    lock.release();
  });

  it("closeSetupBrowser kills the tree and releases ownership", async () => {
    await browserManager.openSetupBrowser();

    await browserManager.closeSetupBrowser();

    expect(fakeLauncher.closeCalls).toBe(1);
    expect(browserManager.getStatus().isSetupOpen).toBe(false);
    const lock = new ProfileLockManager(
      path.join(tempDir, "browser", "profile"),
    );
    expect(lock.isLocked()).toBe(false);
  });

  it("returns an actionable error when Chrome is NOT_FOUND and never falls back", async () => {
    discoveryResult = {
      status: "NOT_FOUND",
      executablePath: null,
      version: null,
      source: "none",
    };

    await expect(browserManager.openSetupBrowser()).rejects.toThrow(
      /Install Google Chrome/,
    );
    expect(fakeLauncher.spawned).toHaveLength(0);
    expect(mockDriver.launchCalls).toHaveLength(0);
  });

  it("migration guard backs up incompatible profiles before opening Chrome", async () => {
    const profileDir = path.join(tempDir, "browser", "profile");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "Last Version"), "131.0.6778.33");

    await browserManager.openSetupBrowser();

    const parent = path.dirname(profileDir);
    const backups = fs
      .readdirSync(parent)
      .filter((d) => d.startsWith("profile.backup-before-chrome-"));
    expect(backups).toHaveLength(1);
    expect(
      fs
        .readFileSync(path.join(parent, backups[0], "Last Version"), "utf8")
        .trim(),
    ).toBe("131.0.6778.33");
    // Fresh dedicated profile recreated WITHOUT auth state (only the lock file).
    expect(fs.existsSync(profileDir)).toBe(true);
    expect(fs.existsSync(path.join(profileDir, "Last Version"))).toBe(false);
    expect(fs.readdirSync(profileDir)).toEqual(["profile.lock"]);
  });

  it("compatible profiles are left untouched", async () => {
    const profileDir = path.join(tempDir, "browser", "profile");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "Last Version"), "142.9.9.9");

    await browserManager.openSetupBrowser();

    const parent = path.dirname(profileDir);
    expect(fs.readdirSync(parent).filter((d) => d.includes("backup"))).toEqual(
      [],
    );
    expect(
      fs.readFileSync(path.join(profileDir, "Last Version"), "utf8").trim(),
    ).toBe("142.9.9.9");
  });

  it("production automation requires installed Chrome and passes its executablePath", async () => {
    const strictManager = new BrowserManager({
      dataDir: tempDir,
      driver: mockDriver,
      wakeStore: wakeStore as any,
      discoverSystemChrome: async () => discoveryResult,
      requireInstalledChromeForAutomation: true,
    });

    // NOT_FOUND -> actionable CHROME_NOT_READY, zero launches.
    discoveryResult = {
      status: "NOT_FOUND",
      executablePath: null,
      version: null,
      source: "none",
    };
    await expect(
      strictManager.submitSolWake("repo-x", {
        runId: "run-1",
        iteration: 1,
        resultStatus: "COMPLETED",
        conversationUrl: "https://chatgpt.com/c/x",
        repositoryName: "X",
      }),
    ).rejects.toThrow(/CHROME_NOT_READY/);
    expect(mockDriver.launchCalls).toHaveLength(0);

    // FOUND -> installed Chrome executablePath reaches the driver.
    discoveryResult = { ...FOUND_CHROME };
    await strictManager.submitSolWake("repo-y", {
      runId: "run-2",
      iteration: 1,
      resultStatus: "COMPLETED",
      conversationUrl: "https://chatgpt.com/c/y",
      repositoryName: "Y",
    });
    expect(mockDriver.launchCalls).toHaveLength(1);
    expect(mockDriver.launchCalls[0].executablePath).toBe(
      FOUND_CHROME.executablePath,
    );
    expect(mockDriver.launchCalls[0].headless).toBe(true);
  });
});

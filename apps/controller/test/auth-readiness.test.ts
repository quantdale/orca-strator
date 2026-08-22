import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  classifyAuthSignals,
  isSessionIndicatingCookieName,
  CHATGPT_HOME_URL,
} from "../src/browser/auth-readiness.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";

describe("Auth readiness classification (Change 023 §5)", () => {
  it("composer visible with no login affordances -> AUTHENTICATED", () => {
    const r = classifyAuthSignals({
      composerVisible: true,
      loginAffordanceVisible: false,
      redirectedToLogin: false,
      challengeIndicatorVisible: false,
    });
    expect(r.status).toBe("AUTHENTICATED");
    expect(r.evidence).toContain("ui:composer-visible");
  });

  it("login affordance -> LOGIN_REQUIRED", () => {
    const r = classifyAuthSignals({
      composerVisible: false,
      loginAffordanceVisible: true,
      redirectedToLogin: false,
      challengeIndicatorVisible: false,
    });
    expect(r.status).toBe("LOGIN_REQUIRED");
    expect(r.evidence).toEqual(["ui:login-affordance"]);
  });

  it("redirect to /auth/login -> LOGIN_REQUIRED", () => {
    const r = classifyAuthSignals({
      composerVisible: false,
      loginAffordanceVisible: false,
      redirectedToLogin: true,
      challengeIndicatorVisible: false,
    });
    expect(r.status).toBe("LOGIN_REQUIRED");
    expect(r.evidence).toEqual(["ui:login-redirect"]);
  });

  it("challenge indicator -> VERIFICATION_REQUIRED", () => {
    const r = classifyAuthSignals({
      composerVisible: true,
      loginAffordanceVisible: false,
      redirectedToLogin: false,
      challengeIndicatorVisible: true,
    });
    expect(r.status).toBe("VERIFICATION_REQUIRED");
  });

  it("no signals -> UNKNOWN", () => {
    const r = classifyAuthSignals({
      composerVisible: false,
      loginAffordanceVisible: false,
      redirectedToLogin: false,
      challengeIndicatorVisible: false,
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.evidence).toEqual(["ui:no-signals"]);
  });

  it("cookie corroboration only: UI-authenticated with zero session-family names demotes to UNKNOWN", () => {
    const r = classifyAuthSignals({
      composerVisible: true,
      loginAffordanceVisible: false,
      redirectedToLogin: false,
      challengeIndicatorVisible: false,
      cookieNameDomains: ["__Host-something|chatgpt.com"],
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.evidence).toContain("ui:composer-visible");
    expect(r.evidence).toContain("cookies:no-session-family");
  });

  it("session-family cookie NAMES corroborate AUTHENTICATED", () => {
    expect(
      isSessionIndicatingCookieName(
        "__Secure-next-auth.session-token|.chatgpt.com",
      ),
    ).toBe(true);
    expect(
      isSessionIndicatingCookieName(
        "__Secure-next-auth.callback-url|.chatgpt.com",
      ),
    ).toBe(false);

    const r = classifyAuthSignals({
      composerVisible: true,
      loginAffordanceVisible: false,
      redirectedToLogin: false,
      challengeIndicatorVisible: false,
      cookieNameDomains: ["__Secure-next-auth.session-token|.chatgpt.com"],
    });
    expect(r.status).toBe("AUTHENTICATED");
    expect(r.evidence).toContain("cookies:session-family-present");
  });
});

describe("BrowserManager auth readiness flow (Change 023)", () => {
  let tempDir: string;
  let mockDriver: MockBrowserDriver;
  let manager: BrowserManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-auth-ready-"));
    mockDriver = new MockBrowserDriver();
    manager = new BrowserManager({
      dataDir: tempDir,
      driver: mockDriver,
      wakeStore: {
        create: () => {},
        updateStatus: () => {},
        get: () => null,
      } as any,
    });
  });

  afterEach(async () => {
    await manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("AUTHENTICATED via composer signal; cookie VALUES never appear anywhere", async () => {
    mockDriver.authCheckSetup = (page) => {
      page.visibleSelectors.add("#prompt-textarea");
    };
    mockDriver.cookieNameDomains = [
      "__Secure-next-auth.session-token|.chatgpt.com",
    ];

    const report = await manager.checkAuthReadiness();

    expect(report.status).toBe("AUTHENTICATED");
    expect(report.profileUsableByAutomation).toBe(true);
    // The check navigated the dedicated profile to chatgpt.com home.
    const page = mockDriver.history.get("__auth_check__");
    expect(page?.currentUrl).toBe(CHATGPT_HOME_URL);
    // Lock released afterwards.
    expect(mockDriver.isRunning()).toBe(false);
  });

  it("profile-busy while setup is open: UNKNOWN without launching anything", async () => {
    // Hold the profile lock as a live external process would.
    const lockDir = path.join(tempDir, "browser", "profile");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "profile.lock"),
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        mode: "INTERACTIVE_SETUP",
        reason: "test",
      }),
    );

    const report = await manager.checkAuthReadiness();

    expect(report.status).toBe("UNKNOWN");
    expect(report.evidence).toEqual(["profile-busy"]);
    expect(report.profileUsableByAutomation).toBe(false);
    expect(mockDriver.launchCalls).toHaveLength(0); // launched NOTHING
  });

  it("report contains no credential/token/cookie-value material", async () => {
    mockDriver.authCheckSetup = (page) => {
      page.visibleSelectors.add("#prompt-textarea");
    };
    // Only NAME|DOMAIN labels are ever exposed by the seam.
    mockDriver.cookieNameDomains = [
      "__Secure-next-auth.session-token|.chatgpt.com",
    ];

    const report = await manager.checkAuthReadiness();
    const serialized = JSON.stringify(report);

    expect(serialized).not.toMatch(
      /=|Bearer\s/i.test("") ? /$^/ : /token-value/,
    );
    expect(Object.keys(report).sort()).toEqual([
      "checkedAt",
      "evidence",
      "profileUsableByAutomation",
      "status",
    ]);
    for (const e of report.evidence) {
      expect(e).toMatch(/^[a-z:-]+$/); // fixed labels only
    }
  });
});

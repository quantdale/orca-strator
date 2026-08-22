import type { BrowserPage } from "./browser-driver.js";

/**
 * Change 023: ChatGPT auth readiness classification.
 *
 * Truth sources (in priority order):
 *   1. Safe UI/navigation signals of the dedicated profile: login affordances,
 *      composer visibility, login redirects, challenge indicators.
 *   2. Cookie NAME-family inspection as CORROBoration only — never the sole
 *      truth source.
 *
 * Cookie VALUES are never read into memory for reporting, never logged, and
 * never persisted anywhere in Orca. Evidence strings are fixed labels only.
 */

export type AuthReadinessStatus =
  | "AUTHENTICATED"
  | "LOGIN_REQUIRED"
  | "VERIFICATION_REQUIRED"
  | "UNKNOWN";

export interface AuthReadinessReport {
  status: AuthReadinessStatus;
  checkedAt: string;
  /** Fixed evidence labels, e.g. "ui:composer-visible", "profile-busy". */
  evidence: string[];
  profileUsableByAutomation: boolean;
}

export const CHATGPT_HOME_URL = "https://chatgpt.com/";

/** UI selectors inspected for safe readiness signals (names/labels only). */
export const AUTH_SIGNAL_SELECTORS = {
  composer: ["#prompt-textarea", "[data-testid='prompt-textarea']"],
  loginAffordance: ["a[href*='/auth/login']", "[data-testid='login-button']"],
  challenge: [
    "iframe[src*='challenges.cloudflare']",
    "iframe[title*='challenge']",
    "[data-testid*='turnstile']",
  ],
} as const;

/** Cookie name families that INDICATE a session; only names/domains are touched. */
const SESSION_COOKIE_NAME_PATTERNS = [
  /__secure-next-auth\.session-token/i,
  /session-token/i,
  /__session/i,
];

/** Pure classifier — deterministic and directly unit-testable. */
export function classifyAuthSignals(signals: {
  composerVisible: boolean;
  loginAffordanceVisible: boolean;
  redirectedToLogin: boolean;
  challengeIndicatorVisible: boolean;
  /** Cookie "name|domain" labels from the dedicated profile; empty array = none seen. */
  cookieNameDomains?: string[];
}): { status: AuthReadinessStatus; evidence: string[] } {
  if (signals.challengeIndicatorVisible) {
    return {
      status: "VERIFICATION_REQUIRED",
      evidence: ["ui:challenge-indicator"],
    };
  }

  if (signals.loginAffordanceVisible || signals.redirectedToLogin) {
    return {
      status: "LOGIN_REQUIRED",
      evidence: signals.loginAffordanceVisible
        ? ["ui:login-affordance"]
        : ["ui:login-redirect"],
    };
  }

  if (signals.composerVisible) {
    // Cookie corroboration ONLY: a strong contradiction (UI says authenticated
    // but zero session-indicating cookie NAMES) demotes to UNKNOWN.
    if (signals.cookieNameDomains && signals.cookieNameDomains.length > 0) {
      const hasSessionFamily = signals.cookieNameDomains.some((nd) =>
        isSessionIndicatingCookieName(nd),
      );
      if (!hasSessionFamily) {
        return {
          status: "UNKNOWN",
          evidence: ["ui:composer-visible", "cookies:no-session-family"],
        };
      }
      return {
        status: "AUTHENTICATED",
        evidence: ["ui:composer-visible", "cookies:session-family-present"],
      };
    }
    return { status: "AUTHENTICATED", evidence: ["ui:composer-visible"] };
  }

  return { status: "UNKNOWN", evidence: ["ui:no-signals"] };
}

/** Matches cookie NAME+DOMAIN label ("name|domain") against session families. */
export function isSessionIndicatingCookieName(nameDomain: string): boolean {
  const name = nameDomain.split("|")[0] ?? "";
  return SESSION_COOKIE_NAME_PATTERNS.some((re) => re.test(name));
}

/** Gather UI/navigation signals from a loaded chatgpt.com page. */
export async function collectAuthSignals(page: BrowserPage): Promise<{
  composerVisible: boolean;
  loginAffordanceVisible: boolean;
  redirectedToLogin: boolean;
  challengeIndicatorVisible: boolean;
}> {
  const composerVisible =
    (await page.hasSelector(AUTH_SIGNAL_SELECTORS.composer[0], 2500)) ||
    (await page.hasSelector(AUTH_SIGNAL_SELECTORS.composer[1], 1000));
  const loginAffordanceVisible =
    (await page.hasSelector(AUTH_SIGNAL_SELECTORS.loginAffordance[0], 1500)) ||
    (await page.hasSelector(AUTH_SIGNAL_SELECTORS.loginAffordance[1], 750));
  const redirectedToLogin = page.url().includes("/auth/login");
  const challengeIndicatorVisible = await page.hasSelector(
    AUTH_SIGNAL_SELECTORS.challenge[0],
    750,
  );

  return {
    composerVisible,
    loginAffordanceVisible,
    redirectedToLogin,
    challengeIndicatorVisible,
  };
}

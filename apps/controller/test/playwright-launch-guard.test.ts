import { describe, it, expect } from "vitest";
import {
  PlaywrightDriver,
  type PersistentContextOptions,
} from "../src/browser/playwright-driver.js";

/**
 * Change 023 §7.4: pin the EXACT permitted Playwright persistent-context
 * options so forbidden switches can never creep into automation launches.
 */
describe("PlaywrightDriver launch options guard (Change 023)", () => {
  it("options are exactly {headless, viewport} plus optional executablePath", async () => {
    const captured: PersistentContextOptions[] = [];
    const makeDriver = () =>
      new PlaywrightDriver(async (_dir, options) => {
        captured.push(options);
        return {} as any;
      });

    // Separate instances: launch is idempotent per running context.
    await makeDriver().launch("C:\\profile", true);
    await makeDriver().launch("C:\\profile", false, {
      executablePath:
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });

    expect(captured).toHaveLength(2);

    // Headless passthrough stays available to direct driver callers.
    expect(Object.keys(captured[0]).sort()).toEqual(["headless", "viewport"]);
    expect(captured[0].headless).toBe(true);
    expect(captured[0].viewport).toEqual({ width: 1280, height: 800 });
    expect(captured[0].executablePath).toBeUndefined();

    // Installed-Chrome automation against the dedicated profile.
    expect(Object.keys(captured[1]).sort()).toEqual([
      "executablePath",
      "headless",
      "viewport",
    ]);
    expect(captured[1].executablePath).toBe(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    );
  });

  it("no anti-detection / sandbox / user-agent switches can appear anywhere in options", async () => {
    let serialized = "";
    const driver = new PlaywrightDriver(async (_dir, options) => {
      serialized = JSON.stringify(options);
      return {} as any;
    });

    await driver.launch("/tmp/profile", false, {
      executablePath: "chrome.exe",
    });

    const lowered = serialized.toLowerCase();
    expect(lowered).not.toContain("automationcontrolled");
    expect(lowered).not.toContain("--no-sandbox");
    expect(lowered).not.toContain("useragent");
    expect(lowered).not.toContain("args");
    expect(lowered).not.toContain("ignoredefaultargs");
  });

  it("launch is idempotent while a context is already running", async () => {
    let calls = 0;
    const driver = new PlaywrightDriver(async () => {
      calls += 1;
      return {} as any;
    });

    await driver.launch("/p", true);
    await driver.launch("/p", true);
    expect(calls).toBe(1);
  });

  it("cookie names expose NAME|DOMAIN labels only", async () => {
    const driver = new PlaywrightDriver(
      async () =>
        ({
          cookies: async () => [
            {
              name: "__Secure-next-auth.session-token",
              domain: ".chatgpt.com",
              value: "SECRET-VALUE-THAT-MUST-NOT-LEAK",
            },
          ],
        }) as any,
    );

    // A running context is required before cookies are readable.
    await driver.launch("/tmp/profile", false);

    const labels = await driver.getCookieNameDomains();
    expect(labels).toEqual(["__Secure-next-auth.session-token|.chatgpt.com"]);
    expect(JSON.stringify(labels)).not.toContain("SECRET-VALUE");
  });
});

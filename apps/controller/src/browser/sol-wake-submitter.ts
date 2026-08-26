import type { BrowserPage } from "./browser-driver.js";

export class SolWakeSubmitter {
  private readonly inputSelectors = [
    "#prompt-textarea",
    "textarea[placeholder*='Message']",
    "div[contenteditable='true']"
  ];

  private readonly sendButtonSelectors = [
    "button[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send message']"
  ];

  // Informational "too many requests" / busy modal acknowledgement buttons
  private readonly busyDismissSelectors = [
    "button:has-text('Okay')",
    "button:has-text('OK')",
    "button:has-text('Dismiss')",
    "button:has-text('Got it')"
  ];

  private readonly authSelectors = [
    "a[href*='auth/login']",
    "button:has-text('Log in')",
    "button:has-text('Sign in')"
  ];

  // Cloudflare/CAPTCHA iframes
  private readonly captchaFrameSelectors = [
    "iframe[src*='cloudflare']",
    "iframe[src*='challenges.cloudflare']",
    "div[class*='cf-']",
    "#turnstile-wrapper"
  ];

  // Tightly scoped surfaces for banner/dialog text — no document.body read
  private readonly bannerSelectors = [
    "[role='dialog']",
    "[role='alert']",
    "[data-testid='modal']",
    "[data-testid='banner']",
    ".modal",
    ".banner"
  ];

  private readonly authTextSignals = [
    "logged out",
    "log in to continue",
    "please log in",
    "session expired"
  ];

  private readonly busyTextSignals = [
    "too many requests",
    "you've reached your limit",
    "rate limit",
    "try again later",
    "high demand"
  ];

  private readonly captchaSignals = [
    "cloudflare",
    "verify you are human",
    "captcha",
    "attention required",
    "checking if the site connection is secure"
  ];

  /**
   * True when ANY selector in the group is visible. Probes run concurrently:
   * a miss burns its full waitForSelector timeout in the Playwright driver, so
   * probing a group sequentially cost (N x timeout) on every clean page while
   * concurrent probing costs max(timeout) with identical semantics.
   */
  private async anyVisible(
    page: BrowserPage,
    selectors: string[],
    timeoutMs: number
  ): Promise<boolean> {
    const probes = await Promise.all(
      selectors.map((sel) =>
        page.hasSelector(sel, timeoutMs).catch(() => false)
      )
    );
    return probes.some((seen) => seen);
  }

  async detectAuthRequired(page: BrowserPage): Promise<boolean> {
    const [authVisible, scoped] = await Promise.all([
      this.anyVisible(page, this.authSelectors, 1200),
      this.scopedText(page),
    ]);
    if (authVisible) return true;
    const low = scoped.toLowerCase();
    for (const s of this.authTextSignals) if (low.includes(s)) return true;
    for (const s of this.captchaSignals) if (low.includes(s)) return true;
    return false;
  }

  async detectCaptcha(page: BrowserPage): Promise<boolean> {
    if (await this.anyVisible(page, this.captchaFrameSelectors, 800)) return true;
    const low = (await this.scopedText(page)).toLowerCase();
    for (const s of this.captchaSignals) if (low.includes(s)) return true;
    return false;
  }

  async detectBusy(page: BrowserPage): Promise<boolean> {
    const [low, dismissVisible] = await Promise.all([
      this.scopedText(page),
      this.anyVisible(page, this.busyDismissSelectors, 600),
    ]);
    const text = low.toLowerCase();
    for (const s of this.busyTextSignals) if (text.includes(s)) return true;
    if (
      dismissVisible &&
      this.busyTextSignals.some((sig) => text.includes(sig))
    ) {
      return true;
    }
    return false;
  }

  async dismissBusyIfPresent(page: BrowserPage): Promise<boolean> {
    if (!(await this.detectBusy(page))) return false;
    for (const sel of this.busyDismissSelectors) {
      try {
        const dismissed = await page.dismissIfPresent(sel);
        if (dismissed) return true;
      } catch {}
    }
    return false;
  }

  async submitWake(page: BrowserPage, message: string): Promise<void> {
    if (await this.detectCaptcha(page)) {
      throw new Error("ATTENTION_REQUIRED: ChatGPT verification/CAPTCHA required");
    }
    if (await this.detectAuthRequired(page)) {
      throw new Error("CHATGPT_AUTH_REQUIRED: ChatGPT login required");
    }
    if (await this.detectBusy(page)) {
      await this.dismissBusyIfPresent(page);
      throw new Error("BUSY: ChatGPT is busy (too many requests / rate limited)");
    }

    let typed = false;
    for (const selector of this.inputSelectors) {
      try {
        const visible = await page.waitForSelector(selector, { timeout: 3000 });
        if (visible) {
          await page.typeText(selector, message);
          typed = true;
          break;
        }
      } catch {}
    }

    if (!typed) {
      await page.typeText(this.inputSelectors[0] || "#prompt-textarea", message);
    }

    if (await this.detectCaptcha(page)) {
      throw new Error("ATTENTION_REQUIRED: ChatGPT verification/CAPTCHA required");
    }
    if (await this.detectAuthRequired(page)) {
      throw new Error("CHATGPT_AUTH_REQUIRED: ChatGPT login required");
    }
    if (await this.detectBusy(page)) {
      await this.dismissBusyIfPresent(page);
      throw new Error("BUSY: ChatGPT is busy (too many requests / rate limited)");
    }

    let clicked = false;
    for (const selector of this.sendButtonSelectors) {
      try {
        const visible = await page.waitForSelector(selector, { timeout: 3000 });
        if (visible) {
          await page.click(selector);
          clicked = true;
          break;
        }
      } catch {}
    }

    if (!clicked) {
      await page.click(this.sendButtonSelectors[0] || "button[data-testid='send-button']");
    }

    if (await this.detectCaptcha(page)) {
      throw new Error("ATTENTION_REQUIRED: ChatGPT verification/CAPTCHA required");
    }
    if (await this.detectAuthRequired(page)) {
      throw new Error("CHATGPT_AUTH_REQUIRED: ChatGPT login required");
    }
    if (await this.detectBusy(page)) {
      await this.dismissBusyIfPresent(page);
      throw new Error("BUSY: ChatGPT is busy (too many requests / rate limited) after submit");
    }
  }

  private async scopedText(page: BrowserPage): Promise<string> {
    const texts = await Promise.all(
      this.bannerSelectors.map(async (sel) => {
        try {
          return await page.getText(sel);
        } catch {
          return null;
        }
      })
    );
    return texts.filter((t): t is string => Boolean(t)).join(" \n ");
  }
}

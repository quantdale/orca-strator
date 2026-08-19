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

  async detectAuthRequired(page: BrowserPage): Promise<boolean> {
    for (const sel of this.authSelectors) {
      try {
        if (await page.hasSelector(sel, 1200)) return true;
      } catch {}
    }
    const body = await this.safeBodyText(page);
    const low = body.toLowerCase();
    for (const s of this.authTextSignals) if (low.includes(s)) return true;
    for (const s of this.captchaSignals) if (low.includes(s)) return true; // treat verification wall as auth/attention
    return false;
  }

  async detectCaptcha(page: BrowserPage): Promise<boolean> {
    // Cloudflare/CAPTCHA selectors when present
    const selectors = [
      "iframe[src*='cloudflare']",
      "iframe[src*='challenges.cloudflare']",
      "div[class*='cf-']",
      "#turnstile-wrapper"
    ];
    for (const sel of selectors) {
      try {
        if (await page.hasSelector(sel, 800)) return true;
      } catch {}
    }
    const low = (await this.safeBodyText(page)).toLowerCase();
    for (const s of this.captchaSignals) if (low.includes(s)) return true;
    return false;
  }

  async detectBusy(page: BrowserPage): Promise<boolean> {
    const low = (await this.safeBodyText(page)).toLowerCase();
    for (const s of this.busyTextSignals) if (low.includes(s)) return true;
    // Busy modals often have an Okay/Dismiss button alongside the text
    for (const sel of this.busyDismissSelectors) {
      try {
        if (await page.hasSelector(sel, 600)) {
          // only consider it a busy modal if the busy text is also present
          if (this.busyTextSignals.some((sig) => low.includes(sig))) return true;
        }
      } catch {}
    }
    return false;
  }

  async dismissBusyIfPresent(page: BrowserPage): Promise<boolean> {
    // Only dismiss if busy text is present to avoid clicking unrelated UI
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
    // Pre-submit checks: do not proceed blindly into a verification wall
    if (await this.detectCaptcha(page)) {
      throw new Error("ATTENTION_REQUIRED: ChatGPT verification/CAPTCHA required");
    }
    if (await this.detectAuthRequired(page)) {
      throw new Error("CHATGPT_AUTH_REQUIRED: ChatGPT login required");
    }
    if (await this.detectBusy(page)) {
      // Best-effort dismiss the informational busy acknowledgement before failing with backpressure
      await this.dismissBusyIfPresent(page);
      throw new Error("BUSY: ChatGPT is busy (too many requests / rate limited)");
    }

    // Attempt typing into recognized input composer
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
      // Fallback to first selector
      await page.typeText(this.inputSelectors[0] || "#prompt-textarea", message);
    }

    // Post-type rescan: a busy/verification wall could have appeared
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

    // Click send button
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

    // Post-submit rescan: surface actionable signals after send
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

  private async safeBodyText(page: BrowserPage): Promise<string> {
    try {
      return await page.getBodyText();
    } catch {
      return "";
    }
  }
}

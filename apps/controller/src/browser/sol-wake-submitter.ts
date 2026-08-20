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

  async detectAuthRequired(page: BrowserPage): Promise<boolean> {
    for (const sel of this.authSelectors) {
      try {
        if (await page.hasSelector(sel, 1200)) return true;
      } catch {}
    }
    const scoped = await this.scopedText(page);
    const low = scoped.toLowerCase();
    for (const s of this.authTextSignals) if (low.includes(s)) return true;
    for (const s of this.captchaSignals) if (low.includes(s)) return true;
    return false;
  }

  async detectCaptcha(page: BrowserPage): Promise<boolean> {
    for (const sel of this.captchaFrameSelectors) {
      try {
        if (await page.hasSelector(sel, 800)) return true;
      } catch {}
    }
    const low = (await this.scopedText(page)).toLowerCase();
    for (const s of this.captchaSignals) if (low.includes(s)) return true;
    return false;
  }

  async detectBusy(page: BrowserPage): Promise<boolean> {
    const low = (await this.scopedText(page)).toLowerCase();
    for (const s of this.busyTextSignals) if (low.includes(s)) return true;
    for (const sel of this.busyDismissSelectors) {
      try {
        if (await page.hasSelector(sel, 600)) {
          if (this.busyTextSignals.some((sig) => low.includes(sig))) return true;
        }
      } catch {}
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
    const parts: string[] = [];
    for (const sel of this.bannerSelectors) {
      try {
        const t = await page.getText(sel);
        if (t) parts.push(t);
      } catch {}
    }
    return parts.join(" \n ");
  }
}

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

  async submitWake(page: BrowserPage, message: string): Promise<void> {
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
  }
}

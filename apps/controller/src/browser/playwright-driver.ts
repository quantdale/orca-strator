import type { BrowserContext, Page } from "playwright-core";
import type { BrowserDriver, BrowserPage } from "./browser-driver.js";

export class PlaywrightPageWrapper implements BrowserPage {
  constructor(private readonly page: Page) {}

  async goto(url: string, options?: { timeout?: number }): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options?.timeout ?? 30000
    });
  }

  async typeText(selector: string, text: string): Promise<void> {
    await this.page.fill(selector, text);
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<boolean> {
    try {
      await this.page.waitForSelector(selector, {
        timeout: options?.timeout ?? 10000,
        state: "visible"
      });
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.page.close();
  }

  url(): string {
    return this.page.url();
  }
}

export class PlaywrightDriver implements BrowserDriver {
  private context: BrowserContext | null = null;
  private pages = new Map<string, Page>();

  async launch(profileDir: string, headless: boolean): Promise<void> {
    if (this.context) return;

    // Dynamically import playwright-core to keep controller modular
    const { chromium } = await import("playwright-core");

    this.context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox"
      ]
    });
  }

  async openPage(repositoryId: string, url: string): Promise<BrowserPage> {
    if (!this.context) {
      throw new Error("Browser context is not running");
    }

    let page = this.pages.get(repositoryId);
    if (!page || page.isClosed()) {
      page = await this.context.newPage();
      this.pages.set(repositoryId, page);
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } else if (page.url() !== url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    return new PlaywrightPageWrapper(page);
  }

  async closePage(repositoryId: string): Promise<void> {
    const page = this.pages.get(repositoryId);
    if (page && !page.isClosed()) {
      await page.close();
    }
    this.pages.delete(repositoryId);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.pages.clear();
    }
  }

  isRunning(): boolean {
    return this.context !== null;
  }

  activePageCount(): number {
    return this.pages.size;
  }
}

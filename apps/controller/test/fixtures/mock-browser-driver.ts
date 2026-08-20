import type { BrowserDriver, BrowserPage } from "../../src/browser/browser-driver.js";

export class MockBrowserPage implements BrowserPage {
  public currentUrl: string = "";
  public typedMessages: { selector: string; text: string }[] = [];
  public clickedSelectors: string[] = [];
  public isClosed = false;

  // UI simulation hooks for busy/auth/captcha detection tests
  public bodyText: string = "";
  public visibleSelectors = new Set<string>();

  constructor(public readonly repositoryId: string, initialUrl: string) {
    this.currentUrl = initialUrl;
  }

  async goto(url: string, _options?: { timeout?: number }): Promise<void> {
    this.currentUrl = url;
  }

  async typeText(selector: string, text: string): Promise<void> {
    this.typedMessages.push({ selector, text });
  }

  async click(selector: string): Promise<void> {
    this.clickedSelectors.push(selector);
  }

  async waitForSelector(selector: string, _options?: { timeout?: number }): Promise<boolean> {
    if (this.visibleSelectors.size > 0) {
      return this.visibleSelectors.has(selector);
    }
    return true;
  }

  async hasSelector(selector: string, _timeoutMs?: number): Promise<boolean> {
    if (this.visibleSelectors.size > 0) return this.visibleSelectors.has(selector);
    return false;
  }

  async getText(selector: string): Promise<string | null> {
    if (this.visibleSelectors.has(selector)) return this.bodyText || selector;
    return null;
  }

  async dismissIfPresent(selector: string): Promise<boolean> {
    if (this.visibleSelectors.has(selector)) {
      this.visibleSelectors.delete(selector);
      this.clickedSelectors.push(selector);
      return true;
    }
    return false;
  }

  async close(): Promise<void> {
    this.isClosed = true;
  }

  url(): string {
    return this.currentUrl;
  }
}

export class MockBrowserDriver implements BrowserDriver {
  public running = false;
  public headless = false;
  public profileDir = "";
  public pages = new Map<string, MockBrowserPage>();
  /** Persistent record of pages, retained after close, for test assertions. */
  public history = new Map<string, MockBrowserPage>();
  /** When true, every opened page reports ChatGPT "too many requests" (BUSY) via scoped text. */
  public forceBusy = false;

  async launch(profileDir: string, headless: boolean): Promise<void> {
    this.running = true;
    this.profileDir = profileDir;
    this.headless = headless;
  }

  async openPage(repositoryId: string, url: string): Promise<BrowserPage> {
    if (!this.running) {
      throw new Error("Browser is not running");
    }

    let page = this.pages.get(repositoryId);
    if (!page || page.isClosed) {
      page = new MockBrowserPage(repositoryId, url);
      this.pages.set(repositoryId, page);
      this.history.set(repositoryId, page);
    } else if (page.currentUrl !== url) {
      await page.goto(url);
    }

    if (this.forceBusy) {
      page.visibleSelectors.add("[role='dialog']");
      page.bodyText = "too many requests";
    }

    return page;
  }

  async closePage(repositoryId: string): Promise<void> {
    const page = this.pages.get(repositoryId);
    if (page) {
      await page.close();
      this.pages.delete(repositoryId);
    }
  }

  async close(): Promise<void> {
    this.running = false;
    for (const page of this.pages.values()) {
      await page.close();
    }
    this.pages.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  activePageCount(): number {
    return this.pages.size;
  }
}

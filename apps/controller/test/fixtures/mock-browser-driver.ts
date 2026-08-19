import type { BrowserDriver, BrowserPage } from "../../src/browser/browser-driver.js";

export class MockBrowserPage implements BrowserPage {
  public currentUrl: string = "";
  public typedMessages: { selector: string; text: string }[] = [];
  public clickedSelectors: string[] = [];
  public isClosed = false;

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

  async waitForSelector(_selector: string, _options?: { timeout?: number }): Promise<boolean> {
    return true;
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
    } else if (page.currentUrl !== url) {
      await page.goto(url);
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

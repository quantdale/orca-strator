import type { BrowserContext, Page } from "playwright-core";
import type {
 BrowserDriver,
 BrowserLaunchOptions,
 BrowserPage,
 CookieNameDomain,
} from "./browser-driver.js";

/**
 * Seam for tests: captures launch options WITHOUT launching a real browser.
 * Production default delegates to chromium.launchPersistentContext.
 */
export type PersistentContextLauncher = (
 profileDir: string,
 options: PersistentContextOptions,
) => Promise<BrowserContext>;

/**
 * The EXACT shape of Playwright persistent-context options Orca permits.
 * Intentionally no args array, no user-agent override, no sandbox downgrade —
 * pinned by test so forbidden switches can never creep in.
 */
export interface PersistentContextOptions {
 headless: boolean;
 viewport: { width: number; height: number };
 executablePath?: string;
}

export class PlaywrightPageWrapper implements BrowserPage {
 constructor(private readonly page: Page) {}

 async goto(url: string, options?: { timeout?: number }): Promise<void> {
  await this.page.goto(url, {
   waitUntil: "domcontentloaded",
   timeout: options?.timeout ?? 30000,
  });
 }

 async typeText(selector: string, text: string): Promise<void> {
  await this.page.fill(selector, text);
 }

 async click(selector: string): Promise<void> {
  await this.page.click(selector);
 }

 async waitForSelector(
  selector: string,
  options?: { timeout?: number },
 ): Promise<boolean> {
  try {
   await this.page.waitForSelector(selector, {
    timeout: options?.timeout ?? 10000,
    state: "visible",
   });
   return true;
  } catch {
   return false;
  }
 }

 async hasSelector(selector: string, timeoutMs = 1500): Promise<boolean> {
  try {
   await this.page.waitForSelector(selector, {
    timeout: timeoutMs,
    state: "visible",
   });
   return true;
  } catch {
   return false;
  }
 }

 async getText(selector: string): Promise<string | null> {
  try {
   const loc = this.page.locator(selector).first();
   if ((await loc.count()) === 0) return null;
   return (await loc.textContent())?.trim() ?? null;
  } catch {
   return null;
  }
 }

 async dismissIfPresent(selector: string): Promise<boolean> {
  try {
   const loc = this.page.locator(selector).first();
   if ((await loc.count()) === 0) return false;
   if (!(await loc.isVisible())) return false;
   await loc.click({ timeout: 1500 });
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

 constructor(private readonly contextLauncher?: PersistentContextLauncher) {}

 async launch(
  profileDir: string,
  headless: boolean,
  opts?: BrowserLaunchOptions,
 ): Promise<void> {
  if (this.context) return;

  // Exact permitted option set; executablePath selects installed Chrome
  // (Change 023). No automation-hiding flags, no --no-sandbox.
  const options: PersistentContextOptions = {
   headless,
   viewport: { width: 1280, height: 800 },
  };
  if (opts?.executablePath) {
   options.executablePath = opts.executablePath;
  }

  const launcher =
   this.contextLauncher ??
   (async (dir: string, launchOpts: PersistentContextOptions) => {
    const { chromium } = await import("playwright-core");
    return chromium.launchPersistentContext(dir, launchOpts);
   });

  this.context = await launcher(profileDir, options);
 }

 /**
  * Cookie NAME|DOMAIN labels only — values are never read into memory for
  * reporting/logging/persistence (Change 023 auth-readiness corroboration).
  */
 async getCookieNameDomains(): Promise<CookieNameDomain[]> {
  if (!this.context) return [];
  const cookies = await this.context.cookies();
  return cookies.map((c) => `${c.name}|${c.domain}`);
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

export interface BrowserPage {
 goto(url: string, options?: { timeout?: number }): Promise<void>;
 typeText(selector: string, text: string): Promise<void>;
 click(selector: string): Promise<void>;
 waitForSelector(
  selector: string,
  options?: { timeout?: number },
 ): Promise<boolean>;
 hasSelector(selector: string, timeoutMs?: number): Promise<boolean>;
 getText(selector: string): Promise<string | null>;
 dismissIfPresent(selector: string): Promise<boolean>;
 close(): Promise<void>;
 url(): string;
}

/** Launch options for the automation driver. Pinned by test to stay minimal. */
export interface BrowserLaunchOptions {
 /** Discovered installed-Chrome executable; production automation uses this. */
 executablePath?: string;
}

/** Cookie identity label "name|domain" — NEVER includes a value. */
export type CookieNameDomain = string;

export interface BrowserDriver {
 launch(
  profileDir: string,
  headless: boolean,
  opts?: BrowserLaunchOptions,
 ): Promise<void>;
 openPage(repositoryId: string, url: string): Promise<BrowserPage>;
 closePage(repositoryId: string): Promise<void>;
 close(): Promise<void>;
 isRunning(): boolean;
 activePageCount(): number;
 /**
  * Optional: cookie NAME|DOMAIN labels from the persistent profile context.
  * Used only as auth-readiness corroboration; values are never exposed.
  */
 getCookieNameDomains?(): Promise<CookieNameDomain[]>;
}

export interface BrowserPage {
  goto(url: string, options?: { timeout?: number }): Promise<void>;
  typeText(selector: string, text: string): Promise<void>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<boolean>;
  hasSelector(selector: string, timeoutMs?: number): Promise<boolean>;
  getText(selector: string): Promise<string | null>;
  dismissIfPresent(selector: string): Promise<boolean>;
  close(): Promise<void>;
  url(): string;
}

export interface BrowserDriver {
  launch(profileDir: string, headless: boolean): Promise<void>;
  openPage(repositoryId: string, url: string): Promise<BrowserPage>;
  closePage(repositoryId: string): Promise<void>;
  close(): Promise<void>;
  isRunning(): boolean;
  activePageCount(): number;
}

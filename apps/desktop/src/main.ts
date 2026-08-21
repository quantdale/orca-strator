import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RETRY_INITIAL_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 10000;

export function getAppUrl(): string {
  if (process.env.ORCA_UI_DEV_URL) {
    return process.env.ORCA_UI_DEV_URL;
  }
  const host = process.env.ORCA_HOST || "127.0.0.1";
  const port = process.env.ORCA_PORT || "47100";
  return `http://${host}:${port}`;
}

// Minimal waiting page shown while the controller is unreachable; palette mirrors the UI shell.
function buildWaitingPageUrl(targetUrl: string): string {
  const safeTarget = targetUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Orca-Strator</title>
<style>
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #020617;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .panel { max-width: 460px; padding: 32px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 18px; color: #f8fafc; }
  p { margin: 0 0 4px; font-size: 13px; line-height: 1.6; color: #94a3b8; }
  code { font-size: 12px; color: #cbd5e1; }
</style>
</head>
<body>
<div class="panel">
  <h1>Waiting for the Orca-Strator controller&hellip;</h1>
  <p>The window retries automatically until it comes up.</p>
  <p><code>${safeTarget}</code></p>
</div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// Loads the controller origin, falling back to a waiting page plus capped
// exponential-backoff retries while the controller is starting up or down.
function loadControllerWithRetry(win: BrowserWindow, url: string): void {
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let loadingController = false;

  const clearRetryTimer = (): void => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const showWaitingPage = (): void => {
    void win.loadURL(buildWaitingPageUrl(url)).catch(() => {
      // Placeholder failures during teardown are ignored; the retry loop continues.
    });
  };

  const scheduleRetry = (reason: string): void => {
    if (retryTimer !== null || win.isDestroyed()) {
      return;
    }
    const delay = Math.min(RETRY_INITIAL_DELAY_MS * 2 ** attempts, RETRY_MAX_DELAY_MS);
    attempts += 1;
    console.warn(`[Desktop] ${url} unavailable (${reason}); retrying in ${delay}ms`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!win.isDestroyed()) {
        loadController();
      }
    }, delay);
  };

  // A failed load surfaces via both did-fail-load and the loadURL promise
  // rejection; the flag makes sure only the first schedules a retry.
  const handleLoadFailure = (description: string): void => {
    if (!loadingController || win.isDestroyed()) {
      return;
    }
    loadingController = false;
    showWaitingPage();
    scheduleRetry(description);
  };

  const loadController = (): void => {
    loadingController = true;
    void win.loadURL(url).catch((err: unknown) => {
      handleLoadFailure(err instanceof Error ? err.message : String(err));
    });
  };

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      handleLoadFailure(`${errorCode} ${errorDescription}`);
    }
  });

  win.webContents.on("did-finish-load", () => {
    if (loadingController && !win.isDestroyed()) {
      loadingController = false;
      attempts = 0;
      clearRetryTimer();
      console.log(`[Desktop] Connected to controller at ${url}`);
    }
  });

  win.on("closed", clearRetryTimer);

  loadController();
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 380,
    minHeight: 500,
    title: "Orca-Strator",
    backgroundColor: "#020617",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Open external links (GitHub, ChatGPT) in the default user browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  loadControllerWithRetry(win, getAppUrl());

  return win;
}

if (process.env.NODE_ENV !== "test") {
  // Single instance: a second launch would open a competing window against
  // the same controller, so hand focus to the running one instead.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      const [existing] = BrowserWindow.getAllWindows();
      if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) {
          existing.restore();
        }
        existing.show();
        existing.focus();
      }
    });

    app.whenReady().then(() => {
      createWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });
  }
}

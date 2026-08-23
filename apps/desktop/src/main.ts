import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureController,
  type EnsureControllerResult
} from "./controller-supervisor.js";
import type { DesktopStartupState } from "@orca/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getAppUrl(): string {
  if (process.env.ORCA_UI_DEV_URL) {
    return process.env.ORCA_UI_DEV_URL;
  }
  const host = process.env.ORCA_HOST || "127.0.0.1";
  const port = process.env.ORCA_PORT || "47100";
  return `http://${host}:${port}`;
}

export function getControllerBaseUrl(): string {
  const host = process.env.ORCA_HOST || "127.0.0.1";
  const port = process.env.ORCA_PORT || "47100";
  return `http://${host}:${port}`;
}

const STATE_TITLES: Record<DesktopStartupState, string> = {
  CHECKING_CONTROLLER: "Looking for an Orca-Strator controller…",
  STARTING_CONTROLLER: "Starting the Orca-Strator controller…",
  WAITING_FOR_READY: "Waiting for the controller to become ready…",
  CONNECTED: "Connected",
  PORT_CONFLICT: "Port conflict",
  INCOMPATIBLE_CONTROLLER: "Incompatible controller",
  STARTUP_FAILED: "Startup failed"
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Startup-state page shown while the controller is being probed/started, or
// when startup reaches a terminal diagnostic state. Terminal states offer a
// safe Retry action through the isolated preload bridge.
function buildStartupPageUrl(state: DesktopStartupState, detail?: string): string {
  const terminal = state === "PORT_CONFLICT" || state === "INCOMPATIBLE_CONTROLLER" || state === "STARTUP_FAILED";
  const title = STATE_TITLES[state];
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
  .panel { max-width: 520px; padding: 32px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 18px; color: #f8fafc; }
  p { margin: 0 0 4px; font-size: 13px; line-height: 1.6; color: #94a3b8; }
  .detail { color: #cbd5e1; font-size: 12px; white-space: pre-wrap; }
  .spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.9s linear infinite; margin-bottom: 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  button { margin-top: 16px; background: #0ea5e9; color: #04121f; font-weight: 600; border: none; border-radius: 6px; padding: 8px 20px; font-size: 13px; cursor: pointer; }
</style>
</head>
<body>
<div class="panel">
  ${terminal ? "" : '<div class="spinner"></div>'}
  <h1>${escapeHtml(title)}</h1>
  ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
  ${terminal ? '<button id="retry">Retry</button>' : ""}
</div>
<script>
  document.getElementById("retry")?.addEventListener("click", function () {
    this.disabled = true; this.textContent = "Retrying…";
    window.orcaDesktop && window.orcaDesktop.retryStartup();
  });
</script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

let startupGeneration = 0;

async function runStartupFlow(win: BrowserWindow): Promise<void> {
  const generation = ++startupGeneration;
  const showState = (state: DesktopStartupState, detail?: string): void => {
    if (win.isDestroyed() || generation !== startupGeneration) return;
    void win.loadURL(buildStartupPageUrl(state, detail)).catch(() => {});
  };

  const result: EnsureControllerResult = await ensureController({
    baseUrl: getControllerBaseUrl(),
    host: process.env.ORCA_HOST || undefined,
    port: process.env.ORCA_PORT ? Number(process.env.ORCA_PORT) : undefined,
    version: app.getVersion(),
    electronExecPath: process.execPath,
    resourcesPath: process.resourcesPath ?? __dirname,
    desktopDistDir: __dirname,
    packaged: app.isPackaged,
    ...(process.env.ORCA_DATA_DIR ? { dataDir: process.env.ORCA_DATA_DIR } : {}),
    onState: showState,
    budgetMs: Number(process.env.ORCA_STARTUP_BUDGET_MS) || undefined
  });

  if (win.isDestroyed() || generation !== startupGeneration) return;

  if (result.outcome === "connected") {
    console.log(`[Desktop] Controller ready (reused=${result.reused}) at ${getAppUrl()}`);
    await win.loadURL(getAppUrl()).catch(() => {});
    return;
  }

  // Terminal diagnostics already rendered by the final onState callback.
  console.warn(`[Desktop] Startup ended in ${result.state}: ${result.detail}`);
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

  void runStartupFlow(win);

  return win;
}

export function registerDesktopIpc(): void {
  ipcMain.removeHandler("orca-desktop:retry");
  ipcMain.handle("orca-desktop:retry", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing && !existing.isDestroyed()) {
      void runStartupFlow(existing);
    }
  });
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

    registerDesktopIpc();

    app.whenReady().then(() => {
      createWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    });

    // Closing the window quits only the desktop shell. The supervised
    // controller is detached and independent by design; controller-owned
    // campaigns keep running in the background (Change 025 lifecycle).
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });
  }
}

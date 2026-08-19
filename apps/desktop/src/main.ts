import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  const url = getAppUrl();
  win.loadURL(url).catch((err) => {
    console.warn(`[Desktop] Initial loadURL failed for ${url} (controller may be starting up):`, err.message);
  });

  return win;
}

if (process.env.NODE_ENV !== "test") {
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

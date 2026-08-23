import { contextBridge, ipcRenderer } from "electron";

// Safe bridge exposure: only informational flags and the startup-retry action;
// no database access, no shell.
contextBridge.exposeInMainWorld("orcaDesktop", {
  isDesktop: true,
  platform: process.platform,
  retryStartup: () => ipcRenderer.invoke("orca-desktop:retry")
});

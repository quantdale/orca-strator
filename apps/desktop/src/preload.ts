import { contextBridge } from "electron";

// Safe bridge exposure: only informational flags, no database access
contextBridge.exposeInMainWorld("orcaDesktop", {
  isDesktop: true,
  platform: process.platform
});

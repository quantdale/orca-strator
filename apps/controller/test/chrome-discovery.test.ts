import { describe, it, expect } from "vitest";
import {
  discoverSystemChrome,
  majorOf,
} from "../src/browser/chrome-discovery.js";

/** Deterministic registry seam: keyed by "key::valueName". */
function registrySeam(map: Record<string, string | null>) {
  return async (regKey: string, valueName: string) =>
    map[`${regKey}::${valueName}`] ?? null;
}

const APP_PATHS =
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe";
const APP_PATHS_WOW64 =
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe";
const BLBEACON = "HKCU\\Software\\Google\\Chrome\\BLBeacon";
const CHROME_SUBPATH = "Google\\Chrome\\Application\\chrome.exe";

describe("System Chrome discovery (Change 023)", () => {
  const baseEnv = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\t\\AppData\\Local",
  };

  it("finds Chrome via registry App Paths when the referenced file exists", async () => {
    const info = await discoverSystemChrome({
      env: baseEnv,
      fileExists: (p) => p === "D:\\Chrome\\chrome.exe",
      listDirs: () => [],
      readRegistryValue: registrySeam({
        [`${APP_PATHS}::(Default)`]: "D:\\Chrome\\chrome.exe",
      }),
    });

    expect(info.status).toBe("FOUND");
    expect(info.executablePath).toBe("D:\\Chrome\\chrome.exe");
    expect(info.source).toBe("registry-app-paths");
  });

  it("ignores a registry value whose file does not exist and falls through to Program Files", async () => {
    const pfPath = `C:\\Program Files\\${CHROME_SUBPATH}`;
    const info = await discoverSystemChrome({
      env: baseEnv,
      fileExists: (p) => p === pfPath,
      listDirs: () => [],
      readRegistryValue: registrySeam({
        [`${APP_PATHS}::(Default)`]: "E:\\Gone\\chrome.exe",
      }),
    });

    expect(info.status).toBe("FOUND");
    expect(info.executablePath).toBe(pfPath);
    expect(info.source).toBe("program-files");
  });

  it("uses the WOW6432Node App Paths view as second probe", async () => {
    const info = await discoverSystemChrome({
      env: {},
      fileExists: (p) => p === "D:\\Chrome32\\chrome.exe",
      listDirs: () => [],
      readRegistryValue: registrySeam({
        [`${APP_PATHS}::(Default)`]: null,
        [`${APP_PATHS_WOW64}::(Default)`]: "D:\\Chrome32\\chrome.exe",
      }),
    });

    expect(info.status).toBe("FOUND");
    expect(info.source).toBe("registry-app-paths-wow64");
  });

  it("probes ProgramFiles(x86) then LOCALAPPDATA in order", async () => {
    const x86 = `C:\\Program Files (x86)\\${CHROME_SUBPATH}`;
    const local = `C:\\Users\\t\\AppData\\Local\\${CHROME_SUBPATH}`;

    const viaX86 = await discoverSystemChrome({
      env: baseEnv,
      fileExists: (p) => p === x86 || p === local,
      listDirs: () => [],
      readRegistryValue: registrySeam({}),
    });
    expect(viaX86.source).toBe("program-files-x86");

    const viaLocal = await discoverSystemChrome({
      env: baseEnv,
      fileExists: (p) => p === local,
      listDirs: () => [],
      readRegistryValue: registrySeam({}),
    });
    expect(viaLocal.source).toBe("local-app-data");
  });

  it("reports actionable NOT_FOUND when no probe location contains chrome.exe", async () => {
    const info = await discoverSystemChrome({
      env: baseEnv,
      fileExists: () => false,
      listDirs: () => [],
      readRegistryValue: registrySeam({}),
    });

    expect(info.status).toBe("NOT_FOUND");
    expect(info.executablePath).toBeNull();
    expect(info.source).toContain("no probe location contained Google Chrome");
  });

  it("prefers the BLBeacon version when present", async () => {
    const info = await discoverSystemChrome({
      env: baseEnv,
      fileExists: (p) => p.endsWith(CHROME_SUBPATH),
      listDirs: () => ["131.0.6778.33", "142.0.7444.60"],
      readRegistryValue: registrySeam({
        [`${BLBEACON}::version`]: "140.1.2.3",
      }),
    });

    expect(info.version).toBe("140.1.2.3");
  });

  it("falls back to the highest Application version subdirectory", async () => {
    const info = await discoverSystemChrome({
      env: baseEnv,
      fileExists: (p) => p.endsWith(CHROME_SUBPATH),
      listDirs: (dir) =>
        dir.includes("Application")
          ? ["131.0.6778.33", "142.0.7444.60", "not-a-version"]
          : [],
      readRegistryValue: registrySeam({}),
    });

    expect(info.version).toBe("142.0.7444.60");
  });

  it("version absence does not fail FOUND", async () => {
    const info = await discoverSystemChrome({
      env: baseEnv,
      fileExists: (p) => p.endsWith(CHROME_SUBPATH),
      listDirs: () => [],
      readRegistryValue: registrySeam({}),
    });

    expect(info.status).toBe("FOUND");
    expect(info.version).toBeNull();
  });

  it("majorOf parses leading major or returns null", () => {
    expect(majorOf("142.0.7444.60")).toBe(142);
    expect(majorOf("garbage")).toBeNull();
    expect(majorOf(null)).toBeNull();
  });
});

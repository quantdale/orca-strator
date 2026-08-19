import { spawn, execSync } from "node:child_process";
import http from "node:http";

const args = process.argv.slice(2);
const noElectron = args.includes("--no-electron") || args.includes("--headless") || process.env.ORCA_NO_ELECTRON === "1";

console.log("=== Orca-Strator Development Supervisor ===");

// 1. Build prerequisites in deterministic order
console.log("[Dev] Building shared, controller, and desktop packages...");
try {
  execSync("npm run build:shared", { stdio: "inherit" });
  execSync("npm run build:controller", { stdio: "inherit" });
  if (!noElectron) {
    execSync("npm run build:desktop", { stdio: "inherit" });
  }
} catch (err) {
  console.error("[Dev] Prerequisite build failed:", err.message);
  process.exit(1);
}

const activeProcesses = new Set();

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {}
  } else {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

let isCleaningUp = false;
function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log("\n[Dev] Shutting down Orca dev stack...");
  for (const proc of activeProcesses) {
    killProcessTree(proc);
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// 2. Start Controller runtime
console.log("[Dev] Starting controller process...");
const controller = spawn("node", ["apps/controller/dist/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development",
    ORCA_HOST: "127.0.0.1",
    ORCA_PORT: "47100"
  }
});
activeProcesses.add(controller);
controller.on("exit", (code) => {
  activeProcesses.delete(controller);
  if (!isCleaningUp) {
    console.warn(`[Dev] Controller process exited with code ${code}`);
  }
});

// 3. Start Vite UI server
console.log("[Dev] Starting Vite UI dev server...");
const ui = spawn("npx", ["vite", "--port", "5173"], {
  cwd: "apps/ui",
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: "development"
  }
});
activeProcesses.add(ui);
ui.on("exit", (code) => {
  activeProcesses.delete(ui);
  if (!isCleaningUp) {
    console.warn(`[Dev] Vite UI server exited with code ${code}`);
  }
});

// 4. Poll readiness
function checkHttp(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForReady(url, label, maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHttp(url)) {
      console.log(`[Dev] ${label} is ready at ${url}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for ${label} at ${url}`);
}

async function startElectronWhenReady() {
  try {
    await waitForReady("http://127.0.0.1:47100/api/health", "Controller API");
    await waitForReady("http://127.0.0.1:5173", "Vite UI");

    if (noElectron) {
      console.log("[Dev] Running in headless mode (--no-electron). Dev stack is ready.");
      return;
    }

    console.log("[Dev] Launching Electron desktop shell...");
    const desktop = spawn("npx", ["electron", "apps/desktop/dist/main.js"], {
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ORCA_UI_DEV_URL: "http://127.0.0.1:5173"
      }
    });
    activeProcesses.add(desktop);
    desktop.on("exit", (code) => {
      activeProcesses.delete(desktop);
      console.log(`[Dev] Electron window closed (exit code ${code}). Dev stack continues running.`);
    });
  } catch (err) {
    console.error("[Dev] Readiness error:", err.message);
    cleanup();
  }
}

startElectronWhenReady();

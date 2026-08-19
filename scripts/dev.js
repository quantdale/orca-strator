import { spawn } from "node:child_process";

console.log("Starting Orca-Strator dev stack...");

// 1. Start controller
const controller = spawn("npm", ["run", "dev", "--workspace=@orca/controller"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: "development" }
});

// 2. Start Vite UI
const ui = spawn("npm", ["run", "dev", "--workspace=@orca/ui"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: "development" }
});

const cleanup = () => {
  console.log("\nShutting down dev stack...");
  controller.kill();
  ui.kill();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

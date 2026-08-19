import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutorAdapter, ExecutionContext } from "./executor-adapter.js";

const execFileAsync = promisify(execFile);

export class WslAdapter implements ExecutorAdapter {
  spawn(context: ExecutionContext): ChildProcess {
    const wslArgs: string[] = [];

    if (context.wslDistribution) {
      wslArgs.push("-d", context.wslDistribution);
    }

    if (context.cwd) {
      wslArgs.push("--cd", context.cwd);
    }

    wslArgs.push("--", context.command, ...context.args);

    // Build WSLENV string so environment variables pass through from Windows host to Linux WSL
    const wslEnvVars = Object.keys(context.env).join(":");
    const existingWslEnv = process.env.WSLENV ? `${process.env.WSLENV}:` : "";

    return spawn("wsl.exe", wslArgs, {
      env: {
        ...process.env,
        ...context.env,
        WSLENV: `${existingWslEnv}${wslEnvVars}`
      },
      windowsHide: true,
      shell: false
    });
  }

  async killProcessTree(child: ChildProcess): Promise<void> {
    if (!child || !child.pid) return;

    if (process.platform === "win32") {
      try {
        await execFileAsync("taskkill", ["/pid", child.pid.toString(), "/T", "/F"], {
          windowsHide: true
        });
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    } else {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
}

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutorAdapter, ExecutionContext } from "./executor-adapter.js";
import { toWslPath } from "../../wsl-path.js";

const execFileAsync = promisify(execFile);

export class WslAdapter implements ExecutorAdapter {
  capabilities() {
    return {
      environment: "wsl" as const,
      headless: "READY" as const,
      cancellation: "READY" as const,
      pause: "READY" as const,
      resume: "NOT_APPLICABLE" as const,
      structuredEvents: "NOT_APPLICABLE" as const,
      permissionApi: "UNSUPPORTED" as const,
      usageTelemetry: "UNKNOWN" as const,
      sessionResume: "UNSUPPORTED" as const,
      sessionHistory: "UNSUPPORTED" as const
    };
  }

  spawn(context: ExecutionContext): ChildProcess {
    const wslArgs: string[] = [];

    if (context.wslDistribution) {
      wslArgs.push("-d", context.wslDistribution);
    }

    // The executor's working directory is supplied as a Windows path; under WSL it
    // must be the Linux mount path (Finding C). Do NOT run Linux git with a Windows
    // cwd.
    if (context.cwd) {
      wslArgs.push("--cd", toWslPath(context.cwd));
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

  async cancel(child: ChildProcess, _reason?: string): Promise<void> {
    await this.killProcessTree(child);
  }
}

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutorAdapter, ExecutionContext } from "./executor-adapter.js";
import { EXECUTOR_SPAWN_STDIO } from "./executor-adapter.js";

const execFileAsync = promisify(execFile);

export class WindowsPowerShellAdapter implements ExecutorAdapter {
  capabilities() {
    return {
      environment: "windows" as const,
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
    return spawn(context.command, context.args, {
      cwd: context.cwd,
      env: {
        ...process.env,
        ...context.env
      },
      windowsHide: true,
      // Change 022: executor children must never see an open stdin pipe (see
      // EXECUTOR_SPAWN_STDIO). stdout/stderr stay captured for logs.
      stdio: [...EXECUTOR_SPAWN_STDIO]
    });
  }

  async killProcessTree(child: ChildProcess): Promise<void> {
    if (!child || !child.pid) return;

    if (process.platform === "win32") {
      try {
        await execFileAsync("taskkill", ["/pid", child.pid.toString(), "/T", "/F"], {
          windowsHide: true,
          // F-HIGH-2: bounded kill — a hung taskkill must never block shutdown.
          timeout: 15_000
        });
      } catch {
        // taskkill unavailable/timed out — fall back to a direct SIGKILL best effort.
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already gone; the kill sweep is best-effort by design.
        }
      }
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process already gone; nothing left to terminate.
      }
    }
  }

  async cancel(child: ChildProcess, _reason?: string): Promise<void> {
    await this.killProcessTree(child);
  }
}

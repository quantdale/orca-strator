import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutorAdapter, ExecutionContext } from "./executor-adapter.js";

const execFileAsync = promisify(execFile);

export class WindowsPowerShellAdapter implements ExecutorAdapter {
  spawn(context: ExecutionContext): ChildProcess {
    return spawn(context.command, context.args, {
      cwd: context.cwd,
      env: {
        ...process.env,
        ...context.env
      },
      shell: true,
      windowsHide: true
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

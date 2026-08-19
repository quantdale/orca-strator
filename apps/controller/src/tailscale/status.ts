import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TailscaleGuidance } from "@orca/shared";

const execFileAsync = promisify(execFile);

export type TailscaleStatus = TailscaleGuidance["status"];

interface DetectionResult {
  status: TailscaleStatus;
  details: string;
}

/**
 * Truthful Tailscale detection (Finding P).
 *
 * Orca must never report "configured" merely because it knows a command string.
 * We actually probe the Tailscale CLI: installed? running? authenticated? Serve
 * configured for the loopback? Anything we cannot verify is reported as "unknown"
 * (manual verification required) rather than falsely "configured".
 *
 * The controller stays loopback-only and never enables Funnel/public exposure.
 */
export async function detectTailscaleStatus(port: number): Promise<TailscaleGuidance> {
  const loopbackUrl = `http://127.0.0.1:${port}`;
  const command = `tailscale serve --bg https / ${loopbackUrl}`;

  const baseInstructions = [
    "1. Ensure Tailscale is installed and running on your Windows host.",
    `2. Run PowerShell as Administrator: \`${command}\``,
    "3. Open your Tailscale machine HTTPS URL on your phone browser to access Orca-Strator securely (loopback-only; Funnel/public is never enabled)."
  ];

  const result = await probe(port, command);

  return {
    loopbackPort: port,
    loopbackUrl,
    command,
    status: result.status,
    details: result.details,
    instructions:
      result.status === "configured" || result.status === "serve_not_configured"
        ? baseInstructions
        : baseInstructions
  };
}

async function probe(port: number, _command: string): Promise<DetectionResult> {
  let statusJson: unknown;
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1 * 1024 * 1024
    });
    statusJson = JSON.parse(stdout);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {
        status: "not_installed",
        details: "tailscale CLI not found on PATH. Install Tailscale for Windows."
      };
    }
    return {
      status: "not_running",
      details: `tailscale status failed: ${err?.message ?? String(err)}`
    };
  }

  const backend = (statusJson as any)?.BackendState;
  if (backend !== "Running") {
    return {
      status: "not_running",
      details: `Tailscale backend state: ${backend ?? "unknown"}.`
    };
  }

  if (!(statusJson as any)?.User) {
    return {
      status: "not_authenticated",
      details: "Tailscale is running but not logged in."
    };
  }

  let serveJson: unknown = null;
  try {
    const { stdout } = await execFileAsync("tailscale", ["serve", "status", "--json"], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1 * 1024 * 1024
    });
    serveJson = JSON.parse(stdout);
  } catch {
    // Cannot read serve status; treat as unverified rather than configured.
    return {
      status: "unknown",
      details: "Tailscale running and authenticated, but Serve status could not be verified."
    };
  }

  if (!isServeConfiguredForLoopback(serveJson, port)) {
    return {
      status: "serve_not_configured",
      details: "Tailscale is running and authenticated, but Serve is not configured for the loopback."
    };
  }

  return {
    status: "configured",
    details: "Tailscale running, authenticated, and Serve configured for the loopback."
  };
}

/** Inspect `tailscale serve status --json` for an HTTPS serve on the loopback port. */
function isServeConfiguredForLoopback(serveJson: unknown, port: number): boolean {
  const node = (serveJson as any)?.ServeConfig?.TCP?.["443"];
  if (!node) return false;
  const handlers = node.Handlers;
  if (!handlers || typeof handlers !== "object") return false;
  return Object.values(handlers).some((h: any) => {
    const target = h?.Proxy ?? h?.Path ?? "";
    return String(target).includes(String(port));
  });
}

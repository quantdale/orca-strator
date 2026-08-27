/**
 * Change 028 (D3): process identity abstraction used to decide, after a
 * controller crash, whether a previously-launched child process is still alive,
 * dead, reused by a foreign process, or unverifiable.
 *
 * PID equality alone is NEVER sufficient to terminate a process. Verdicts:
 *  - LIVE_MATCH: process is alive AND its identity evidence matches our record.
 *  - DEAD: process is not running.
 *  - PID_REUSED: a process with the same PID is alive but evidence does NOT match.
 *  - UNKNOWN: liveness/identity cannot be authoritatively determined.
 *
 * PID_REUSED and UNKNOWN are fail-closed: quarantine, never kill.
 */

export type ProcessIdentityVerdict =
  | "LIVE_MATCH"
  | "DEAD"
  | "PID_REUSED"
  | "UNKNOWN";

import { execFileSync } from "node:child_process";

export type ProcessKind = "DIRECT_EXECUTOR" | "SWARM_WORKER" | "DAG_WORKER";

export interface ProcessIdentityEvidence {
  pid: number;
  /** ISO timestamp captured immediately after the child emitted `spawn`. */
  capturedAtIso: string;
  /** Non-secret executable basename (never full argv/secret-bearing values). */
  executableName?: string;
  /** OS start/creation marker used to distinguish PID reuse. */
  startMarker?: string;
}

export interface ProcessOwnershipRecordLike {
  hostPid: number;
  executableName?: string;
  startMarker?: string;
}

export interface ProcessProbe {
  /** Capture non-secret identity evidence immediately after a real spawn. */
  capture(pid: number): ProcessIdentityEvidence;
  /** Classify a recorded process against current OS reality. */
  classify(record: ProcessOwnershipRecordLike): ProcessIdentityVerdict;
  /** Terminate the tree only when identity is verified to match. */
  killVerifiedTree(record: ProcessOwnershipRecordLike): void;
}

/** True when the verdict allows automatic lease reconciliation (release). */
export function isProcessReleasable(verdict: ProcessIdentityVerdict): boolean {
  return verdict === "DEAD";
}

/** True when the verdict must block a new actor (fail-closed). */
export function isProcessBlocking(verdict: ProcessIdentityVerdict): boolean {
  return verdict === "LIVE_MATCH" || verdict === "PID_REUSED" || verdict === "UNKNOWN";
}

/**
 * Best-effort portable OS identity capture for Linux hosts: start time (ticks
 * since boot, from /proc/<pid>/stat field 22) as a stable start marker and the
 * comm basename as non-secret executable identity. Returns {} when unavailable
 * (non-Linux, missing /proc, or the process is already gone). Used only to give
 * the portable probe real identity to round-trip in classify; absence of
 * evidence is handled fail-closed there.
 */
function readPortableIdentity(
  pid: number
): Partial<Pick<ProcessIdentityEvidence, "startMarker" | "executableName">> {
  if (process.platform !== "linux") return {};
  try {
    const stat = require("node:fs").readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm may contain spaces/parens; the start time is the field after the
    // last ')'. Safer: split on the first '(' and last ')'.
    const afterParen = stat.slice(stat.indexOf(")") + 1).trim();
    const fields = afterParen.split(/\s+/);
    const starttime = fields[19]; // state is fields[0]; starttime is index 19
    const comm = stat.slice(stat.indexOf("(") + 1, stat.indexOf(")"));
    const result: Partial<Pick<ProcessIdentityEvidence, "startMarker" | "executableName">> = {};
    if (starttime) result.startMarker = starttime;
    if (comm) result.executableName = comm;
    return result;
  } catch {
    return {};
  }
}

/** Returns true if the OS considers the pid alive (signal 0 probe). */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ESRCH: no such process. EPERM: alive but not ours -> still alive.
    return code === "EPERM";
  }
}

/**
 * Portable probe (Linux/macOS/CI/test). Uses signal-0 liveness plus an
 * in-memory start-marker registry captured at spawn. On platforms where we
 * cannot fetch OS creation time, `startMarker` is the authoritative match key
 * the spawner records; absence of a marker yields UNKNOWN instead of a false
 * LIVE_MATCH.
 */
export class PortableProcessProbe implements ProcessProbe {
  private readonly captures = new Map<number, ProcessIdentityEvidence>();

  capture(pid: number): ProcessIdentityEvidence {
    const evidence: ProcessIdentityEvidence = {
      pid,
      capturedAtIso: new Date().toISOString(),
      // Best-effort portable OS identity: Linux exposes start time via
      // /proc/<pid>/stat (field 22, clock ticks since boot) and the comm basename.
      ...readPortableIdentity(pid)
    };
    this.captures.set(pid, evidence);
    return evidence;
  }

  /** Seed identity evidence for a pid (used by tests / real spawners). */
  seed(record: ProcessIdentityEvidence): void {
    this.captures.set(record.pid, record);
  }

  forget(pid: number): void {
    this.captures.delete(pid);
  }

  classify(record: ProcessOwnershipRecordLike): ProcessIdentityVerdict {
    const alive = isPidAlive(record.hostPid);
    if (!alive) return "DEAD";

    const captured = this.captures.get(record.hostPid);
    if (!captured) {
      // A live process we never captured evidence for cannot be safely matched.
      return "UNKNOWN";
    }
    // Incomplete recorded evidence can never prove a match (Change 028 P0): a
    // record with no identity must not yield LIVE_MATCH against an arbitrary
    // live pid, or a foreign reused pid could be killed.
    const hasEvidence =
      record.startMarker !== undefined || record.executableName !== undefined;
    if (!hasEvidence) return "UNKNOWN";
    const markerMatches = record.startMarker === undefined
      ? captured.startMarker === undefined
      : record.startMarker === captured.startMarker;
    const exeMatches = record.executableName === undefined
      ? captured.executableName === undefined
      : record.executableName === captured.executableName;
    if (markerMatches && exeMatches) return "LIVE_MATCH";
    return "PID_REUSED";
  }

  killVerifiedTree(record: ProcessOwnershipRecordLike): void {
    const verdict = this.classify(record);
    if (verdict !== "LIVE_MATCH") {
      throw new Error(
        `REFUSING_KILL: process ${record.hostPid} verdict=${verdict} is not a verified match`
      );
    }
    try {
      process.kill(record.hostPid, "SIGKILL");
    } catch {
      // Already gone; treat as terminal.
    }
  }
}

/**
 * Windows probe. Liveness via signal-0 is unavailable on Windows for foreign
 * processes, so we query the OS for the process creation time and executable to
 * verify identity. `startMarker` is the process creation timestamp captured at
 * spawn; `executableName` is the basename. If the OS query is unavailable we
 * fail closed to UNKNOWN rather than guessing.
 */
export class WindowsProcessProbe implements ProcessProbe {
  capture(pid: number): ProcessIdentityEvidence {
    // Capture real OS identity at spawn so reconciliation can distinguish PID
    // reuse: process creation date is the authoritative start marker and the
    // executable basename is non-secret identity. On query failure the evidence
    // is left undefined, which makes classify fail closed to UNKNOWN (a record
    // with no identity must never yield LIVE_MATCH, Change 028 P0).
    const info = this.queryProcess(pid);
    const evidence: ProcessIdentityEvidence = {
      pid,
      capturedAtIso: new Date().toISOString()
    };
    if (info && info.kind === "found") {
      evidence.startMarker = info.creationDate;
      evidence.executableName = info.name || undefined;
    }
    return evidence;
  }

  /**
   * Query the OS for a process. Returns a discriminated result so callers can
   * tell PID-not-found (DEAD) apart from a probe failure (UNKNOWN): the two must
   * never collapse into one verdict (Change 028 P0).
   */
  private queryProcess(
    pid: number
  ): { kind: "found"; creationDate: string; name: string } | { kind: "notfound" } | { kind: "error" } {
    try {
      // Bounded PowerShell fetch of creation date + process name. No admin
      // rights required for read-only process enumeration.
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | ` +
            `Select-Object -Property CreationDate,Name | ConvertTo-Json -Compress`
        ],
        { timeout: 5000, windowsHide: true }
      ).toString().trim();
      if (!out) return { kind: "notfound" };
      const parsed = JSON.parse(out) as { CreationDate?: string; Name?: string };
      if (!parsed.CreationDate) return { kind: "notfound" };
      return { kind: "found", creationDate: parsed.CreationDate, name: parsed.Name ?? "" };
    } catch {
      return { kind: "error" };
    }
  }

  classify(record: ProcessOwnershipRecordLike): ProcessIdentityVerdict {
    const res = this.queryProcess(record.hostPid);
    if (res.kind === "notfound") return "DEAD";
    if (res.kind === "error") return "UNKNOWN";

    // Incomplete recorded evidence can never prove a match (Change 028 P0).
    const hasEvidence =
      record.startMarker !== undefined || record.executableName !== undefined;
    if (!hasEvidence) return "UNKNOWN";

    const markerMatches = record.startMarker === undefined
      ? true
      : record.startMarker === res.creationDate;
    const exeMatches = record.executableName === undefined
      ? true
      : record.executableName.toLowerCase() === (res.name || "").toLowerCase();

    if (markerMatches && exeMatches) return "LIVE_MATCH";
    return "PID_REUSED";
  }

  killVerifiedTree(record: ProcessOwnershipRecordLike): void {
    const verdict = this.classify(record);
    if (verdict !== "LIVE_MATCH") {
      throw new Error(
        `REFUSING_KILL: process ${record.hostPid} verdict=${verdict} is not a verified match`
      );
    }
    try {
      execFileSync(
        "taskkill.exe",
        ["/T", "/F", "/PID", String(record.hostPid)],
        { timeout: 5000, windowsHide: true }
      );
    } catch {
      // Best-effort; reconciliation records the attempt.
    }
  }
}

export function createProcessProbe(): ProcessProbe {
  if (process.platform === "win32") {
    return new WindowsProcessProbe();
  }
  return new PortableProcessProbe();
}

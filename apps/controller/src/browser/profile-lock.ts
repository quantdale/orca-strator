import fs from "node:fs";
import path from "node:path";

export type BrowserLockMode = "INTERACTIVE_SETUP" | "AUTOMATED";

export interface LockInfo {
  pid: number;
  acquiredAt: string;
  mode: BrowserLockMode;
  /** Raw caller-provided reason, preserved for diagnostics/back-compat. */
  reason: string;
}

/**
 * Cross-process + in-process browser profile lock.
 *
 * Finding J: a PID-only lock is insufficient because setup and automated browser
 * operations can live in the SAME controller process. We therefore record the
 * MODE and reject incompatible overlaps even within one process, and verify real
 * ownership for stale-lock recovery.
 */
export class ProfileLockManager {
  private readonly lockFilePath: string;

  constructor(profileDir: string) {
    this.lockFilePath = path.join(profileDir, "profile.lock");
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getLockInfo(): LockInfo | null {
    if (!fs.existsSync(this.lockFilePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.lockFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<LockInfo>;
      if (typeof parsed.pid !== "number" || typeof parsed.mode !== "string") {
        return null;
      }
      return parsed as LockInfo;
    } catch {
      return null;
    }
  }

  /**
   * Acquire the lock. `opts.ownerPid` lets a REAL external process (e.g. the
   * ordinary Chrome child spawned for interactive setup, Change 023) own the
   * lock: while that PID is alive, every other acquirer — including this
   * controller process — is refused, preserving Finding J semantics.
   */
  acquire(reason: string, opts?: { ownerPid?: number }): boolean {
    fs.mkdirSync(path.dirname(this.lockFilePath), { recursive: true });

    const mode = resolveMode(reason);
    const ownerPid = opts?.ownerPid ?? process.pid;

    const existing = this.getLockInfo();
    if (existing) {
      if (existing.pid === ownerPid && existing.mode === mode) {
        return true; // Re-entrant same mode in same owning process.
      }

      // Different mode (even in the same process) is an incompatible overlap (J).
      if (existing.pid === ownerPid && existing.mode !== mode) {
        return false;
      }

      if (this.isProcessAlive(existing.pid)) {
        return false; // Owned by a live process (different PID or mode).
      }

      // Stale lock recovery — verify before removing.
      try {
        fs.unlinkSync(this.lockFilePath);
      } catch {}
    }

    const info: LockInfo = {
      pid: ownerPid,
      acquiredAt: new Date().toISOString(),
      mode,
      reason,
    };

    try {
      fs.writeFileSync(this.lockFilePath, JSON.stringify(info, null, 2), {
        flag: "w",
      });
      return true;
    } catch {
      return false;
    }
  }

  release(): void {
    this.releaseFor(process.pid);
  }

  /** Release only when the stored owner matches `pid` (e.g. external setup Chrome). */
  releaseFor(pid: number): void {
    const existing = this.getLockInfo();
    if (existing && existing.pid === pid) {
      try {
        fs.unlinkSync(this.lockFilePath);
      } catch {}
    }
  }

  isLocked(): boolean {
    const info = this.getLockInfo();
    if (!info) return false;
    return this.isProcessAlive(info.pid);
  }
}

/**
 * Map a caller-provided reason to a lock MODE. Known setup/automated reasons map
 * directly; anything else defaults to AUTOMATED. The mode is what enforces
 * incompatible-overlap semantics within a single process (J).
 */
function resolveMode(reason: string): BrowserLockMode {
  const r = reason.toLowerCase();
  if (r.includes("setup") || r.includes("interactive"))
    return "INTERACTIVE_SETUP";
  if (r.includes("automated") || r.includes("wake")) return "AUTOMATED";
  return "AUTOMATED";
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ORCA_PROTOCOL_VERSION } from "@orca/shared";

/**
 * Data-directory-scoped controller singleton ownership (Change 025).
 *
 * Ownership is a lock FILE under the canonical Orca data directory, acquired
 * atomically with O_EXCL semantics. Port binding remains the final OS guard,
 * but the lock is authoritative for ownership so two controllers cannot race
 * into interleaved SQLite/watcher/browser state even before listen().
 *
 * A live foreign process is never signalled or killed. Stale locks (dead PID,
 * unreadable/corrupt metadata, or PID-less legacy content) may be reclaimed.
 *
 * Change 026: each owner also records a per-start random `controlToken` used
 * to authenticate graceful-shutdown requests from trusted same-user desktop
 * lifecycle operations. The token never travels over HTTP responses; only a
 * process that can read this user's data directory can present it.
 */

export interface RuntimeLockMetadata {
  service: "orca-controller";
  pid: number;
  startedAt: string;
  version: string;
  protocol: number;
  endpoint?: string;
  controlToken?: string;
}

export type LockAcquireOutcome =
  | { outcome: "acquired" }
  | { outcome: "reclaimed-stale"; previous: RuntimeLockMetadata | null; reason: string }
  | { outcome: "busy"; current: RuntimeLockMetadata };

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 probes liveness without signalling. On Windows this maps to a
    // real liveness check; EPERM means the process exists under another user,
    // which still counts as alive for ownership purposes.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EPERM") return true;
    return false;
  }
}

/** Per-start random control token for authenticated lifecycle operations. */
export function generateControlToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Constant-time comparison that never leaks prefix-match length. */
export function controlTokenMatches(presented: unknown, expected: string | undefined): boolean {
  if (typeof presented !== "string" || !expected || expected.length === 0) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Still burn a comparison to keep timing flat, then refuse.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function readMetadata(lockPath: string): { metadata: RuntimeLockMetadata | null; error?: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { metadata: null };
    return { metadata: null, error: `unreadable-lock: ${code ?? String(err)}` };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeLockMetadata>;
    if (
      parsed &&
      typeof parsed.pid === "number" &&
      typeof parsed.startedAt === "string" &&
      parsed.service === "orca-controller"
    ) {
      return {
        metadata: {
          service: "orca-controller",
          pid: parsed.pid,
          startedAt: parsed.startedAt,
          version: typeof parsed.version === "string" ? parsed.version : "unknown",
          protocol: typeof parsed.protocol === "number" ? parsed.protocol : 0,
          endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : undefined
        }
      };
    }
    return { metadata: null, error: "unrecognized-lock-content" };
  } catch {
    return { metadata: null, error: "unrecognized-lock-content" };
  }
}

export interface ControllerRuntimeLockOptions {
  /** Overrides for tests. */
  pid?: number;
  now?: () => Date;
}

export class ControllerRuntimeLock {
  private readonly lockPath: string;
  private readonly opts: ControllerRuntimeLockOptions;
  private owned = false;
  /** Per-start lifecycle token; generated once per owner and never rotated mid-run. */
  private readonly controlToken: string = generateControlToken();

  constructor(lockPath: string, opts: ControllerRuntimeLockOptions = {}) {
    this.lockPath = path.resolve(lockPath);
    this.opts = opts;
  }

  /** Token presented by THIS owner (only meaningful while owned). */
  get currentControlToken(): string {
    return this.controlToken;
  }

  get isOwned(): boolean {
    return this.owned;
  }

  get path(): string {
    return this.lockPath;
  }

  acquire(version: string): LockAcquireOutcome {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });

    let handle: number;
    try {
      // 'wx' is the atomic guard: exactly one contender can create the file.
      handle = fs.openSync(this.lockPath, "wx");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw err;

      const existing = readMetadata(this.lockPath);
      const meta = existing.metadata;
      if (!meta) {
        const reclaimed = this.writeLock(version);
        return reclaimed
          ? { outcome: "reclaimed-stale", previous: null, reason: existing.error ?? "corrupt-lock" }
          : { outcome: "busy", current: unknownBusyMetadata() };
      }
      if (isPidAlive(meta.pid)) {
        return { outcome: "busy", current: meta };
      }
      const reason = `stale-pid-${meta.pid}-not-alive`;
      const reclaimed = this.writeLock(version);
      return reclaimed
        ? { outcome: "reclaimed-stale", previous: meta, reason }
        : { outcome: "busy", current: meta };
    }

    try {
      const metadata = this.buildMetadata(version);
      fs.writeFileSync(handle, JSON.stringify(metadata, null, 2), "utf8");
    } finally {
      fs.closeSync(handle);
    }
    this.owned = true;
    return { outcome: "acquired" };
  }

  /** Update endpoint/build info after bind without changing ownership. */
  refresh(patch: { endpoint?: string }): void {
    if (!this.owned) return;
    const existing = readMetadata(this.lockPath).metadata;
    if (!existing) return;
    fs.writeFileSync(
      this.lockPath,
      JSON.stringify({ ...existing, ...patch }, null, 2),
      "utf8"
    );
  }

  /** Release ONLY our own lock; never delete a file we do not own. */
  release(): void {
    if (!this.owned) return;
    this.owned = false;
    try {
      const meta = readMetadata(this.lockPath).metadata;
      if (meta && meta.pid !== (this.opts.pid ?? process.pid)) return;
      fs.rmSync(this.lockPath, { force: true });
    } catch {
      // Best-effort release; a leftover stale lock is recoverable on next start.
    }
  }

  private buildMetadata(version: string): RuntimeLockMetadata {
    return {
      service: "orca-controller",
      pid: this.opts.pid ?? process.pid,
      startedAt: (this.opts.now ?? (() => new Date()))().toISOString(),
      version,
      protocol: ORCA_PROTOCOL_VERSION,
      controlToken: this.controlToken
    };
  }

  private writeLock(version: string): boolean {
    try {
      fs.rmSync(this.lockPath, { force: true });
      const handle = fs.openSync(this.lockPath, "wx");
      try {
        fs.writeFileSync(handle, JSON.stringify(this.buildMetadata(version), null, 2), "utf8");
      } finally {
        fs.closeSync(handle);
      }
      this.owned = true;
      return true;
    } catch {
      return false;
    }
  }
}

function unknownBusyMetadata(): RuntimeLockMetadata {
  return {
    service: "orca-controller",
    pid: -1,
    startedAt: new Date(0).toISOString(),
    version: "unknown",
    protocol: 0
  };
}

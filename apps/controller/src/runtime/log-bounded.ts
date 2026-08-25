import fs from "node:fs";
import path from "node:path";

/**
 * Runtime-bounded packaged logging (Change 027 WS2).
 *
 * Change 025 checked the 5 MiB bound only during startup and then appended
 * indefinitely, so one long-running leave-and-forget controller could exceed
 * the intended bound without ever restarting. This sink enforces the SAME
 * single-rotated-predecessor policy DURING the running process: bytes written
 * are counted continuously and the active file rotates to
 * `controller.prev.log` whenever the bound is crossed. Total on-disk usage is
 * therefore bounded at ~2x `maxFileBytes` for the process lifetime.
 *
 * Implementation note: rotation uses SYNCHRONOUS fd lifecycle
 * (openSync/writeSync/closeSync). An async WriteStream cannot be safely
 * renamed on Windows because end() releases its handle later than any
 * synchronous continuation; the fd model makes every rotation deterministic.
 *
 * Formatting/redaction semantics are unchanged from Change 025: ISO timestamp
 * prefix, level tag, plain string interpolation. A broken log sink never
 * blocks or crashes the controller.
 */

export const DEFAULT_LOG_BOUND_BYTES = 5 * 1024 * 1024;

export interface BoundedLogOptions {
  /** Maximum active-file size before rotation. Default 5 MiB. */
  maxFileBytes?: number;
}

export interface BoundedLogHandle {
  close: () => void;
  /** Bytes attributed to the ACTIVE file since its creation. Exposed for tests. */
  activeBytes: () => number;
  /** Path of the active log file. */
  readonly file: string;
  /** Path of the rotated predecessor file. */
  readonly previousFile: string;
  /** Number of COMPLETED rotations by this handle. Exposed for tests. */
  rotations: () => number;
}

function currentSizeOrZero(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Create the bounded log sink WITHOUT overriding console globals. Returns the
 * write entry point so tests (and alternative shells) drive it directly.
 */
export function createBoundedLogSink(
  logDir: string,
  options: BoundedLogOptions = {}
): { handle: BoundedLogHandle; write: (level: string, ...parts: unknown[]) => void } {
  fs.mkdirSync(logDir, { recursive: true });
  const maxBytes = options.maxFileBytes ?? DEFAULT_LOG_BOUND_BYTES;
  const file = path.join(logDir, "controller.log");
  const previousFile = path.join(logDir, "controller.prev.log");

  let fd: number | null = null;
  let active = 0;
  let rotationCount = 0;

  const open = (): void => {
    fd = fs.openSync(file, "a");
    active = currentSizeOrZero(file);
  };

  const ensureOpen = (): void => {
    if (fd === null) open();
  };

  const closeCurrent = (): void => {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore double-close */
      }
      fd = null;
    }
  };

  /**
   * Rotate only after the current fd is closed, so the rename cannot race an
   * open handle on Windows. Returns true only when the rename completed.
   */
  const rotate = (): boolean => {
    closeCurrent();
    try {
      fs.rmSync(previousFile, { force: true });
      if (!fs.existsSync(file)) return false;
      fs.renameSync(file, previousFile);
      rotationCount += 1;
      return true;
    } catch {
      // If rotation fails (transient AV/indexer locks), keep appending to the
      // existing file; the next bound crossing retries. Never propagate.
      return false;
    } finally {
      open();
    }
  };

  // Startup enforcement: a pre-existing oversized log from an older binary
  // rotates immediately instead of growing further this run.
  ensureOpen();
  if (active > maxBytes) rotate();

  const write = (level: string, ...parts: unknown[]): void => {
    try {
      ensureOpen();
      if (fd === null) return;
      if (active >= maxBytes && !rotate()) {
        // Rotation refused (file locked); drop THIS line rather than grow an
        // over-bound file unboundedly. The next call retries rotation.
        return;
      }
      const text = `${new Date().toISOString()} [${level}] ${parts.map((p) => String(p)).join(" ")}\n`;
      const payload = Buffer.from(text, "utf8");
      fs.writeSync(fd, payload);
      active += payload.byteLength;
    } catch {
      /* never block or crash the caller on logging failures */
    }
  };

  const handle: BoundedLogHandle = {
    get file() {
      return file;
    },
    get previousFile() {
      return previousFile;
    },
    activeBytes: () => active,
    rotations: () => rotationCount,
    close: () => closeCurrent()
  };

  return { handle, write };
}

/**
 * Install the bounded sink as the process-wide console transport (packaged
 * mode). Same override surface as Change 025 so callers need not change.
 */
export function installBoundedPackagedLogging(
  logDir: string,
  options: BoundedLogOptions = {}
): BoundedLogHandle | null {
  try {
    const { handle, write } = createBoundedLogSink(logDir, options);
    console.log = (...parts: unknown[]) => write("log", ...parts);
    console.info = (...parts: unknown[]) => write("info", ...parts);
    console.warn = (...parts: unknown[]) => write("warn", ...parts);
    console.error = (...parts: unknown[]) => write("error", ...parts);
    return handle;
  } catch {
    // A broken log sink never blocks startup; stdout may still exist in dev.
    return null;
  }
}

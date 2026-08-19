import fs from "node:fs";
import path from "node:path";

export interface LockInfo {
  pid: number;
  acquiredAt: string;
  reason: string;
}

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
      return JSON.parse(raw) as LockInfo;
    } catch {
      return null;
    }
  }

  acquire(reason: string): boolean {
    fs.mkdirSync(path.dirname(this.lockFilePath), { recursive: true });

    const existing = this.getLockInfo();
    if (existing) {
      if (existing.pid === process.pid) {
        return true;
      }

      if (this.isProcessAlive(existing.pid)) {
        return false;
      }

      // Stale lock recovery
      try {
        fs.unlinkSync(this.lockFilePath);
      } catch {}
    }

    const info: LockInfo = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      reason
    };

    try {
      fs.writeFileSync(this.lockFilePath, JSON.stringify(info, null, 2), { flag: "w" });
      return true;
    } catch {
      return false;
    }
  }

  release(): void {
    const existing = this.getLockInfo();
    if (existing && existing.pid === process.pid) {
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

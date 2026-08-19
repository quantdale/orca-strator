/**
 * Windows <-> WSL path conversion (Finding C).
 *
 * A WSL repository has a Windows-side `localPath` (e.g. `D:\Projects\Repo`), but
 * Git operations and the executor must run against the Linux working tree via
 * `wsl.exe -d <distro> --cd <linuxPath> -- ...`. The Linux mount path is
 * `/mnt/<lowercase-drive>/...`. We must NOT run Windows git with a Linux cwd, nor
 * Linux git with a Windows cwd.
 */

const WINDOWS_PATH_RE = /^([A-Za-z]):[\\/](.*)$/;
const WSL_PATH_RE = /^\/mnt\/([A-Za-z])[\\/](.*)$/;

/** `D:\Projects\Repo` | `D:/Projects/Repo` -> `/mnt/d/Projects/Repo`. */
export function toWslPath(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, "/");
  const match = normalized.match(WINDOWS_PATH_RE);
  if (!match) return normalized;
  const drive = match[1]!.toLowerCase();
  const rest = match[2]!.replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

/** `/mnt/d/Projects/Repo` -> `D:\Projects\Repo`. */
export function toWindowsPath(linuxPath: string): string {
  const normalized = linuxPath.replace(/\//g, "/");
  const match = normalized.match(WSL_PATH_RE);
  if (!match) return linuxPath;
  const drive = match[1]!.toUpperCase();
  const rest = match[2]!.replace(/\//g, "\\");
  return `${drive}:\\${rest}`;
}

export function isWindowsPath(p: string): boolean {
  return WINDOWS_PATH_RE.test(p);
}

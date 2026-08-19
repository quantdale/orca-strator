import fs from "node:fs";
import path from "node:path";

export class LogRotator {
  constructor(private readonly dataDir: string) {}

  pruneLogs(repositoryId: string, maxRetainedFiles = 50): number {
    const repoLogDir = path.join(this.dataDir, "logs", "repositories", repositoryId);
    if (!fs.existsSync(repoLogDir)) return 0;

    const files = fs.readdirSync(repoLogDir);
    if (files.length <= maxRetainedFiles) return 0;

    const fileDetails = files.map((file) => {
      const fullPath = path.join(repoLogDir, file);
      const stat = fs.statSync(fullPath);
      return {
        file,
        fullPath,
        mtimeMs: stat.mtimeMs
      };
    });

    // Sort ascending (oldest first)
    fileDetails.sort((a, b) => a.mtimeMs - b.mtimeMs);

    const filesToDelete = fileDetails.slice(0, fileDetails.length - maxRetainedFiles);
    let deletedCount = 0;

    for (const item of filesToDelete) {
      try {
        fs.unlinkSync(item.fullPath);
        deletedCount++;
      } catch (err) {
        console.warn(`[LogRotator] Failed to prune log file ${item.fullPath}:`, err);
      }
    }

    return deletedCount;
  }
}

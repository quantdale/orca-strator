import {
  validateDispatchMarker,
  isDispatchFilePath,
  extractDispatchIdFromPath,
  type DispatchMarker
} from "@orca/shared";
import type { FileChange, GitClient } from "./git-client.js";

export type CommitInspectionResult =
  | {
      type: "VALID_DISPATCH";
      commitSha: string;
      dispatchId: string;
      dispatch: DispatchMarker;
    }
  | {
      type: "REJECTED_DISPATCH";
      commitSha: string;
      dispatchId: string | null;
      reason: string;
    }
  | {
      type: "NO_DISPATCH";
      commitSha: string;
    };

export class CommitInspector {
  constructor(private readonly gitClient: GitClient) {}

  inspectChanges(changes: FileChange[], fileContentGetter: (path: string) => Promise<string>, commitSha: string): Promise<CommitInspectionResult> {
    return this.evaluateChanges(changes, fileContentGetter, commitSha);
  }

  async inspectCommit(repoPath: string, commitSha: string): Promise<CommitInspectionResult> {
    const changes = await this.gitClient.getCommitChanges(repoPath, commitSha);
    return this.evaluateChanges(
      changes,
      (filePath) => this.gitClient.getFileContentAtCommit(repoPath, commitSha, filePath),
      commitSha
    );
  }

  private async evaluateChanges(
    changes: FileChange[],
    getFileContent: (path: string) => Promise<string>,
    commitSha: string
  ): Promise<CommitInspectionResult> {
    const dispatchChanges = changes.filter((c) => isDispatchFilePath(c.path));
    const nonDispatchChanges = changes.filter((c) => !isDispatchFilePath(c.path));

    // Case 1: No dispatch files touched in this commit (ordinary commit)
    if (dispatchChanges.length === 0) {
      return { type: "NO_DISPATCH", commitSha };
    }

    // Case 2: Mixed commit (touches dispatch file AND other files)
    if (nonDispatchChanges.length > 0) {
      const firstDispatch = dispatchChanges[0];
      const dispatchId = firstDispatch ? extractDispatchIdFromPath(firstDispatch.path) : null;
      return {
        type: "REJECTED_DISPATCH",
        commitSha,
        dispatchId,
        reason: `Mixed commit rejected: Dispatch commit must only introduce a dispatch marker, but also modified: ${nonDispatchChanges
          .map((c) => c.path)
          .join(", ")}`
      };
    }

    // Case 3: Multiple dispatch files in single commit
    if (dispatchChanges.length > 1) {
      return {
        type: "REJECTED_DISPATCH",
        commitSha,
        dispatchId: null,
        reason: `Multiple dispatch files in single commit rejected: Found ${dispatchChanges
          .map((c) => c.path)
          .join(", ")}`
      };
    }

    const singleChange = dispatchChanges[0]!;
    const dispatchIdFromPath = extractDispatchIdFromPath(singleChange.path);

    // Case 4: Modified or deleted existing dispatch file (immutability violation)
    if (singleChange.status !== "A") {
      return {
        type: "REJECTED_DISPATCH",
        commitSha,
        dispatchId: dispatchIdFromPath,
        reason: `Dispatch immutability violation: Dispatch files cannot be modified or deleted (status=${singleChange.status}, path=${singleChange.path})`
      };
    }

    // Case 5: Content parsing and schema validation
    try {
      const content = await getFileContent(singleChange.path);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err: any) {
        return {
          type: "REJECTED_DISPATCH",
          commitSha,
          dispatchId: dispatchIdFromPath,
          reason: `Malformed JSON in dispatch file ${singleChange.path}: ${err.message}`
        };
      }

      const dispatch = validateDispatchMarker(parsed);

      if (dispatch.dispatchId !== dispatchIdFromPath) {
        return {
          type: "REJECTED_DISPATCH",
          commitSha,
          dispatchId: dispatchIdFromPath,
          reason: `Dispatch ID mismatch: Filename ID '${dispatchIdFromPath}' does not match JSON payload dispatchId '${dispatch.dispatchId}'`
        };
      }

      return {
        type: "VALID_DISPATCH",
        commitSha,
        dispatchId: dispatch.dispatchId,
        dispatch
      };
    } catch (err: any) {
      return {
        type: "REJECTED_DISPATCH",
        commitSha,
        dispatchId: dispatchIdFromPath,
        reason: `Dispatch schema validation failed: ${err.message}`
      };
    }
  }
}

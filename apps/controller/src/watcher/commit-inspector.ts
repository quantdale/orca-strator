import {
  validateDispatchMarker,
  isDispatchFilePath,
  extractDispatchIdFromPath,
  validateSolControlMarker,
  isSolControlFilePath,
  extractControlIdFromPath,
  type DispatchMarker,
  type SolControlMarker
} from "@orca/shared";
import type { FileChange, GitContext, GitClient } from "./git-client.js";

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
      type: "SOL_CONTROL";
      commitSha: string;
      controlId: string;
      control: SolControlMarker;
    }
  | {
      type: "REJECTED_SOL_CONTROL";
      commitSha: string;
      controlId: string | null;
      reason: string;
    }
  | {
      type: "NO_DISPATCH";
      commitSha: string;
    };

export class CommitInspector {
  constructor(private readonly gitClient: GitClient) {}

  inspectChanges(
    changes: FileChange[],
    fileContentGetter: (path: string) => Promise<string>,
    commitSha: string
  ): Promise<CommitInspectionResult> {
    return this.evaluateChanges(changes, fileContentGetter, commitSha);
  }

  async inspectCommit(
    target: GitContext | string,
    commitSha: string
  ): Promise<CommitInspectionResult> {
    const changes = await this.gitClient.getCommitChanges(target, commitSha);
    return this.evaluateChanges(
      changes,
      (filePath) => this.gitClient.getFileContentAtCommit(target, commitSha, filePath),
      commitSha
    );
  }

  private async evaluateChanges(
    changes: FileChange[],
    getFileContent: (path: string) => Promise<string>,
    commitSha: string
  ): Promise<CommitInspectionResult> {
    const dispatchChanges = changes.filter((c) => isDispatchFilePath(c.path));
    const controlChanges = changes.filter((c) => isSolControlFilePath(c.path));
    const nonArtifactChanges = changes.filter(
      (c) => !isDispatchFilePath(c.path) && !isSolControlFilePath(c.path)
    );

    // --- Sol control marker handling ---
    if (controlChanges.length > 0) {
      const single = controlChanges[0]!;
      const controlId = extractControlIdFromPath(single.path);

      if (controlChanges.length > 1) {
        return {
          type: "REJECTED_SOL_CONTROL",
          commitSha,
          controlId,
          reason: `Multiple sol-control files in single commit rejected: ${controlChanges
            .map((c) => c.path)
            .join(", ")}`
        };
      }

      if (single.status !== "A") {
        return {
          type: "REJECTED_SOL_CONTROL",
          commitSha,
          controlId,
          reason: `Sol-control immutability violation: file must be added, not modified/deleted (status=${single.status}, path=${single.path})`
        };
      }

      if (nonArtifactChanges.length > 0) {
        return {
          type: "REJECTED_SOL_CONTROL",
          commitSha,
          controlId,
          reason: `Mixed sol-control commit rejected: sol-control marker must be isolated, but also modified: ${nonArtifactChanges
            .map((c) => c.path)
            .join(", ")}`
        };
      }

      try {
        const content = await getFileContent(single.path);
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch (err: any) {
          return {
            type: "REJECTED_SOL_CONTROL",
            commitSha,
            controlId,
            reason: `Malformed JSON in sol-control file ${single.path}: ${err.message}`
          };
        }
        const control = validateSolControlMarker(parsed);
        if (control.controlId !== controlId) {
          return {
            type: "REJECTED_SOL_CONTROL",
            commitSha,
            controlId,
            reason: `Control ID mismatch: filename ID '${controlId}' does not match payload controlId '${control.controlId}'`
          };
        }
        return { type: "SOL_CONTROL", commitSha, controlId: control.controlId, control };
      } catch (err: any) {
        return {
          type: "REJECTED_SOL_CONTROL",
          commitSha,
          controlId,
          reason: `Sol-control schema validation failed: ${err.message}`
        };
      }
    }

    // --- Dispatch marker handling ---
    if (dispatchChanges.length === 0) {
      return { type: "NO_DISPATCH", commitSha };
    }

    if (nonArtifactChanges.length > 0) {
      const firstDispatch = dispatchChanges[0];
      const dispatchId = firstDispatch ? extractDispatchIdFromPath(firstDispatch.path) : null;
      return {
        type: "REJECTED_DISPATCH",
        commitSha,
        dispatchId,
        reason: `Mixed commit rejected: Dispatch commit must only introduce a dispatch marker, but also modified: ${nonArtifactChanges
          .map((c) => c.path)
          .join(", ")}`
      };
    }

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

    if (singleChange.status !== "A") {
      return {
        type: "REJECTED_DISPATCH",
        commitSha,
        dispatchId: dispatchIdFromPath,
        reason: `Dispatch immutability violation: Dispatch files cannot be modified or deleted (status=${singleChange.status}, path=${singleChange.path})`
      };
    }

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

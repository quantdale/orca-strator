import { describe, it, expect } from "vitest";
import {
  validateExecutorResult,
  isResultFilePath,
  extractResultDispatchId,
  ValidationError,
  type ExecutorResult
} from "../src/index.js";

describe("Executor Result Protocol Validation (Task 1)", () => {
  const validResult: ExecutorResult = {
    schemaVersion: 1,
    type: "executor-result",
    runId: "run-2026-001",
    dispatchId: "disp-2026-001",
    iteration: 1,
    status: "COMPLETED",
    startedAt: "2026-08-19T12:00:00.000Z",
    finishedAt: "2026-08-19T12:30:00.000Z",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    resultSha: "89abcdef0123456789abcdef0123456789abcdef",
    executor: {
      cli: "codex",
      model: "gpt-5.6",
      environment: "windows"
    },
    verification: [
      {
        name: "npm test",
        status: "PASS",
        summary: "All unit tests passed"
      },
      {
        name: "npm run typecheck",
        status: "PASS",
        summary: "Typecheck passed"
      }
    ],
    blockers: [],
    summary: "Implemented the requested feature and passed all tests."
  };

  it("1.T1 validates a valid completed executor result", () => {
    const validated = validateExecutorResult(validResult);
    expect(validated).toEqual(validResult);
  });

  it("1.T2 validates BLOCKED, NEEDS_HUMAN, and FAILED statuses", () => {
    const blocked: ExecutorResult = {
      ...validResult,
      status: "BLOCKED",
      blockers: [
        {
          code: "AUTH_REQUIRED",
          summary: "Missing API token for third-party service",
          evidence: "HTTP 401 Unauthorized"
        }
      ]
    };
    expect(validateExecutorResult(blocked).status).toBe("BLOCKED");

    const needsHuman: ExecutorResult = {
      ...validResult,
      status: "NEEDS_HUMAN"
    };
    expect(validateExecutorResult(needsHuman).status).toBe("NEEDS_HUMAN");

    const failed: ExecutorResult = {
      ...validResult,
      status: "FAILED",
      verification: [
        {
          name: "npm test",
          status: "FAIL",
          summary: "3 tests failed"
        }
      ]
    };
    expect(validateExecutorResult(failed).status).toBe("FAILED");
  });

  it("1.T3 rejects invalid status or missing fields", () => {
    expect(() =>
      validateExecutorResult({
        ...validResult,
        status: "INVALID_STATUS"
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateExecutorResult({
        ...validResult,
        executor: {
          cli: "codex",
          model: "gpt-5.6",
          environment: "invalid_env"
        }
      })
    ).toThrow(ValidationError);
  });

  it("1.T4 rejects invalid SHAs and non-ISO timestamps", () => {
    expect(() =>
      validateExecutorResult({
        ...validResult,
        baseSha: "short-sha"
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateExecutorResult({
        ...validResult,
        startedAt: "2026-08-19 12:00:00" // not ISO 8601
      })
    ).toThrow(ValidationError);
  });

  it("1.T5 isResultFilePath and extractResultDispatchId recognize result manifests", () => {
    expect(isResultFilePath(".orca/results/disp-001.json")).toBe(true);
    expect(isResultFilePath(".orca/dispatch/disp-001.json")).toBe(false);
    expect(isResultFilePath(".orca/results/sub/disp.json")).toBe(false);

    expect(extractResultDispatchId(".orca/results/disp-001.json")).toBe("disp-001");
    expect(extractResultDispatchId("other/path.json")).toBeNull();
  });
});

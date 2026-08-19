import { describe, it, expect } from "vitest";
import {
  validateDispatchMarker,
  isSafeRelativePath,
  isDispatchFilePath,
  extractDispatchIdFromPath,
  ValidationError,
  type DispatchMarker
} from "../src/index.js";

describe("Dispatch Protocol Validation (Task 1)", () => {
  const validDispatch: DispatchMarker = {
    schemaVersion: 1,
    type: "dispatch",
    runId: "run-20260819-01",
    dispatchId: "dispatch-001",
    iteration: 1,
    createdAt: "2026-08-19T12:00:00.000Z",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/002-repository-watch-dispatch",
    goal: "Implement repository watcher and transactional dispatch",
    instructionsVersion: 1
  };

  it("1.T1 validates a valid dispatch marker", () => {
    const validated = validateDispatchMarker(validDispatch);
    expect(validated).toEqual(validDispatch);
  });

  it("1.T2 rejects invalid schemaVersion or type", () => {
    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        schemaVersion: 2
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        type: "unknown"
      })
    ).toThrow(ValidationError);
  });

  it("1.T3 rejects invalid SHAs (non-hex, wrong length)", () => {
    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        baseSha: "not-a-sha"
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        baseSha: "0123456789abcdef" // only 16 chars
      })
    ).toThrow(ValidationError);
  });

  it("1.T4 rejects path traversal in changePath", () => {
    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        changePath: "../escape/path"
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        changePath: "openspec/../../escape"
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        changePath: "/absolute/path"
      })
    ).toThrow(ValidationError);
  });

  it("1.T5 rejects unknown properties under strict schema", () => {
    expect(() =>
      validateDispatchMarker({
        ...validDispatch,
        extraProperty: "should-fail"
      })
    ).toThrow(ValidationError);
  });

  it("1.T6 isSafeRelativePath correctly validates paths", () => {
    expect(isSafeRelativePath("openspec/changes/001")).toBe(true);
    expect(isSafeRelativePath("docs/ROADMAP.md")).toBe(true);
    expect(isSafeRelativePath("../escape")).toBe(false);
    expect(isSafeRelativePath("foo/../bar")).toBe(false);
    expect(isSafeRelativePath("/leading/slash")).toBe(false);
    expect(isSafeRelativePath("\\leading\\windows\\slash")).toBe(false);
  });

  it("1.T7 isDispatchFilePath and extractDispatchIdFromPath detect dispatch files", () => {
    expect(isDispatchFilePath(".orca/dispatch/disp-123.json")).toBe(true);
    expect(isDispatchFilePath(".orca/dispatch/disp_456.json")).toBe(true);
    expect(isDispatchFilePath(".orca/results/disp-123.json")).toBe(false);
    expect(isDispatchFilePath(".orca/dispatch/sub/disp.json")).toBe(false);

    expect(extractDispatchIdFromPath(".orca/dispatch/disp-123.json")).toBe("disp-123");
    expect(extractDispatchIdFromPath(".orca/dispatch/disp_456.json")).toBe("disp_456");
    expect(extractDispatchIdFromPath("other/path.json")).toBeNull();
  });
});

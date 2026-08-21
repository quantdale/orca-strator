/**
 * Zod <-> JSON Schema conformance guard for the .orca protocol contracts.
 *
 * schemas/protocol/*.schema.json are the documented structural contracts
 * (docs/CROSS-AGENT-PROTOCOL.md), but runtime enforcement uses hand-written
 * Zod mirrors in @orca/shared. Nothing else ties the two together, so this
 * suite pins each JSON Schema to its Zod mirror so silent drift fails CI:
 *
 *   dispatch.schema.json        <-> validateDispatchMarker (dispatchMarkerSchema)
 *   executor-result.schema.json <-> validateExecutorResult  (executorResultSchema)
 *   sol-control.schema.json     <-> validateSolControlMarker (solControlMarkerSchema)
 *
 * Fast tier: pure fs reads + in-memory validation; no Git, network, or DB.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  validateDispatchMarker,
  validateExecutorResult,
  validateSolControlMarker,
} from "@orca/shared";

// Repo root resolved from this file's location (apps/controller/test/ -> repo root),
// independent of the vitest working directory.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PROTOCOL_SCHEMA_DIR = path.join(REPO_ROOT, "schemas", "protocol");

/**
 * Every *.schema.json under schemas/protocol/ must be listed here AND have its
 * own conformance describe block above the meta-guard at the bottom. Adding a
 * new protocol schema without extending this suite fails the meta-guard.
 */
const COVERED_PROTOCOL_SCHEMAS = [
  "dispatch.schema.json",
  "executor-result.schema.json",
  "sol-control.schema.json",
].sort();

type JsonSchema = Record<string, any>;

function loadProtocolSchema(fileName: string): JsonSchema {
  const filePath = path.join(PROTOCOL_SCHEMA_DIR, fileName);
  expect(fs.existsSync(filePath), `missing protocol schema: ${fileName}`).toBe(true);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonSchema;
}

/** Runs a public @orca/shared validator and reports accept/reject without throwing. */
function isValid(validate: (input: unknown) => unknown, input: unknown): boolean {
  try {
    validate(input);
    return true;
  } catch {
    return false;
  }
}

function omit(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const clone = { ...obj };
  delete clone[key];
  return clone;
}

// Deterministic fixture data: fixed timestamp, synthetic SHAs. No clock use.
const FIXED_TS = "2026-01-15T10:30:00.000Z";
const BASE_SHA = "a".repeat(40);
const RESULT_SHA = "b".repeat(40);

function makeDispatchFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "dispatch",
    runId: "run-conformance",
    dispatchId: "disp-conformance",
    iteration: 3,
    createdAt: FIXED_TS,
    baseSha: BASE_SHA,
    changePath: "openspec/changes/018-schema-guard",
    goal: "Guard protocol schema conformance",
    instructionsVersion: 2,
    strategy: "SINGLE_AGENT"
  };
}

function makeExecutorResultFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "executor-result",
    runId: "run-conformance",
    dispatchId: "disp-conformance",
    iteration: 3,
    status: "COMPLETED",
    startedAt: FIXED_TS,
    finishedAt: FIXED_TS,
    baseSha: BASE_SHA,
    resultSha: RESULT_SHA,
    executor: { cli: "orca-test-harness", model: "test-model", environment: "windows" },
    verification: [{ name: "smoke", status: "PASS", summary: "ok" }],
    blockers: [{ code: "TEST_BLOCKER", summary: "blocked on x", evidence: "evidence.txt" }],
    summary: "ok"
  };
}

function makeSolControlFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "sol-control",
    runId: "run-conformance",
    controlId: "ctrl-conformance",
    iteration: 3,
    createdAt: FIXED_TS,
    decision: "GOAL_COMPLETE",
    relatedDispatchId: "disp-conformance",
    summary: "ok"
  };
}

describe("protocol schema <-> Zod conformance: dispatch.schema.json", () => {
  const json = loadProtocolSchema("dispatch.schema.json");
  const props = json.properties as JsonSchema;

  it("declares required fields and strictness matching validateDispatchMarker", () => {
    expect(json.type).toBe("object");
    // Strictness intent consistent: JSON additionalProperties:false <-> Zod .strict().
    expect(json.additionalProperties).toBe(false);
    expect(props.schemaVersion).toMatchObject({ const: 1 });
    expect(props.type).toMatchObject({ const: "dispatch" });
    expect(json.required).toEqual([
      "schemaVersion",
      "type",
      "runId",
      "dispatchId",
      "iteration",
      "createdAt",
      "baseSha",
      "changePath",
      "goal",
      "instructionsVersion"
    ]);
    // strategy/executionPlan stay optional on both sides (legacy V1 dispatches omit them).
    expect(json.required).not.toContain("strategy");
    expect(json.required).not.toContain("executionPlan");
    expect(isValid(validateDispatchMarker, omit(makeDispatchFixture(), "strategy"))).toBe(true);
  });

  it("matches string constraints expressed on both sides", () => {
    expect(props.runId).toMatchObject({ type: "string", minLength: 1, maxLength: 200 });
    expect(props.dispatchId).toMatchObject({ type: "string", minLength: 1, maxLength: 200 });
    expect(props.goal).toMatchObject({ type: "string", minLength: 1, maxLength: 1000 });
    expect(props.changePath).toMatchObject({ type: "string", minLength: 1, maxLength: 500 });
    expect(props.iteration).toMatchObject({ type: "integer", minimum: 1 });
    expect(props.instructionsVersion).toMatchObject({ type: "integer", minimum: 1 });
    // Gap note: JSON expresses createdAt as format:"date-time" (RFC 3339, annotation-only
    // in draft 2020-12); Zod enforces z.string().datetime() (UTC 'Z' only, no numeric
    // offsets). Format semantics are not directly comparable across vocabularies.
    expect(typeof props.createdAt.format).toBe("string");
  });

  it("expresses the same SHA-40 shape for baseSha on both sides", () => {
    expect(props.baseSha.pattern).toBe("^[0-9a-f]{40}$");
    const jsonRe = new RegExp(props.baseSha.pattern as string);
    const zodAccepts = (sha: string) =>
      isValid(validateDispatchMarker, { ...makeDispatchFixture(), baseSha: sha });
    // Lowercase 40-hex accepted by both; wrong length / non-hex rejected by both.
    expect(jsonRe.test(BASE_SHA)).toBe(true);
    expect(zodAccepts(BASE_SHA)).toBe(true);
    expect(jsonRe.test("a".repeat(39))).toBe(false);
    expect(jsonRe.test("z".repeat(40))).toBe(false);
    expect(zodAccepts("z".repeat(40))).toBe(false);
    // KNOWN DRIFT (flagged for triage, intentionally not fixed): the JSON pattern is
    // case-sensitive while the Zod mirror uses /^[0-9a-f]{40}$/i, so uppercase hex is
    // accepted by runtime enforcement but rejected by the published contract.
    expect(jsonRe.test(BASE_SHA.toUpperCase())).toBe(false);
    expect(zodAccepts(BASE_SHA.toUpperCase())).toBe(true);
  });

  it("rejects unsafe changePath values on both sides", () => {
    expect(typeof props.changePath.pattern).toBe("string");
    const jsonRe = new RegExp(props.changePath.pattern as string);
    const zodAccepts = (p: string) =>
      isValid(validateDispatchMarker, { ...makeDispatchFixture(), changePath: p });
    const safePaths = ["openspec/changes/x", "a/b/c.json"];
    const unsafePaths = ["/absolute/path", "a/../escape", ".."];
    for (const p of safePaths) {
      expect(jsonRe.test(p), `JSON should accept ${p}`).toBe(true);
      expect(zodAccepts(p), `Zod should accept ${p}`).toBe(true);
    }
    for (const p of unsafePaths) {
      expect(jsonRe.test(p), `JSON should reject ${p}`).toBe(false);
      expect(zodAccepts(p), `Zod should reject ${p}`).toBe(false);
    }
    // KNOWN DRIFT (flagged for triage, intentionally not fixed): the JSON regex only
    // inspects '/' separators, while the Zod refine normalizes '\' to '/' first and
    // also rejects a leading '\'. Windows-style traversal below fails runtime
    // enforcement but would pass the published contract's pattern.
    expect(jsonRe.test("..\\escape")).toBe(true);
    expect(zodAccepts("..\\escape")).toBe(false);
  });

  it("matches the execution strategy enum values", () => {
    expect(props.strategy.enum).toEqual(["SINGLE_AGENT", "SWARM", "DAG"]);
    for (const value of props.strategy.enum as string[]) {
      expect(
        isValid(validateDispatchMarker, { ...makeDispatchFixture(), strategy: value }),
        `Zod should accept strategy ${value}`
      ).toBe(true);
    }
    expect(isValid(validateDispatchMarker, { ...makeDispatchFixture(), strategy: "HYBRID" })).toBe(false);
  });

  it("matches executionPlan nested structure (packetIds/dagNodes/maxConcurrency)", () => {
    const plan = props.executionPlan as JsonSchema;
    expect(plan.additionalProperties).toBe(false);
    expect(plan.properties.packetIds).toMatchObject({ minItems: 1, maxItems: 100 });
    expect(plan.properties.packetIds.items).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(plan.properties.dagNodes).toMatchObject({ minItems: 1, maxItems: 100 });
    const node = plan.properties.dagNodes.items as JsonSchema;
    expect(node.additionalProperties).toBe(false);
    expect(node.required).toEqual(["nodeId", "packetId", "dependsOn"]);
    expect(node.properties.nodeId).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(node.properties.dependsOn).toMatchObject({ maxItems: 100 });
    expect(plan.properties.maxConcurrency).toMatchObject({ minimum: 1, maximum: 32 });

    // Positive round-trips for both non-default plan shapes (dependsOn has no
    // minItems on either side, so empty dependency lists are legal on both).
    expect(
      isValid(validateDispatchMarker, {
        ...makeDispatchFixture(),
        strategy: "SWARM",
        executionPlan: { packetIds: ["pkt-a", "pkt-b"], maxConcurrency: 4 }
      })
    ).toBe(true);
    expect(
      isValid(validateDispatchMarker, {
        ...makeDispatchFixture(),
        strategy: "DAG",
        executionPlan: { dagNodes: [{ nodeId: "n1", packetId: "pkt-a", dependsOn: [] }], maxConcurrency: 32 }
      })
    ).toBe(true);

    // Guarded nested mutations reject on both sides.
    expect(
      isValid(validateDispatchMarker, {
        ...makeDispatchFixture(),
        executionPlan: { unknownKey: true } // strictness
      })
    ).toBe(false);
    expect(
      isValid(validateDispatchMarker, {
        ...makeDispatchFixture(),
        executionPlan: { packetIds: [] } // minItems 1
      })
    ).toBe(false);
    expect(
      isValid(validateDispatchMarker, {
        ...makeDispatchFixture(),
        executionPlan: { dagNodes: [{ nodeId: "n1", packetId: "pkt-a" }] } // missing dependsOn
      })
    ).toBe(false);
    expect(
      isValid(validateDispatchMarker, {
        ...makeDispatchFixture(),
        executionPlan: { maxConcurrency: 33 } // > maximum 32
      })
    ).toBe(false);
  });

  it("rejects unknown top-level properties like the JSON additionalProperties:false", () => {
    expect(isValid(validateDispatchMarker, { ...makeDispatchFixture(), extraField: 1 })).toBe(false);
  });
});

describe("protocol schema <-> Zod conformance: executor-result.schema.json", () => {
  const json = loadProtocolSchema("executor-result.schema.json");
  const props = json.properties as JsonSchema;

  it("declares required fields and strictness matching validateExecutorResult", () => {
    expect(json.type).toBe("object");
    expect(json.additionalProperties).toBe(false);
    expect(props.schemaVersion).toMatchObject({ const: 1 });
    expect(props.type).toMatchObject({ const: "executor-result" });
    expect(json.required).toEqual([
      "schemaVersion",
      "type",
      "runId",
      "dispatchId",
      "iteration",
      "status",
      "startedAt",
      "finishedAt",
      "baseSha",
      "resultSha",
      "executor",
      "verification",
      "blockers",
      "summary"
    ]);
  });

  it("matches terminal statuses COMPLETED/BLOCKED/NEEDS_HUMAN/FAILED", () => {
    expect(props.status.enum).toEqual(["COMPLETED", "BLOCKED", "NEEDS_HUMAN", "FAILED"]);
    for (const status of props.status.enum as string[]) {
      expect(
        isValid(validateExecutorResult, { ...makeExecutorResultFixture(), status }),
        `Zod should accept status ${status}`
      ).toBe(true);
    }
    expect(isValid(validateExecutorResult, { ...makeExecutorResultFixture(), status: "PAUSED" })).toBe(false);
  });

  it("matches correlation field bounds (runId/dispatchId/iteration)", () => {
    expect(props.runId).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(props.dispatchId).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(props.iteration).toMatchObject({ type: "integer", minimum: 1 });
    expect(isValid(validateExecutorResult, { ...makeExecutorResultFixture(), iteration: 0 })).toBe(false);
    // Gap note: startedAt/finishedAt use format:"date-time" on the JSON side versus
    // z.string().datetime() in Zod; see the dispatch createdAt gap note.
    expect(props.startedAt.format).toBe("date-time");
    expect(props.finishedAt.format).toBe("date-time");
  });

  it("expresses the same SHA-40 patterns for baseSha/resultSha (same uppercase drift)", () => {
    expect(props.baseSha.pattern).toBe("^[0-9a-f]{40}$");
    expect(props.resultSha.pattern).toBe("^[0-9a-f]{40}$");
    const jsonRe = new RegExp(props.resultSha.pattern as string);
    expect(jsonRe.test("c".repeat(41))).toBe(false);
    expect(
      isValid(validateExecutorResult, { ...makeExecutorResultFixture(), resultSha: "d".repeat(41) })
    ).toBe(false);
    // KNOWN DRIFT (same case-sensitivity gap as dispatch.baseSha): uppercase hex is
    // accepted by the Zod mirror but rejected by the JSON contract pattern.
    expect(jsonRe.test("C".repeat(40))).toBe(false);
    expect(
      isValid(validateExecutorResult, { ...makeExecutorResultFixture(), resultSha: "C".repeat(40) })
    ).toBe(true);
  });

  it("matches the executor cli/model/environment shape and enums", () => {
    const exec = props.executor as JsonSchema;
    expect(exec.additionalProperties).toBe(false);
    expect(exec.required).toEqual(["cli", "model", "environment"]);
    expect(exec.properties.cli).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(exec.properties.model).toMatchObject({ minLength: 1, maxLength: 300 });
    expect(exec.properties.environment.enum).toEqual(["windows", "wsl"]);
    expect(
      isValid(validateExecutorResult, {
        ...makeExecutorResultFixture(),
        executor: { cli: "cli", model: "m".repeat(300), environment: "wsl" } // boundary-positive
      })
    ).toBe(true);
    expect(
      isValid(validateExecutorResult, {
        ...makeExecutorResultFixture(),
        executor: { cli: "cli", model: "m", environment: "linux" } // wrong enum
      })
    ).toBe(false);
    expect(
      isValid(validateExecutorResult, {
        ...makeExecutorResultFixture(),
        executor: { cli: "cli", model: "m" } // missing environment
      })
    ).toBe(false);
  });

  it("matches verification/blockers array item shapes", () => {
    const ver = props.verification as JsonSchema;
    const blk = props.blockers as JsonSchema;
    // Neither side caps the outer array length.
    expect(ver.minItems).toBeUndefined();
    expect(ver.maxItems).toBeUndefined();
    expect(blk.minItems).toBeUndefined();
    expect(blk.maxItems).toBeUndefined();

    expect(ver.items.additionalProperties).toBe(false);
    expect(ver.items.required).toEqual(["name", "status", "summary"]);
    expect(ver.items.properties.status.enum).toEqual(["PASS", "FAIL", "NOT_RUN"]);
    expect(ver.items.properties.name).toMatchObject({ minLength: 1, maxLength: 300 });
    expect(ver.items.properties.summary).toMatchObject({ minLength: 1, maxLength: 2000 });

    expect(blk.items.additionalProperties).toBe(false);
    expect(blk.items.required).toEqual(["code", "summary"]);
    expect(blk.items.properties.code).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(blk.items.properties.summary).toMatchObject({ minLength: 1, maxLength: 2000 });
    // Optional evidence: string-or-null capped at 4000 on both sides.
    expect(blk.items.properties.evidence.type).toEqual(["string", "null"]);
    expect(blk.items.properties.evidence).toMatchObject({ maxLength: 4000 });

    const base = makeExecutorResultFixture();
    expect(
      isValid(validateExecutorResult, {
        ...base,
        verification: [
          ...(base.verification as unknown[]),
          { name: "v2", status: "NOT_RUN", summary: "skipped" }
        ]
      })
    ).toBe(true);
    expect(
      isValid(validateExecutorResult, {
        ...base,
        verification: [{ name: "v", status: "SKIPPED", summary: "x" }] // wrong enum
      })
    ).toBe(false);
    expect(
      isValid(validateExecutorResult, {
        ...base,
        blockers: [{ code: "c", summary: "s", evidence: null }]
      })
    ).toBe(true);
    expect(
      isValid(validateExecutorResult, {
        ...base,
        blockers: [{ code: "c", summary: "s", evidence: "e".repeat(4001) }] // over-length
      })
    ).toBe(false);
  });

  it("caps summary at 4000 characters on both sides", () => {
    expect(props.summary).toMatchObject({ minLength: 1, maxLength: 4000 });
    expect(isValid(validateExecutorResult, { ...makeExecutorResultFixture(), summary: "" })).toBe(false);
    expect(isValid(validateExecutorResult, { ...makeExecutorResultFixture(), summary: "s".repeat(4000) })).toBe(true);
  });
});

describe("round-trip guard: dispatch marker", () => {
  it("accepts the canonical valid fixture", () => {
    expect(isValid(validateDispatchMarker, makeDispatchFixture())).toBe(true);
  });
  it("rejects wrong const literal (type)", () => {
    expect(isValid(validateDispatchMarker, { ...makeDispatchFixture(), type: "mutation" })).toBe(false);
  });
  it("rejects missing required field (runId)", () => {
    expect(isValid(validateDispatchMarker, omit(makeDispatchFixture(), "runId"))).toBe(false);
  });
  it("rejects bad SHA format (baseSha)", () => {
    expect(isValid(validateDispatchMarker, { ...makeDispatchFixture(), baseSha: "not-a-sha" })).toBe(false);
  });
  it("rejects over-length string (goal > 1000)", () => {
    expect(isValid(validateDispatchMarker, { ...makeDispatchFixture(), goal: "g".repeat(1001) })).toBe(false);
  });
  it("rejects out-of-range iteration (0 < minimum 1)", () => {
    expect(isValid(validateDispatchMarker, { ...makeDispatchFixture(), iteration: 0 })).toBe(false);
  });
  it("accepts boundary-positive lengths honored on both sides", () => {
    expect(isValid(validateDispatchMarker, { ...makeDispatchFixture(), runId: "r".repeat(200) })).toBe(true);
  });
});

describe("round-trip guard: executor result", () => {
  it("accepts the canonical valid fixture", () => {
    expect(isValid(validateExecutorResult, makeExecutorResultFixture())).toBe(true);
  });
  it("rejects wrong enum status", () => {
    expect(isValid(validateExecutorResult, { ...makeExecutorResultFixture(), status: "DONE" })).toBe(false);
  });
  it("rejects missing required field (dispatchId)", () => {
    expect(isValid(validateExecutorResult, omit(makeExecutorResultFixture(), "dispatchId"))).toBe(false);
  });
  it("rejects over-length runId (> 200)", () => {
    expect(isValid(validateExecutorResult, { ...makeExecutorResultFixture(), runId: "r".repeat(201) })).toBe(false);
  });
  it("rejects unknown top-level properties", () => {
    expect(isValid(validateExecutorResult, { ...makeExecutorResultFixture(), extra: true })).toBe(false);
  });
});

describe("protocol schema <-> Zod conformance: sol-control.schema.json", () => {
  const json = loadProtocolSchema("sol-control.schema.json");
  const props = json.properties as JsonSchema;

  it("declares required fields and strictness matching validateSolControlMarker", () => {
    expect(json.type).toBe("object");
    expect(json.additionalProperties).toBe(false);
    expect(props.schemaVersion).toMatchObject({ const: 1 });
    expect(props.type).toMatchObject({ const: "sol-control" });
    expect(json.required).toEqual([
      "schemaVersion",
      "type",
      "runId",
      "controlId",
      "iteration",
      "createdAt",
      "decision",
      "relatedDispatchId",
      "summary"
    ]);
  });

  it("matches control decision enums", () => {
    expect(props.decision.enum).toEqual(["GOAL_COMPLETE", "BLOCKED", "NEEDS_HUMAN", "PAUSED"]);
    for (const decision of props.decision.enum as string[]) {
      expect(
        isValid(validateSolControlMarker, { ...makeSolControlFixture(), decision }),
        `Zod should accept decision ${decision}`
      ).toBe(true);
    }
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), decision: "RESUME" })).toBe(false);
  });

  it("matches correlation fields (controlId/runId caps, iteration floor of 0)", () => {
    expect(props.runId).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(props.controlId).toMatchObject({ minLength: 1, maxLength: 200 });
    // Sol controls may report at iteration 0, unlike dispatch/executor results (>= 1).
    expect(props.iteration).toMatchObject({ type: "integer", minimum: 0 });
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), iteration: -1 })).toBe(false);
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), iteration: 0 })).toBe(true);
  });

  it("treats relatedDispatchId as nullable with the same length bounds", () => {
    expect(props.relatedDispatchId.type).toEqual(["string", "null"]);
    expect(props.relatedDispatchId).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), relatedDispatchId: null })).toBe(true);
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), relatedDispatchId: 42 })).toBe(false);
    expect(
      isValid(validateSolControlMarker, { ...makeSolControlFixture(), relatedDispatchId: "d".repeat(201) })
    ).toBe(false);
    // KNOWN DRIFT (flagged for triage, intentionally not fixed): JSON lists
    // relatedDispatchId in `required` (key must be present, value may be null),
    // while the Zod chain is .nullable().optional(), so an absent key passes
    // runtime enforcement but would fail the published contract.
    expect(isValid(validateSolControlMarker, omit(makeSolControlFixture(), "relatedDispatchId"))).toBe(true);
  });
});

describe("round-trip guard: sol-control marker", () => {
  it("accepts the canonical valid fixture", () => {
    expect(isValid(validateSolControlMarker, makeSolControlFixture())).toBe(true);
  });
  it("rejects missing required field (summary)", () => {
    expect(isValid(validateSolControlMarker, omit(makeSolControlFixture(), "summary"))).toBe(false);
  });
  it("rejects empty-string controlId", () => {
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), controlId: "" })).toBe(false);
  });
  it("rejects over-length summary (> 4000)", () => {
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), summary: "s".repeat(4001) })).toBe(false);
  });
  it("rejects malformed createdAt (non ISO-8601)", () => {
    // Only obviously malformed values are asserted: exact date-time format
    // semantics differ between the two vocabularies (see gap notes above).
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), createdAt: "2026-01-15 10:30" })).toBe(false);
  });
  it("rejects unknown properties", () => {
    expect(isValid(validateSolControlMarker, { ...makeSolControlFixture(), extra: true })).toBe(false);
  });
});

describe("protocol schema coverage meta-guard", () => {
  it("covers every *.schema.json under schemas/protocol/", () => {
    const present = fs
      .readdirSync(PROTOCOL_SCHEMA_DIR)
      .filter((f) => f.endsWith(".schema.json"))
      .sort();
    expect(present.length).toBeGreaterThan(0);
    // Adding a future protocol schema without adding its conformance block fails here.
    expect(present).toEqual(COVERED_PROTOCOL_SCHEMAS);
  });
});

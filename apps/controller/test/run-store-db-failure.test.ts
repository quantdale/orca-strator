import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase } from "../src/db/database.js";
import { RunStore } from "../src/loop/run-store.js";

describe("RunStore DB failure is surfaced, not swallowed as IDLE (#11)", () => {
  it("throws when DB is closed instead of returning null/IDLE", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-db-fail-"));
    const dbCtx = initDatabase(path.join(tempDir, "test.sqlite"));
    const store = new RunStore(dbCtx.db);
    dbCtx.close();
    expect(() => store.get("any")).toThrow();
    expect(() => store.getActiveRun("repo")).toThrow();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

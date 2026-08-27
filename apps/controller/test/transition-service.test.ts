import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { OrchestrationTransitionService } from "../src/ownership/transition-service.js";

const REPO = "repo-trans-1";
const RUN = "run-trans-1";
const DISPATCH = "disp-trans-1";

describe("Change 028 OrchestrationTransitionService (D7/D8/D9)", () => {
  let dir: string;
  let ctx: DatabaseContext;
  let svc: OrchestrationTransitionService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-trans-"));
    ctx = initDatabase(path.join(dir, "t.sqlite"));
    // Synthetic protocol source table representing a dispatch/control marker.
    ctx.db
      .prepare(
        `INSERT INTO repositories
         (id, display_name, github_remote, local_path, environment, executor_cli,
          executor_model, sol_conversation_url, max_iterations, max_runtime_minutes,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, 'windows', 'codex', 'm', 'https://chatgpt.com/c/x',
                 20, 480, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run(REPO, "Trans", "https://github.com/x/y.git", "D:\\x");
    ctx.db.exec(
      `CREATE TABLE test_protocol_source (
         id TEXT PRIMARY KEY,
         status TEXT NOT NULL DEFAULT 'detected',
         run_id TEXT
       )`
    );
    ctx.db
      .prepare(
        `INSERT INTO test_protocol_source (id, status, run_id) VALUES (?, 'detected', ?)`
      )
      .run(DISPATCH, RUN);
    svc = new OrchestrationTransitionService(ctx.db);
  });

  afterEach(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function sourceStatus(): string {
    return (
      ctx.db
        .prepare(`SELECT status FROM test_protocol_source WHERE id=?`)
        .get(DISPATCH) as { status: string }
    ).status;
  }

  function consumeSource(): void {
    ctx.db
      .prepare(`UPDATE test_protocol_source SET status='consumed' WHERE id=?`)
      .run(DISPATCH);
  }

  it("D8: commits source consumption + run mutation + outbox in one transaction", async () => {
    const res = await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: DISPATCH,
      operation: "COMPLETE",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }) => {
        consumeSource();
        enqueueOutbox({
          effectKey: `sol-wake:${REPO}:${RUN}:${DISPATCH}`,
          repositoryId: REPO,
          runId: RUN,
          effectKind: "SUBMIT_SOL_WAKE",
          payloadJson: JSON.stringify({ resultStatus: "COMPLETED" })
        });
      }
    });
    expect(res.applied).toBe(true);
    expect(sourceStatus()).toBe("consumed");
    // Outbox row is durable after commit.
    const pending = svc.listPendingOutbox();
    expect(pending.length).toBe(1);
  });

  it("D8/F2: a thrown apply rolls back so a source is never consumed without its transition", async () => {
    await expect(
      svc.enqueueAndApply({
        sourceKind: "DISPATCH",
        sourceId: DISPATCH,
        operation: "COMPLETE",
        repositoryId: REPO,
        runId: RUN,
        apply: () => {
          consumeSource();
          // Simulate a crash mid-transaction (e.g. outbox write fails).
          throw new Error("simulated crash before commit");
        }
      })
    ).rejects.toThrow(/simulated crash/);
    // Rollback must leave the source unconsumed and no durable outbox.
    expect(sourceStatus()).toBe("detected");
    expect(svc.listPendingOutbox().length).toBe(0);
  });

  it("D7: duplicate (source_kind, source_id, operation) is idempotent (no double apply)", async () => {
    const first = await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: DISPATCH,
      operation: "COMPLETE",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }) => {
        consumeSource();
        enqueueOutbox({
          effectKey: `sol-wake:${REPO}:${RUN}:${DISPATCH}`,
          repositoryId: REPO,
          runId: RUN,
          effectKind: "SUBMIT_SOL_WAKE"
        });
      }
    });
    expect(first.applied).toBe(true);

    // A second caller (e.g. restart re-detecting the same completion) must be a no-op.
    const second = await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: DISPATCH,
      operation: "COMPLETE",
      repositoryId: REPO,
      runId: RUN,
      apply: () => {
        throw new Error("must not run on duplicate");
      }
    });
    expect(second.applied).toBe(false);
    expect(sourceStatus()).toBe("consumed");
  });

  it("D9: side effects are delivered only after commit and are replay-idempotent", async () => {
    await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: DISPATCH,
      operation: "COMPLETE",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }) => {
        consumeSource();
        enqueueOutbox({
          effectKey: `sol-wake:${REPO}:${RUN}:${DISPATCH}`,
          repositoryId: REPO,
          runId: RUN,
          effectKind: "SUBMIT_SOL_WAKE"
        });
      }
    });

    let delivered = 0;
    const deliverer = () => {
      delivered += 1;
    };
    await svc.replayOutbox(deliverer);
    expect(delivered).toBe(1);

    // A second replay must not re-deliver an already-DELIVERED effect.
    await svc.replayOutbox(deliverer);
    expect(delivered).toBe(1);
  });

  it("D9: startup replay delivers a PENDING outbox left by a crash before delivery", async () => {
    // Simulate the crash window: intent committed + outbox PENDING, but the
    // process died before replayOutbox ran.
    await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: DISPATCH,
      operation: "COMPLETE",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }) => {
        consumeSource();
        enqueueOutbox({
          effectKey: `sol-wake:${REPO}:${RUN}:${DISPATCH}`,
          repositoryId: REPO,
          runId: RUN,
          effectKind: "SUBMIT_SOL_WAKE"
        });
      }
    });
    // Forget in-memory state; only durable rows remain. Force the item back to
    // PENDING as a crash would leave it if delivery had not completed.
    const item = svc.listPendingOutbox()[0];
    ctx.db
      .prepare(`UPDATE orchestration_outbox SET state='PENDING' WHERE id=?`)
      .run(item.id);

    let delivered = 0;
    await svc.replayOutbox(() => {
      delivered += 1;
    });
    expect(delivered).toBe(1);
  });
});

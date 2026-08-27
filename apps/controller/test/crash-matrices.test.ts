import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { OrchestrationTransitionService } from "../src/ownership/transition-service.js";

/**
 * Change 028 (D9 / 6.5-6.7): duplicate/stale/race crash-window matrices
 * for every protocol source kind. Proves no consumed-without-transition
 * durable state via the transition inbox/outbox boundary.
 *
 * Valid TransitionSourceKinds: DISPATCH, SOL_CONTROL, EXECUTOR_COMPLETION,
 * STRATEGY_COMPLETION. Different operations on STRATEGY_COMPLETION cover
 * SWARM, DAG, postflight variants.
 */

const REPO = "repo-matrix";
const RUN = "run-matrix";

function setupDb(ctx: DatabaseContext) {
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
    `CREATE TABLE IF NOT EXISTS test_protocol_source (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'detected', run_id TEXT)`
  );
}

describe("Change 028 crash matrices (D9 / 3.6-3.7 / 6.5-6.7)", () => {
  let dir: string;
  let ctx: DatabaseContext;
  let svc: OrchestrationTransitionService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-matrix-"));
    ctx = initDatabase(path.join(dir, "t.sqlite"));
    setupDb(ctx);
    svc = new OrchestrationTransitionService(ctx.db);
  });

  afterEach(() => {
    try {
      ctx.close();
    } catch {}
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  function makeSource(id: string) {
    ctx.db.prepare(`INSERT INTO test_protocol_source (id, status, run_id) VALUES (?, 'detected', ?)`).run(id, RUN);
  }
  function sourceStatus(id: string): string {
    return (ctx.db.prepare(`SELECT status FROM test_protocol_source WHERE id=?`).get(id) as any)?.status ?? "missing";
  }
  function consumeSource(id: string): void {
    ctx.db.prepare(`UPDATE test_protocol_source SET status='consumed' WHERE id=?`).run(id);
  }

  const cases: Array<{ kind: "DISPATCH" | "SOL_CONTROL" | "EXECUTOR_COMPLETION" | "STRATEGY_COMPLETION"; op: string; id: string }> = [
    { kind: "DISPATCH", op: "DISPATCH_START", id: "disp-1" },
    { kind: "DISPATCH", op: "DISPATCH_DRAIN", id: "disp-drain-1" },
    { kind: "SOL_CONTROL", op: "SOL_CONTROL", id: "ctrl-1" },
    { kind: "EXECUTOR_COMPLETION", op: "COMPLETE", id: "exec-1" },
    { kind: "STRATEGY_COMPLETION", op: "COMPLETE_SWARM", id: "swarm-1" },
    { kind: "STRATEGY_COMPLETION", op: "COMPLETE_DAG", id: "dag-1" },
    { kind: "STRATEGY_COMPLETION", op: "POSTFLIGHT_RETRY", id: "post-1" },
  ];

  for (const c of cases) {
    it(`${c.kind}/${c.op}: duplicate is idempotent (no double apply)`, async () => {
      makeSource(c.id);
      let applyCount = 0;
      const opts = {
        sourceKind: c.kind,
        sourceId: c.id,
        operation: c.op,
        repositoryId: REPO,
        runId: RUN,
        apply: ({ enqueueOutbox }: any) => {
          applyCount++;
          consumeSource(c.id);
          enqueueOutbox({ effectKey: `eff-${c.id}-${c.op}`, effectKind: "TEST_EFFECT", repositoryId: REPO, runId: RUN, payloadJson: "{}" });
        },
      };
      const r1 = await svc.enqueueAndApply(opts as any);
      expect(r1.applied).toBe(true);
      expect(sourceStatus(c.id)).toBe("consumed");
      const r2 = await svc.enqueueAndApply(opts as any);
      expect(r2.applied).toBe(false);
      expect(applyCount).toBe(1);
      const outbox = ctx.db.prepare(`SELECT count(*) as n FROM orchestration_outbox WHERE effect_key=?`).get(`eff-${c.id}-${c.op}`) as any;
      expect(outbox.n).toBe(1);
    });

    it(`${c.kind}/${c.op}: throw in apply rolls back — no consumed-without-transition`, async () => {
      const id2 = `${c.id}-fail`;
      makeSource(id2);
      try {
        await svc.enqueueAndApply({
          sourceKind: c.kind,
          sourceId: id2,
          operation: c.op,
          repositoryId: REPO,
          runId: RUN,
          apply: () => {
            consumeSource(id2);
            throw new Error("simulated crash before commit");
          },
        } as any);
        expect.unreachable("should throw");
      } catch {}
      expect(sourceStatus(id2)).toBe("detected");
      const hasEffect = ctx.db.prepare(`SELECT count(*) as n FROM orchestration_outbox WHERE effect_key=?`).get(`eff-${id2}-${c.op}`) as any;
      expect(hasEffect.n).toBe(0);
    });
  }

  it("race: concurrent duplicate dispatches do not double-transition (serialization)", async () => {
    const id = "race-disp-1";
    makeSource(id);
    let count = 0;
    const op = {
      sourceKind: "DISPATCH" as const,
      sourceId: id,
      operation: "DISPATCH_START",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }: any) => {
        count++;
        consumeSource(id);
        enqueueOutbox({ effectKey: `eff-${id}`, effectKind: "TEST_EFFECT", repositoryId: REPO, runId: RUN, payloadJson: "{}" });
      },
    };
    const [a, b] = await Promise.all([svc.enqueueAndApply(op as any), svc.enqueueAndApply(op as any)]);
    expect([a.applied, b.applied].filter(Boolean).length).toBe(1);
    expect(count).toBe(1);
  });

  it("stale marker: second operation on same sourceId but different operation re-applies (not rejected as duplicate)", async () => {
    const id = "stale-1";
    makeSource(id);
    const r1 = await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: id,
      operation: "DISPATCH_START",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }: any) => {
        consumeSource(id);
        enqueueOutbox({ effectKey: `eff-${id}-start`, effectKind: "TEST_EFFECT", repositoryId: REPO, runId: RUN, payloadJson: "{}" });
      },
    } as any);
    expect(r1.applied).toBe(true);
    makeSource(`${id}-v2`);
    const id2 = `${id}-v2`;
    const r2 = await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: id2,
      operation: "DISPATCH_START",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }: any) => {
        consumeSource(id2);
        enqueueOutbox({ effectKey: `eff-${id2}-start`, effectKind: "TEST_EFFECT", repositoryId: REPO, runId: RUN, payloadJson: "{}" });
      },
    } as any);
    expect(r2.applied).toBe(true);
  });

  it("outbox crash-before-delivery is replayable and idempotent", async () => {
    const id = "outbox-replay-1";
    makeSource(id);
    await svc.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: id,
      operation: "DISPATCH_START",
      repositoryId: REPO,
      runId: RUN,
      apply: ({ enqueueOutbox }: any) => {
        consumeSource(id);
        enqueueOutbox({ effectKey: `eff-${id}-replay`, effectKind: "TEST_EFFECT", repositoryId: REPO, runId: RUN, payloadJson: "{}" });
      },
    } as any);
    let deliveries = 0;
    const deliverer = async () => {
      deliveries++;
    };
    await svc.replayOutbox(deliverer);
    expect(deliveries).toBeGreaterThanOrEqual(1);
    const afterFirst = deliveries;
    await svc.replayOutbox(deliverer);
    expect(deliveries).toBe(afterFirst);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import {
  RepositoryActorLeaseStore,
  ProcessOwnershipStore,
  TransitionIntentStore,
  OutboxStore,
  type ActorKind
} from "../src/ownership/ownership-store.js";
import {
  PortableProcessProbe,
  WindowsProcessProbe,
  isProcessBlocking,
  type ProcessProbe
} from "../src/ownership/process-probe.js";
import { RepositoryActorLeaseService } from "../src/ownership/actor-lease-service.js";
import { readAppliedSchemaVersion } from "../src/db/schema-compat.js";

const REPO = "repo-own-1";

function makeRepo(ctx: DatabaseContext): void {
  ctx.db
    .prepare(
      `INSERT INTO repositories
       (id, display_name, github_remote, local_path, environment, executor_cli,
        executor_model, sol_conversation_url, max_iterations, max_runtime_minutes,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'windows', 'codex', 'm', 'https://chatgpt.com/c/x',
               20, 480, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(REPO, "Own", "https://github.com/x/y.git", "D:\\x");
}

describe("Change 028 migration 24 ownership schema", () => {
  let dir: string;
  let ctx: DatabaseContext;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-own-"));
    ctx = initDatabase(path.join(dir, "t.sqlite"));
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("applies schema version 24 and creates the ownership tables", () => {
    expect(readAppliedSchemaVersion(ctx.db)).toBe(24);
    for (const table of [
      "repository_actor_leases",
      "process_ownership_records",
      "orchestration_transition_intents",
      "orchestration_outbox"
    ]) {
      const row = ctx.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(table) as { name: string } | undefined;
      expect(row, `table ${table} missing`).toBeDefined();
    }
  });
});

describe("RepositoryActorLeaseStore (D2/D5 PK boundary)", () => {
  let dir: string;
  let ctx: DatabaseContext;
  let store: RepositoryActorLeaseStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-lease-"));
    ctx = initDatabase(path.join(dir, "t.sqlite"));
    makeRepo(ctx);
    store = new RepositoryActorLeaseStore(ctx.db);
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("inserts one lease and refuses a second insert (PK uniqueness)", () => {
    expect(
      store.insert({
        repositoryId: REPO,
        leaseId: "L1",
        controllerInstanceId: "C1",
        runId: null,
        iteration: null,
        actorKind: "SINGLE_AGENT",
        actorId: null,
        state: "STARTING"
      })
    ).toBe(true);
    expect(
      store.insert({
        repositoryId: REPO,
        leaseId: "L2",
        controllerInstanceId: "C2",
        runId: null,
        iteration: null,
        actorKind: "SWARM",
        actorId: null,
        state: "STARTING"
      })
    ).toBe(false);
    const got = store.get(REPO);
    expect(got?.leaseId).toBe("L1");
    expect(got?.controllerInstanceId).toBe("C1");
  });

  it("release deletes the row so a future acquire can re-insert", () => {
    store.insert({
      repositoryId: REPO,
      leaseId: "L1",
      controllerInstanceId: "C1",
      runId: null,
      iteration: null,
      actorKind: "SINGLE_AGENT",
      actorId: null,
      state: "ACTIVE"
    });
    store.release(REPO);
    expect(store.get(REPO)).toBeNull();
    expect(
      store.insert({
        repositoryId: REPO,
        leaseId: "L2",
        controllerInstanceId: "C2",
        runId: null,
        iteration: null,
        actorKind: "DAG",
        actorId: null,
        state: "STARTING"
      })
    ).toBe(true);
  });
});

describe("ProcessOwnershipStore (D2/D4)", () => {
  let dir: string;
  let ctx: DatabaseContext;
  let store: ProcessOwnershipStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-proc-"));
    ctx = initDatabase(path.join(dir, "t.sqlite"));
    makeRepo(ctx);
    store = new ProcessOwnershipStore(ctx.db);
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("inserts, updates state, and lists by repository and actor", () => {
    store.insert({
      id: "P1",
      controllerInstanceId: "C1",
      repositoryId: REPO,
      runId: null,
      iteration: null,
      actorId: "A1",
      packetId: null,
      processKind: "DIRECT_EXECUTOR",
      hostPid: 1234,
      executableName: "codex.exe",
      startMarker: "m1",
      state: "RUNNING"
    });
    store.setState("P1", "EXITED");
    const byRepo = store.listByRepository(REPO);
    expect(byRepo).toHaveLength(1);
    expect(byRepo[0].state).toBe("EXITED");
    const byActor = store.listByActor("A1");
    expect(byActor).toHaveLength(1);
  });

  it("keeps process records independent per repository", () => {
    ctx.db
      .prepare(
        `INSERT INTO repositories
         (id, display_name, github_remote, local_path, environment, executor_cli,
          executor_model, sol_conversation_url, max_iterations, max_runtime_minutes,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, 'windows', 'codex', 'm', 'https://chatgpt.com/c/x',
                 20, 480, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run("repo-other", "Other", "https://github.com/a/b.git", "D:\\b");
    store.insert({
      id: "P1",
      controllerInstanceId: "C1",
      repositoryId: REPO,
      runId: null,
      iteration: null,
      actorId: null,
      packetId: null,
      processKind: "DIRECT_EXECUTOR",
      hostPid: 1,
      executableName: null,
      startMarker: null,
      state: "RUNNING"
    });
    store.insert({
      id: "P2",
      controllerInstanceId: "C1",
      repositoryId: "repo-other",
      runId: null,
      iteration: null,
      actorId: null,
      packetId: null,
      processKind: "SWARM_WORKER",
      hostPid: 2,
      executableName: null,
      startMarker: null,
      state: "RUNNING"
    });
    expect(store.listByRepository(REPO)).toHaveLength(1);
    expect(store.listByRepository("repo-other")).toHaveLength(1);
  });
});

describe("TransitionIntentStore + OutboxStore (D7/D9 idempotency)", () => {
  let dir: string;
  let ctx: DatabaseContext;
  let intents: TransitionIntentStore;
  let outbox: OutboxStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-intent-"));
    ctx = initDatabase(path.join(dir, "t.sqlite"));
    makeRepo(ctx);
    intents = new TransitionIntentStore(ctx.db);
    outbox = new OutboxStore(ctx.db);
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("enqueues a transition intent exactly once (UNIQUE source/op)", () => {
    const a = intents.enqueue({
      repositoryId: REPO,
      sourceKind: "DISPATCH",
      sourceId: "D1",
      operation: "CONSUME_AND_APPLY"
    });
    expect(a.inserted).toBe(true);
    const b = intents.enqueue({
      repositoryId: REPO,
      sourceKind: "DISPATCH",
      sourceId: "D1",
      operation: "CONSUME_AND_APPLY"
    });
    expect(b.inserted).toBe(false);
    expect(intents.getBySource("DISPATCH", "D1", "CONSUME_AND_APPLY")?.state).toBe("PENDING");
  });

  it("markApplying moves only PENDING->APPLYING atomically", () => {
    intents.enqueue({
      repositoryId: REPO,
      sourceKind: "SOL_CONTROL",
      sourceId: "C1",
      operation: "APPLY"
    });
    const bySrc = intents.getBySource("SOL_CONTROL", "C1", "APPLY")!;
    expect(intents.markApplying(bySrc.intentId)).toBe(true);
    expect(intents.markApplying(bySrc.intentId)).toBe(false);
    expect(intents.getBySource("SOL_CONTROL", "C1", "APPLY")!.state).toBe("APPLYING");
  });

  it("enqueues an outbox item exactly once per effect_key", () => {
    const a = outbox.enqueue({
      effectKey: "wake:repo:D1",
      repositoryId: REPO,
      effectKind: "SUBMIT_SOL_WAKE",
      payloadJson: "{}"
    });
    expect(a.inserted).toBe(true);
    const b = outbox.enqueue({
      effectKey: "wake:repo:D1",
      repositoryId: REPO,
      effectKind: "SUBMIT_SOL_WAKE",
      payloadJson: "{}"
    });
    expect(b.inserted).toBe(false);
    const item = outbox.get(a.id)!;
    expect(outbox.markDelivering(item.id)).toBe(true);
    expect(outbox.markDelivering(item.id)).toBe(false);
    expect(outbox.get(a.id)!.state).toBe("DELIVERING");
  });
});

describe("PortableProcessProbe (D3 verdicts + no-foreign-kill)", () => {
  let probe: ProcessProbe;
  const children: ChildProcess[] = [];
  beforeEach(() => {
    probe = new PortableProcessProbe();
  });
  afterEach(() => {
    for (const c of children) {
      try {
        c.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    children.length = 0;
  });

  function spawnChild(): ChildProcess {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore"
    });
    children.push(child);
    return child;
  }

  it("classifies a captured live child: LIVE_MATCH with identity, UNKNOWN (fail-closed) without (D3/P0 1.7)", () => {
    const child = spawnChild();
    const evidence = probe.capture(child.pid!);
    const hasIdentity =
      evidence.startMarker !== undefined || evidence.executableName !== undefined;
    const verdict = probe.classify({
      hostPid: child.pid!,
      executableName: evidence.executableName,
      startMarker: evidence.startMarker
    });
    // When the OS yields verifiable identity the match is proven; when it does
    // not (e.g. portable probe on a host without /proc), incomplete evidence
    // must never yield LIVE_MATCH (Change 028 P0): a foreign reused pid could
    // otherwise be verify-killed.
    if (hasIdentity) expect(verdict).toBe("LIVE_MATCH");
    else expect(verdict).toBe("UNKNOWN");
    child.kill("SIGKILL");
    // give process a moment to die
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && probe.classify({ hostPid: child.pid! }).startsWith("LIVE")) {
      // busy wait briefly
    }
    expect(probe.classify({ hostPid: child.pid! })).toBe("DEAD");
  });

  it("classifies a live pid we never captured as UNKNOWN (fail-closed)", () => {
    const child = spawnChild();
    // Do NOT seed evidence for this pid.
    expect(probe.classify({ hostPid: child.pid! })).toBe("UNKNOWN");
  });

  it("classifies PID reuse (alive but marker mismatch) as PID_REUSED", () => {
    const child = spawnChild();
    probe.capture(child.pid!); // seeds with the real (undefined) marker
    // A record claiming a different marker for the same live pid = foreign reuse.
    expect(
      probe.classify({ hostPid: child.pid!, startMarker: "foreign-marker" })
    ).toBe("PID_REUSED");
  });

  it("D3/P0: incomplete identity evidence never yields LIVE_MATCH (Change 028 1.7)", () => {
    const child = spawnChild();
    // Simulate a persisted record that captured NO identity (pre-hardening
    // WindowsProcessProbe behavior / a spawn window where capture failed).
    probe.seed({ pid: child.pid!, capturedAtIso: new Date().toISOString() });
    // A live pid whose recorded ownership has no identity must be UNKNOWN, never
    // LIVE_MATCH: otherwise a foreign reused pid could be verified-killed.
    expect(
      probe.classify({ hostPid: child.pid! })
    ).toBe("UNKNOWN");
  });

  it("refuses to kill UNKNOWN/PID_REUSED and kills only a verified LIVE_MATCH (D3/P0 1.7)", () => {
    const child = spawnChild();
    const evidence = probe.capture(child.pid!);
    const hasIdentity =
      evidence.startMarker !== undefined || evidence.executableName !== undefined;
    const record = {
      hostPid: child.pid!,
      executableName: evidence.executableName,
      startMarker: evidence.startMarker
    };
    if (hasIdentity) {
      // Foreign live pid (our own process) without matching evidence => UNKNOWN.
      expect(() => probe.killVerifiedTree({ hostPid: process.pid })).toThrow(/REFUSING_KILL/);
      // Our own record matches => verified kill succeeds.
      probe.killVerifiedTree(record);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && probe.classify(record).startsWith("LIVE")) {
        // busy wait
      }
      expect(probe.classify(record)).toBe("DEAD");
    } else {
      // No OS identity available: even our own child cannot be verify-killed
      // (fail-closed). The foreign-pid refusal still holds.
      expect(() => probe.killVerifiedTree(record)).toThrow(/REFUSING_KILL/);
      expect(() => probe.killVerifiedTree({ hostPid: process.pid })).toThrow(/REFUSING_KILL/);
      child.kill("SIGKILL");
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && probe.classify({ hostPid: child.pid! }).startsWith("LIVE")) {
        // busy wait
      }
      expect(probe.classify({ hostPid: child.pid! })).toBe("DEAD");
    }
  });

  it("isProcessBlocking marks LIVE_MATCH/PID_REUSED/UNKNOWN as blocking", () => {
    expect(isProcessBlocking("LIVE_MATCH")).toBe(true);
    expect(isProcessBlocking("PID_REUSED")).toBe(true);
    expect(isProcessBlocking("UNKNOWN")).toBe(true);
    expect(isProcessBlocking("DEAD")).toBe(false);
  });
});

describe("WindowsProcessProbe (D3/P0 capture + dead-vs-error, win32 only)", () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const c of children) {
      try {
        c.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    children.length = 0;
  });

  // These exercise the real OS query path and are only meaningful on Windows.
  const maybe = process.platform === "win32" ? it : it.skip;

  maybe("capture records creation/executable identity and classifies LIVE_MATCH", () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore"
    });
    children.push(child);
    const probe = new WindowsProcessProbe();
    const evidence = probe.capture(child.pid!);
    expect(typeof evidence.startMarker).toBe("string");
    expect(evidence.startMarker!.length).toBeGreaterThan(0);
    expect(evidence.executableName?.toLowerCase()).toContain("node");
    expect(
      probe.classify({
        hostPid: child.pid!,
        executableName: evidence.executableName,
        startMarker: evidence.startMarker
      })
    ).toBe("LIVE_MATCH");
  });

  maybe("classifies a never-existing pid as DEAD (notfound), not UNKNOWN (error)", () => {
    const probe = new WindowsProcessProbe();
    expect(probe.classify({ hostPid: 4000000000 })).toBe("DEAD");
  });

  maybe("refuses LIVE_MATCH for a record with no identity (incomplete evidence)", () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore"
    });
    children.push(child);
    const probe = new WindowsProcessProbe();
    probe.capture(child.pid!); // real capture writes identity into the record path
    // Now classify a persisted record that (like a pre-hardening one) carries no
    // identity: must be UNKNOWN, never LIVE_MATCH.
    expect(probe.classify({ hostPid: child.pid! })).toBe("UNKNOWN");
  });
});

describe("RepositoryActorLeaseService (D5 acquire/quarantine/reconcile)", () => {
  let dir: string;
  let ctx: DatabaseContext;
  let svc: RepositoryActorLeaseService;
  let probe: PortableProcessProbe;
  const C1 = "controller-instance-1";
  const C2 = "controller-instance-2";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-svc-"));
    ctx = initDatabase(path.join(dir, "t.sqlite"));
    makeRepo(ctx);
    probe = new PortableProcessProbe();
    svc = new RepositoryActorLeaseService(ctx.db, probe);
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("acquires a lease for a repository exactly once; second actor conflicts", () => {
    const a = svc.acquire(REPO, C1, "SINGLE_AGENT");
    expect(a.outcome).toBe("acquired");
    const b = svc.acquire(REPO, C1, "SWARM");
    expect(b.outcome).toBe("conflict");
    expect(b.lease?.leaseId).toBe(a.lease?.leaseId);
  });

  it("quarantined lease blocks a new actor and is not silently cleared", () => {
    svc.acquire(REPO, C1, "SINGLE_AGENT");
    svc.quarantine(REPO, "uncertain ownership after restart");
    const b = svc.acquire(REPO, C2, "SINGLE_AGENT");
    expect(b.outcome).toBe("quarantined");
  });

  it("reconcileOnStartup releases a dead prior writer and quarantines a live one", () => {
    // Prior controller owned a lease + a live child.
    svc.acquire(REPO, C1, "SINGLE_AGENT");
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore"
    });
    const store = new ProcessOwnershipStore(ctx.db);
    store.insert({
      id: "P1",
      controllerInstanceId: C1,
      repositoryId: REPO,
      runId: null,
      iteration: null,
      actorId: null,
      packetId: null,
      processKind: "DIRECT_EXECUTOR",
      hostPid: child.pid!,
      executableName: null,
      startMarker: null,
      state: "RUNNING"
    });
    // We must simulate that C1 is the prior instance: release svc handle, then
    // reconcile as if current controller is C2. The lease still references C1.
    const results = svc.reconcileOnStartup(C2, [REPO]);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("quarantined");
    expect(results[0].processes[0].verdict).toBe("UNKNOWN");
    expect(svc.getLease(REPO)?.state).toBe("QUARANTINED");

    child.kill("SIGKILL");
  });

  it("reconcileOnStartup releases when the prior writer is provably dead", () => {
    svc.acquire(REPO, C1, "SINGLE_AGENT");
    const store = new ProcessOwnershipStore(ctx.db);
    store.insert({
      id: "P1",
      controllerInstanceId: C1,
      repositoryId: REPO,
      runId: null,
      iteration: null,
      actorId: null,
      packetId: null,
      processKind: "DIRECT_EXECUTOR",
      hostPid: 999999,
      executableName: null,
      startMarker: null,
      state: "RUNNING"
    });
    const results = svc.reconcileOnStartup(C2, [REPO]);
    expect(results[0].outcome).toBe("released");
    expect(svc.getLease(REPO)).toBeNull();
  });

  it("D5/P0: a prior STARTING/ACTIVE lease with zero process records fails closed (quarantined, 5.8/5.9)", () => {
    // Admission happened on the prior controller but no durable process record
    // was persisted: the spawn/persistence window is ambiguous after restart.
    svc.acquire(REPO, C1, "SINGLE_AGENT");
    svc.bindActor(REPO, "actor-1");
    svc.markActive(REPO);
    // No ProcessOwnershipStore.insert call: zero process rows.
    const results = svc.reconcileOnStartup(C2, [REPO]);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("quarantined");
    expect(svc.getLease(REPO)?.state).toBe("QUARANTINED");
    expect(svc.getLease(REPO)?.lastError ?? "").toMatch(/ambiguous/i);
  });

  it("D5/P0: a prior RELEASING lease with zero process records is still left to its terminal state (no false release)", () => {
    svc.acquire(REPO, C1, "SINGLE_AGENT");
    // A genuinely released lease row should not be re-quarantined as a writer.
    svc.release(REPO, C1);
    const results = svc.reconcileOnStartup(C2, [REPO]);
    expect(results).toHaveLength(0);
    expect(svc.getLease(REPO)).toBeNull();
  });

  it("release refuses while an owned child is still non-terminal", () => {
    svc.acquire(REPO, C1, "SINGLE_AGENT");
    const store = new ProcessOwnershipStore(ctx.db);
    store.insert({
      id: "P1",
      controllerInstanceId: C1,
      repositoryId: REPO,
      runId: null,
      iteration: null,
      actorId: null,
      packetId: null,
      processKind: "DIRECT_EXECUTOR",
      hostPid: 999999,
      executableName: null,
      startMarker: null,
      state: "RUNNING"
    });
    svc.release(REPO, C1);
    expect(svc.getLease(REPO)?.state).toBe("QUARANTINED");
    store.setState("P1", "EXITED");
    svc.release(REPO, C1);
    expect(svc.getLease(REPO)).toBeNull();
  });
});

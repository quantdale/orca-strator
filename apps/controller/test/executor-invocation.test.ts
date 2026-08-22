import { describe, expect, it } from "vitest";
import {
  buildExecutorInvocation,
  resolveProfile,
} from "../src/executor/profiles.js";
import { WindowsPowerShellAdapter } from "../src/executor/adapters/windows-adapter.js";
import { EXECUTOR_SPAWN_STDIO } from "../src/executor/adapters/executor-adapter.js";

describe("executor invocation profiles (Change 022)", () => {
  it("codex profile grants a writable sandbox and keeps model/prompt user-owned", () => {
    const invocation = buildExecutorInvocation("codex", {
      cli: "codex",
      model: "gpt-test-model",
      prompt: "do the dispatch work",
    });
    // Verified against codex-cli 0.148.0 by real inference burn: without an
    // explicit sandbox the exec subcommand is read-only; workspace-write is
    // unusable on Windows (sandbox helper missing). Flags stay before the
    // positional prompt.
    expect(invocation.command).toBe("codex");
    expect(invocation.args).toEqual([
      "exec",
      "-s",
      "danger-full-access",
      "-m",
      "gpt-test-model",
      "--json",
      "do the dispatch work",
    ]);
  });

  it("kimi profile stays pinned to the verified non-interactive shape", () => {
    const invocation = buildExecutorInvocation("kimi", {
      cli: "kimi",
      model: "kimi-test-model",
      prompt: "do the dispatch work",
    });
    expect(invocation.command).toBe("kimi");
    expect(invocation.args).toEqual([
      "-m",
      "kimi-test-model",
      "-p",
      "do the dispatch work",
    ]);
  });

  it("generic profile stays pinned (model + positional prompt)", () => {
    const invocation = buildExecutorInvocation("generic", {
      cli: "custom-agent",
      model: "m1",
      prompt: "work",
    });
    expect(invocation.args).toEqual(["--model", "m1", "work"]);
  });

  it("resolveProfile still routes brand CLIs before the generic fallback", () => {
    expect(resolveProfile("C:/tools/kimi/bin/kimi.exe")).toBe("kimi");
    expect(resolveProfile("C:/Program Files/OpenAI/Codex/bin/codex.exe")).toBe(
      "codex",
    );
    expect(resolveProfile("opencode")).toBe("opencode");
    expect(resolveProfile("unknown-cli")).toBe("generic");
  });
});

describe("executor adapter stdio policy (Change 022)", () => {
  it("declares stdin-ignored, captured stdout/stderr stdio", () => {
    expect(EXECUTOR_SPAWN_STDIO).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("Windows adapter spawns children with no readable stdin writer", async () => {
    const adapter = new WindowsPowerShellAdapter();
    const child = adapter.spawn({
      command: process.execPath,
      args: ["-e", "process.stdout.write('ok'); process.exit(0)"],
      cwd: process.cwd(),
      env: {},
    });
    // The whole point of Change 022: no open stdin pipe the controller never
    // closes, while stdout/stderr remain captured for executor logs.
    expect(child.stdin).toBeNull();
    const stdout = await new Promise<string>((resolve, reject) => {
      let data = "";
      child.stdout!.on("data", (chunk) => (data += chunk.toString()));
      child.stdout!.on("end", () => resolve(data));
      child.on("error", reject);
    });
    expect(stdout).toBe("ok");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  });
});

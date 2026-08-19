import { describe, it, expect } from "vitest";
import {
  validateCreateRepository,
  validateUpdateRepository,
  validateMergedRepository,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RUNTIME_MINUTES,
  ValidationError,
  type RepositoryRecord
} from "../src/index.js";

describe("Shared Repository Contracts & Validation", () => {
  const validWindowsPayload = {
    displayName: "TabDock",
    githubRemote: "https://github.com/quantdale/tabdock.git",
    localPath: "D:\\Projects\\TabDock",
    environment: "windows" as const,
    executorCli: "codex",
    executorModel: "gpt-5.6-luna-xhigh",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
  };

  const validWslPayload = {
    displayName: "Nightwatch",
    githubRemote: "https://github.com/quantdale/nightwatch.git",
    localPath: "/home/dale/projects/nightwatch",
    environment: "wsl" as const,
    wslDistribution: "Ubuntu-24.04",
    executorCli: "kimi",
    executorModel: "deepseek-v4-flash",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
  };

  it("2.T1 validates a valid Windows config with default ceilings", () => {
    const validated = validateCreateRepository(validWindowsPayload);
    expect(validated.displayName).toBe("TabDock");
    expect(validated.environment).toBe("windows");
    expect(validated.wslDistribution).toBeNull();
    expect(validated.maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
    expect(validated.maxRuntimeMinutes).toBe(DEFAULT_MAX_RUNTIME_MINUTES);
  });

  it("2.T2 validates a valid WSL config with explicit distro", () => {
    const validated = validateCreateRepository(validWslPayload);
    expect(validated.displayName).toBe("Nightwatch");
    expect(validated.environment).toBe("wsl");
    expect(validated.wslDistribution).toBe("Ubuntu-24.04");
    expect(validated.localPath).toBe("/home/dale/projects/nightwatch");
  });

  it("2.T3 rejects WSL config when wslDistribution is missing or empty", () => {
    expect(() =>
      validateCreateRepository({
        ...validWslPayload,
        wslDistribution: ""
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateCreateRepository({
        ...validWslPayload,
        wslDistribution: undefined
      })
    ).toThrow(ValidationError);
  });

  it("2.T4 rejects empty required fields", () => {
    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        displayName: "   "
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        githubRemote: ""
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        localPath: ""
      })
    ).toThrow(ValidationError);
  });

  it("2.T5 rejects invalid ceilings (non-integer, <= 0)", () => {
    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        maxIterations: 0
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        maxIterations: -5
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        maxIterations: 1.5
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        maxRuntimeMinutes: 0
      })
    ).toThrow(ValidationError);
  });

  it("2.T6 applies ceiling defaults when omitted", () => {
    const validated = validateCreateRepository(validWindowsPayload);
    expect(validated.maxIterations).toBe(20);
    expect(validated.maxRuntimeMinutes).toBe(480);
  });

  it("2.T7 rejects invalid Sol conversation URLs", () => {
    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        solConversationUrl: "http://insecure.com/c/123"
      })
    ).toThrow(ValidationError);

    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        solConversationUrl: "https://example.com/c/123"
      })
    ).toThrow(ValidationError);
  });

  it("2.T8 revalidates merged result on patch", () => {
    const current: RepositoryRecord = {
      id: "repo-123",
      displayName: "Nightwatch",
      githubRemote: "https://github.com/quantdale/nightwatch.git",
      localPath: "/home/dale/projects/nightwatch",
      environment: "wsl",
      wslDistribution: "Ubuntu-24.04",
      executorCli: "kimi",
      executorModel: "deepseek-v4-flash",
      solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z"
    };

    const patch = validateUpdateRepository({
      executorModel: "deepseek-v4-pro",
      maxRuntimeMinutes: 600
    });

    const merged = validateMergedRepository(current, patch);
    expect(merged.id).toBe("repo-123");
    expect(merged.executorModel).toBe("deepseek-v4-pro");
    expect(merged.maxRuntimeMinutes).toBe(600);
    expect(merged.createdAt).toBe("2026-08-19T10:00:00.000Z");
    expect(new Date(merged.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(current.updatedAt).getTime()
    );

    const toWindowsPatch = validateUpdateRepository({
      environment: "windows"
    });
    const windowsMerged = validateMergedRepository(current, toWindowsPatch);
    expect(windowsMerged.environment).toBe("windows");
    expect(windowsMerged.wslDistribution).toBeNull();
  });

  it("2.T9 immutable identity/timestamps cannot be patched", () => {
    expect(() =>
      validateUpdateRepository({
        id: "new-id"
      } as any)
    ).toThrow(ValidationError);

    expect(() =>
      validateUpdateRepository({
        createdAt: "2026-01-01"
      } as any)
    ).toThrow(ValidationError);
  });

  it("2.T10 branch input is rejected under strict V1 strategy", () => {
    expect(() =>
      validateCreateRepository({
        ...validWindowsPayload,
        branch: "feat/test"
      } as any)
    ).toThrow(ValidationError);

    expect(() =>
      validateUpdateRepository({
        branch: "feat/test"
      } as any)
    ).toThrow(ValidationError);
  });
});

import { z } from "zod";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RUNTIME_MINUTES,
  type CreateRepositoryInput,
  type RepositoryRecord,
  type UpdateRepositoryInput
} from "./repository.js";
import { ValidationError, type FieldError } from "./errors.js";

export const CHATGPT_CONVERSATION_URL_REGEX = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/(?:c\/[a-zA-Z0-9_-]+|g\/[a-zA-Z0-9_-]+\/c\/[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+)(?:\?.*)?$/;

export const createRepositorySchema = z
  .object({
    displayName: z.string().trim().min(1, "Display name is required."),
    githubRemote: z.string().trim().min(1, "GitHub remote is required."),
    localPath: z.string().trim().min(1, "Local path is required."),
    environment: z.enum(["windows", "wsl"], {
      errorMap: () => ({ message: "Environment must be \"windows\" or \"wsl\"." })
    }),
    wslDistribution: z.string().trim().nullable().optional(),
    executorCli: z.string().trim().min(1, "Executor CLI is required."),
    executorModel: z.string().trim().min(1, "Executor model is required."),
    solConversationUrl: z
      .string()
      .trim()
      .regex(CHATGPT_CONVERSATION_URL_REGEX, "Sol conversation URL must be a valid ChatGPT conversation URL."),
    maxIterations: z
      .number({ invalid_type_error: "Max iterations must be a number." })
      .int("Max iterations must be an integer.")
      .positive("Max iterations must be greater than 0.")
      .optional()
      .default(DEFAULT_MAX_ITERATIONS),
    maxRuntimeMinutes: z
      .number({ invalid_type_error: "Max runtime minutes must be a number." })
      .int("Max runtime minutes must be an integer.")
      .positive("Max runtime minutes must be greater than 0.")
      .optional()
      .default(DEFAULT_MAX_RUNTIME_MINUTES)
  })
  .strict("Unknown fields are not allowed in repository configuration.")
  .superRefine((data, ctx) => {
    if (data.environment === "wsl") {
      if (!data.wslDistribution || data.wslDistribution.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WSL distribution is required when environment is wsl.",
          path: ["wslDistribution"]
        });
      }
    }
  });

export const updateRepositorySchema = z
  .object({
    displayName: z.string().trim().min(1, "Display name cannot be empty.").optional(),
    githubRemote: z.string().trim().min(1, "GitHub remote cannot be empty.").optional(),
    localPath: z.string().trim().min(1, "Local path cannot be empty.").optional(),
    environment: z.enum(["windows", "wsl"]).optional(),
    wslDistribution: z.string().trim().nullable().optional(),
    executorCli: z.string().trim().min(1, "Executor CLI cannot be empty.").optional(),
    executorModel: z.string().trim().min(1, "Executor model cannot be empty.").optional(),
    solConversationUrl: z
      .string()
      .trim()
      .regex(CHATGPT_CONVERSATION_URL_REGEX, "Sol conversation URL must be a valid ChatGPT conversation URL.")
      .optional(),
    maxIterations: z
      .number({ invalid_type_error: "Max iterations must be a number." })
      .int("Max iterations must be an integer.")
      .positive("Max iterations must be greater than 0.")
      .optional(),
    maxRuntimeMinutes: z
      .number({ invalid_type_error: "Max runtime minutes must be a number." })
      .int("Max runtime minutes must be an integer.")
      .positive("Max runtime minutes must be greater than 0.")
      .optional()
  })
  .strict("Unknown fields are not allowed in repository patch.")
  .refine((data) => Object.keys(data).length > 0, {
    message: "Patch body must contain at least one field to update."
  });

export function validateCreateRepository(input: unknown): CreateRepositoryInput & {
  maxIterations: number;
  maxRuntimeMinutes: number;
  wslDistribution: string | null;
} {
  const result = createRepositorySchema.safeParse(input);
  if (!result.success) {
    const details: FieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message
    }));
    throw new ValidationError("Repository configuration is invalid.", details);
  }
  const data = result.data;
  return {
    ...data,
    wslDistribution: data.environment === "windows" ? null : (data.wslDistribution ?? null)
  };
}

export function validateUpdateRepository(input: unknown): UpdateRepositoryInput {
  const result = updateRepositorySchema.safeParse(input);
  if (!result.success) {
    const details: FieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message
    }));
    throw new ValidationError("Repository patch is invalid.", details);
  }
  return result.data;
}

export function validateMergedRepository(
  current: RepositoryRecord,
  patch: UpdateRepositoryInput
): RepositoryRecord {
  const mergedEnvironment = patch.environment ?? current.environment;
  let mergedWslDistribution: string | null;

  if (mergedEnvironment === "windows") {
    mergedWslDistribution = null;
  } else {
    mergedWslDistribution = patch.wslDistribution !== undefined ? patch.wslDistribution : current.wslDistribution;
  }

  const merged = {
    displayName: patch.displayName ?? current.displayName,
    githubRemote: patch.githubRemote ?? current.githubRemote,
    localPath: patch.localPath ?? current.localPath,
    environment: mergedEnvironment,
    wslDistribution: mergedWslDistribution,
    executorCli: patch.executorCli ?? current.executorCli,
    executorModel: patch.executorModel ?? current.executorModel,
    solConversationUrl: patch.solConversationUrl ?? current.solConversationUrl,
    maxIterations: patch.maxIterations ?? current.maxIterations,
    maxRuntimeMinutes: patch.maxRuntimeMinutes ?? current.maxRuntimeMinutes
  };

  const validated = validateCreateRepository(merged);

  return {
    id: current.id,
    ...validated,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  };
}

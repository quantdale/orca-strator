import { z } from "zod";
import type { RepositoryRecord } from "./repository.js";

export interface RoleModelRule {
  role: string;
  executorCli: string;
  model: string;
  provider: string | null;
  description: string | null;
}

export interface RoleModelPolicy {
  schemaVersion: 1;
  repositoryId: string;
  rules: RoleModelRule[];
  updatedAt: string;
}

export interface RoleModelResolution {
  role: string;
  executorCli: string;
  model: string;
  provider: string | null;
  source: "REPOSITORY_DEFAULT" | "EXPLICIT_RULE";
  rule: RoleModelRule | null;
}

export const roleModelRuleSchema = z.object({
  role: z.string().trim().min(1).max(100).refine((role) => role.toUpperCase() !== "PRIMARY", "PRIMARY is always the repository configuration"),
  executorCli: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(300),
  provider: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional()
}).strict();

export const roleModelPolicySchema = z.object({
  schemaVersion: z.literal(1),
  repositoryId: z.string().trim().min(1).max(200),
  rules: z.array(roleModelRuleSchema).max(50),
  updatedAt: z.string().datetime()
}).strict().superRefine((policy, context) => {
  const roles = policy.rules.map((rule) => rule.role.toUpperCase());
  if (new Set(roles).size !== roles.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["rules"], message: "role rules must be unique" });
});

export function repositoryDefaultResolution(repository: RepositoryRecord, role: string): RoleModelResolution {
  return {
    role,
    executorCli: repository.executorCli,
    model: repository.executorModel,
    provider: null,
    source: "REPOSITORY_DEFAULT",
    rule: null
  };
}

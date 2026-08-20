import { z } from "zod";

export type PermissionAction =
  | "REPOSITORY_FILE_READ"
  | "REPOSITORY_FILE_WRITE"
  | "OUTSIDE_REPOSITORY_FILESYSTEM"
  | "ENVIRONMENT_SECRETS_READ"
  | "NETWORK_ACCESS"
  | "GIT_COMMIT"
  | "GIT_PUSH_MAIN"
  | "GIT_FORCE_PUSH"
  | "BRANCH_CREATE_DELETE"
  | "DEPENDENCY_INSTALL"
  | "SYSTEM_PACKAGE_INSTALL"
  | "SHELL_COMMAND"
  | "GITHUB_MUTATION"
  | "EXTERNAL_SERVICE_WRITE";

export type PermissionOutcome = "ALLOW" | "ALLOW_ONCE" | "ASK" | "DENY";
export type PermissionPreset = "CONSERVATIVE" | "BALANCED" | "UNATTENDED" | "CUSTOM";
export type PermissionEnforcement = "NATIVE_EXECUTOR" | "ORCA_ENFORCED" | "ADVISORY_ONLY" | "UNSUPPORTED";

export interface PermissionRule {
  action: PermissionAction;
  outcome: PermissionOutcome;
}

export interface AutonomyPermissionPolicy {
  schemaVersion: 1;
  repositoryId: string;
  preset: PermissionPreset;
  rules: PermissionRule[];
  updatedAt: string;
}

export interface PermissionDecision {
  id: string;
  repositoryId: string;
  runId: string | null;
  iteration: number | null;
  action: PermissionAction;
  outcome: PermissionOutcome;
  enforcement: PermissionEnforcement;
  rationale: string;
  actionable: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PermissionEvaluation {
  action: PermissionAction;
  outcome: PermissionOutcome;
  enforcement: PermissionEnforcement;
  rationale: string;
  actionable: boolean;
  decision: PermissionDecision;
}

const permissionActions: PermissionAction[] = [
  "REPOSITORY_FILE_READ", "REPOSITORY_FILE_WRITE", "OUTSIDE_REPOSITORY_FILESYSTEM",
  "ENVIRONMENT_SECRETS_READ", "NETWORK_ACCESS", "GIT_COMMIT", "GIT_PUSH_MAIN",
  "GIT_FORCE_PUSH", "BRANCH_CREATE_DELETE", "DEPENDENCY_INSTALL", "SYSTEM_PACKAGE_INSTALL",
  "SHELL_COMMAND", "GITHUB_MUTATION", "EXTERNAL_SERVICE_WRITE"
];

export const permissionActionSchema = z.enum(permissionActions as [PermissionAction, ...PermissionAction[]]);
export const permissionRuleSchema = z.object({
  action: permissionActionSchema,
  outcome: z.enum(["ALLOW", "ALLOW_ONCE", "ASK", "DENY"])
}).strict();
export const autonomyPermissionPolicySchema = z.object({
  schemaVersion: z.literal(1),
  repositoryId: z.string().min(1),
  preset: z.enum(["CONSERVATIVE", "BALANCED", "UNATTENDED", "CUSTOM"]),
  rules: z.array(permissionRuleSchema),
  updatedAt: z.string().datetime()
}).strict();

export function createPermissionPreset(
  repositoryId: string,
  preset: Exclude<PermissionPreset, "CUSTOM"> = "BALANCED",
  now = new Date().toISOString()
): AutonomyPermissionPolicy {
  const outcomeByPreset: Record<Exclude<PermissionPreset, "CUSTOM">, PermissionOutcome> = {
    CONSERVATIVE: "ASK",
    BALANCED: "ALLOW",
    UNATTENDED: "ALLOW"
  };
  const common = outcomeByPreset[preset];
  const rules: PermissionRule[] = permissionActions.map((action) => ({ action, outcome: common }));

  for (const action of ["REPOSITORY_FILE_READ", "GIT_COMMIT"] as PermissionAction[]) {
    const rule = rules.find((candidate) => candidate.action === action);
    if (rule) rule.outcome = "ALLOW";
  }
  for (const action of [
    "OUTSIDE_REPOSITORY_FILESYSTEM", "ENVIRONMENT_SECRETS_READ", "GIT_FORCE_PUSH",
    "BRANCH_CREATE_DELETE", "SYSTEM_PACKAGE_INSTALL"
  ] as PermissionAction[]) {
    const rule = rules.find((candidate) => candidate.action === action);
    if (rule) rule.outcome = "DENY";
  }
  return { schemaVersion: 1, repositoryId, preset, rules, updatedAt: now };
}

export function getPermissionRule(policy: AutonomyPermissionPolicy, action: PermissionAction): PermissionRule {
  const absolute = createPermissionPreset(policy.repositoryId, "BALANCED").rules.find((rule) => rule.action === action)!;
  const selected = policy.rules.find((rule) => rule.action === action);
  if (["GIT_FORCE_PUSH", "OUTSIDE_REPOSITORY_FILESYSTEM", "ENVIRONMENT_SECRETS_READ"].includes(action)) {
    return { action, outcome: "DENY" };
  }
  return selected ?? absolute;
}


import { roleModelPolicySchema, repositoryDefaultResolution, type RepositoryRecord, type RoleModelPolicy, type RoleModelResolution } from "@orca/shared";
import type { RoleModelPolicyStore } from "./role-model-policy-store.js";

export class RoleModelPolicyService {
  constructor(private readonly store: RoleModelPolicyStore) {}

  get(repositoryId: string): RoleModelPolicy {
    return this.store.get(repositoryId) ?? { schemaVersion: 1, repositoryId, rules: [], updatedAt: new Date(0).toISOString() };
  }

  set(repositoryId: string, input: unknown): RoleModelPolicy {
    const parsed = roleModelPolicySchema.parse(input);
    const policy: RoleModelPolicy = {
      ...parsed,
      rules: parsed.rules.map((rule) => ({
        ...rule,
        provider: rule.provider ?? null,
        description: rule.description ?? null
      }))
    };
    if (policy.repositoryId !== repositoryId) throw new Error("Role/model policy repositoryId does not match the route repository.");
    return this.store.save(policy);
  }

  resolve(repository: RepositoryRecord, role = "PRIMARY"): RoleModelResolution {
    const normalizedRole = role.trim();
    if (!normalizedRole || normalizedRole.toUpperCase() === "PRIMARY") return repositoryDefaultResolution(repository, "PRIMARY");
    const rule = this.get(repository.id).rules.find((candidate) => candidate.role.toUpperCase() === normalizedRole.toUpperCase());
    if (!rule) return repositoryDefaultResolution(repository, normalizedRole);
    return { role: normalizedRole, executorCli: rule.executorCli, model: rule.model, provider: rule.provider, source: "EXPLICIT_RULE", rule };
  }
}

import type { FastifyPluginAsync } from "fastify";
import {
  capabilityProbeRequestSchema,
  permissionActionSchema,
  type AutonomyPermissionPolicy,
  type ExecutorCapabilitySnapshot,
  type PermissionDecision,
  type PermissionEvaluation,
  type PhaseBudgetPolicy
} from "@orca/shared";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { CapabilityProbeService } from "../../executor/capability-probe-service.js";
import type { PermissionPolicyService } from "../../permissions/permission-policy-service.js";
import type { RunPolicyStore } from "../../loop/run-policy-store.js";
import type { RunStore } from "../../loop/run-store.js";

export const operationalIntelligenceRoutes = (
  repositoryService: RepositoryService,
  capabilityService: CapabilityProbeService,
  permissionService: PermissionPolicyService,
  runPolicyStore: RunPolicyStore,
  runStore: RunStore
): FastifyPluginAsync => async (fastify) => {
  fastify.get<{ Params: { id: string }; Reply: { capability: ExecutorCapabilitySnapshot | null; history: unknown[] } }>(
    "/api/repositories/:id/executor/capabilities",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      const latest = capabilityService.latest(request.params.id);
      return { capability: latest?.snapshot ?? null, history: capabilityService.history(request.params.id) };
    }
  );

  fastify.post<{ Params: { id: string }; Body: unknown; Reply: { capability: ExecutorCapabilitySnapshot } }>(
    "/api/repositories/:id/executor/probe",
    async (request) => {
      const repository = repositoryService.getRepository(request.params.id);
      const body = capabilityProbeRequestSchema.parse(request.body ?? {});
      const result = await capabilityService.probe(repository, body);
      return { capability: result.snapshot };
    }
  );

  fastify.get<{ Params: { id: string }; Reply: { policy: PhaseBudgetPolicy | null } }>(
    "/api/repositories/:id/phase-policy",
    async (request) => {
      const repository = repositoryService.getRepository(request.params.id);
      const run = runStore.getLatestRun(repository.id);
      return { policy: run ? runPolicyStore.get(run.id) : null };
    }
  );

  fastify.get<{ Params: { id: string }; Reply: { policy: AutonomyPermissionPolicy; decisions: PermissionDecision[] } }>(
    "/api/repositories/:id/permissions",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      return {
        policy: permissionService.getPolicy(request.params.id),
        decisions: permissionService.listDecisions(request.params.id)
      };
    }
  );

  fastify.put<{ Params: { id: string }; Body: unknown; Reply: { policy: AutonomyPermissionPolicy } }>(
    "/api/repositories/:id/permissions",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      return { policy: permissionService.setPolicy(request.params.id, request.body ?? {}) };
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: { action: string; runId?: string | null; iteration?: number | null };
    Reply: { evaluation: PermissionEvaluation };
  }>(
    "/api/repositories/:id/permissions/check",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      const action = permissionActionSchema.parse(request.body?.action);
      return {
        evaluation: permissionService.evaluate({
          repositoryId: request.params.id,
          action,
          runId: request.body?.runId,
          iteration: request.body?.iteration
        })
      };
    }
  );
};

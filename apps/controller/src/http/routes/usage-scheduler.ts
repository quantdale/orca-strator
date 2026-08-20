import type { FastifyPluginAsync } from "fastify";
import { schedulerAdmissionRequestSchema, schedulerPolicySchema, type RoleModelPolicy, type RoleModelResolution, type SchedulerDecision, type SchedulerPolicy, type UsageMetric, type UsageSummary } from "@orca/shared";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { UsageTelemetryService } from "../../usage/usage-telemetry-service.js";
import type { SchedulerService } from "../../scheduler/scheduler-service.js";
import type { RoleModelPolicyService } from "../../scheduler/role-model-policy-service.js";

export const usageSchedulerRoutes = (
  repositoryService: RepositoryService,
  usageService: UsageTelemetryService,
  schedulerService: SchedulerService,
  roleModelService: RoleModelPolicyService
): FastifyPluginAsync => async (fastify) => {
  fastify.get<{ Params: { id: string }; Querystring: { limit?: number }; Reply: { metrics: UsageMetric[]; summary: UsageSummary } }>(
    "/api/repositories/:id/usage",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      const metrics = usageService.listByRepository(request.params.id, request.query.limit ?? 500);
      return { metrics, summary: usageService.summarize(metrics) };
    }
  );

  fastify.get<{ Params: { id: string; runId: string }; Reply: { metrics: UsageMetric[]; summary: UsageSummary } }>(
    "/api/repositories/:id/campaigns/:runId/usage",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      const metrics = usageService.listByRun(request.params.runId).filter((metric) => metric.repositoryId === request.params.id);
      return { metrics, summary: usageService.summarize(metrics) };
    }
  );

  fastify.get<{ Reply: { policy: SchedulerPolicy } }>(
    "/api/scheduler/policy",
    async () => ({ policy: schedulerService.getPolicy() })
  );

  fastify.put<{ Body: unknown; Reply: { policy: SchedulerPolicy } }>(
    "/api/scheduler/policy",
    async (request) => {
      const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
      const policy = schedulerPolicySchema.parse({ ...body, updatedAt: body.updatedAt ?? new Date().toISOString() });
      return { policy: schedulerService.setPolicy(policy) };
    }
  );

  fastify.get<{ Querystring: { limit?: number }; Reply: { decisions: SchedulerDecision[] } }>(
    "/api/scheduler/decisions",
    async (request) => ({ decisions: schedulerService.listDecisions(request.query.limit ?? 200) })
  );

  fastify.post<{ Body: unknown; Reply: { decision: SchedulerDecision } }>(
    "/api/scheduler/admission",
    async (request) => {
      const body = schedulerAdmissionRequestSchema.parse(request.body);
      repositoryService.getRepository(body.repositoryId);
      return { decision: schedulerService.admit(body) };
    }
  );

  fastify.post<{ Body: { requestId: string }; Reply: { decision: SchedulerDecision | null } }>(
    "/api/scheduler/release",
    async (request) => ({ decision: schedulerService.release(request.body?.requestId) })
  );

  fastify.post<{ Body?: { activeRequestIds?: string[] }; Reply: { decisions: SchedulerDecision[] } }>(
    "/api/scheduler/recover",
    async (request) => ({ decisions: schedulerService.recover(request.body?.activeRequestIds ?? []) })
  );

  fastify.get<{ Params: { id: string }; Reply: { policy: RoleModelPolicy } }>(
    "/api/repositories/:id/role-model-policy",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      return { policy: roleModelService.get(request.params.id) };
    }
  );

  fastify.put<{ Params: { id: string }; Body: unknown; Reply: { policy: RoleModelPolicy } }>(
    "/api/repositories/:id/role-model-policy",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
      return {
        policy: roleModelService.set(request.params.id, {
          ...body,
          repositoryId: request.params.id,
          updatedAt: body.updatedAt ?? new Date().toISOString()
        })
      };
    }
  );

  fastify.post<{ Params: { id: string }; Body: { role?: string }; Reply: { resolution: RoleModelResolution } }>(
    "/api/repositories/:id/role-model-policy/resolve",
    async (request) => {
      const repository = repositoryService.getRepository(request.params.id);
      return { resolution: roleModelService.resolve(repository, request.body?.role ?? "PRIMARY") };
    }
  );
};

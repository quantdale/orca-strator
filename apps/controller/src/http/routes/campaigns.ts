import type { FastifyPluginAsync } from "fastify";
import { DomainError, ValidationError } from "@orca/shared";
import type { CampaignDetail, CampaignIterationSummary, CampaignSummary, CampaignTraceEvent } from "@orca/shared";
import type { CampaignLedgerService } from "../../ledger/campaign-ledger-service.js";
import type { RepositoryService } from "../../repositories/repository-service.js";

export const campaignRoutes = (
  ledger: CampaignLedgerService,
  repositoryService: RepositoryService
): FastifyPluginAsync => async (fastify) => {
  fastify.get<{ Params: { id: string }; Querystring: { limit?: number }; Reply: { campaigns: CampaignSummary[] } }>(
    "/api/repositories/:id/campaigns",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      return { campaigns: ledger.list(request.params.id, request.query.limit ?? 50) };
    }
  );

  fastify.get<{ Params: { id: string; runId: string }; Reply: { campaign: CampaignDetail } }>(
    "/api/repositories/:id/campaigns/:runId",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      const campaign = ledger.getDetail(request.params.id, request.params.runId);
      if (!campaign) throw new DomainError("REPOSITORY_NOT_FOUND", "Campaign not found", 404);
      return { campaign };
    }
  );

  fastify.get<{ Params: { id: string; runId: string; iteration: string }; Reply: { iteration: CampaignIterationSummary } }>(
    "/api/repositories/:id/campaigns/:runId/iterations/:iteration",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      const iteration = Number(request.params.iteration);
      if (!Number.isInteger(iteration) || iteration < 1)
        throw new ValidationError("Iteration must be a positive integer");
      const result = ledger.getIteration(request.params.id, request.params.runId, iteration);
      if (!result) throw new DomainError("REPOSITORY_NOT_FOUND", "Campaign not found", 404);
      return { iteration: result };
    }
  );

  fastify.get<{ Params: { id: string; runId: string }; Querystring: { limit?: number }; Reply: { timeline: CampaignTraceEvent[] } }>(
    "/api/repositories/:id/campaigns/:runId/timeline",
    async (request) => {
      repositoryService.getRepository(request.params.id);
      return { timeline: ledger.getTimeline(request.params.id, request.params.runId, request.query.limit ?? 1000) };
    }
  );
};

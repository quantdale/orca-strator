import type { FastifyPluginAsync } from "fastify";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { RunStore } from "../../loop/run-store.js";
import type { WorkPacketCreateInput, WorkPacketService } from "../../packets/work-packet-service.js";
import type { WorkPacketStore } from "../../packets/work-packet-store.js";
import type { WorktreeIsolationService } from "../../packets/worktree-isolation-service.js";
import type { IntegrationService } from "../../packets/integration-service.js";

export const workPacketRoutes = (
  repositoryService: RepositoryService,
  runStore: RunStore,
  packetService: WorkPacketService,
  worktreeService: WorktreeIsolationService,
  integrationService: IntegrationService,
  packetStore: WorkPacketStore
): FastifyPluginAsync => async (fastify) => {
  const getRun = (repositoryId: string, runId: string) => {
    const repository = repositoryService.getRepository(repositoryId);
    const run = runStore.get(runId);
    if (!run || run.repositoryId !== repository.id) throw new Error("Campaign not found for repository.");
    return { repository, run };
  };

  fastify.get<{ Params: { id: string; runId: string } }>(
    "/api/repositories/:id/campaigns/:runId/packets",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      return { packets: packetService.list(run.id), results: packetService.listResults(run.id) };
    }
  );

  fastify.post<{ Params: { id: string; runId: string }; Body: WorkPacketCreateInput }>(
    "/api/repositories/:id/campaigns/:runId/packets",
    async (request, reply) => {
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const packet = packetService.create(repository, run, request.body);
      return reply.status(201).send({ packet });
    }
  );

  fastify.post<{ Params: { id: string; runId: string; packetId: string }; Body: unknown }>(
    "/api/repositories/:id/campaigns/:runId/packets/:packetId/result",
    async (request) => {
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const packet = packetService.get(request.params.packetId);
      if (!packet || packet.runId !== run.id) throw new Error("Work packet not found for campaign.");
      return { result: packetService.recordResult(repository, packet, request.body) };
    }
  );

  fastify.post<{ Params: { id: string; runId: string; packetId: string }; Reply: { worktree: unknown } }>(
    "/api/repositories/:id/campaigns/:runId/packets/:packetId/worktree",
    async (request) => {
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const packet = packetService.get(request.params.packetId);
      if (!packet || packet.runId !== run.id) throw new Error("Work packet not found for campaign.");
      return { worktree: await worktreeService.allocate(repository, packet) };
    }
  );

  fastify.post<{ Params: { id: string; runId: string; packetId: string }; Body: { worktreeId?: string } }>(
    "/api/repositories/:id/campaigns/:runId/packets/:packetId/worktree/release",
    async (request) => {
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const packet = packetService.get(request.params.packetId);
      if (!packet || packet.runId !== run.id) throw new Error("Work packet not found for campaign.");
      const worktree = packetStore.getWorktreeByPacket(packet.packetId);
      const worktreeId = request.body?.worktreeId ?? worktree?.worktreeId;
      if (!worktreeId) throw new Error("No worktree exists for packet.");
      return { worktree: await worktreeService.release(repository, worktreeId) };
    }
  );

  fastify.get<{ Params: { id: string; runId: string } }>(
    "/api/repositories/:id/campaigns/:runId/worktrees",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      return { worktrees: worktreeService.list(request.params.id).filter((record) => record.runId === run.id) };
    }
  );

  fastify.post<{ Params: { id: string; runId: string } }>(
    "/api/repositories/:id/campaigns/:runId/worktrees/recover",
    async (request) => {
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const worktrees = (await worktreeService.recover(repository)).filter((record) => record.runId === run.id);
      return { worktrees };
    }
  );

  fastify.post<{ Params: { id: string; runId: string }; Body: { iteration?: number; results?: unknown[] } }>(
    "/api/repositories/:id/campaigns/:runId/packets/integrate",
    async (request) => {
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const iteration = request.body?.iteration ?? run.currentIteration;
      for (const input of request.body?.results ?? []) {
        const packetId = input && typeof input === "object" && "packetId" in input ? String((input as { packetId: unknown }).packetId) : "";
        const packet = packetService.get(packetId);
        if (!packet || packet.runId !== run.id || packet.iteration !== iteration) throw new Error("Integration result packet correlation is invalid.");
        packetService.recordResult(repository, packet, input);
      }
      const packets = packetService.list(run.id).filter((packet) => packet.iteration === iteration);
      const results = packetService.listResults(run.id).filter((result) => result.iteration === iteration);
      return { report: await integrationService.integrate(repository, run.id, iteration, packets, results) };
    }
  );

  fastify.get<{ Params: { id: string; runId: string } }>(
    "/api/repositories/:id/campaigns/:runId/integrations",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      return { reports: packetStore.listIntegrations(run.id) };
    }
  );
};

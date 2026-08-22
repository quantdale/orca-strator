import type {
  HealthResponse,
  RepositoryListResponse,
  RepositoryResponse,
  CreateRepositoryInput,
  UpdateRepositoryInput,
  ApiErrorEnvelope,
  FieldError,
  CampaignSummary,
  CampaignDetail,
  ExecutorCapabilitySnapshot,
  PhaseBudgetPolicy,
  AutonomyPermissionPolicy,
  PermissionDecision,
  PermissionAction,
  PermissionEvaluation,
  UsageMetric,
  UsageSummary,
  SchedulerDecision,
  SchedulerPolicy,
  RoleModelPolicy,
  RoleModelResolution,
  BrowserStatus,
  AuthReadinessReport,
  SolWakeRecord,
} from "@orca/shared";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: FieldError[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorData: ApiErrorEnvelope | null = null;
    try {
      errorData = await res.json();
    } catch {
      // Body not JSON
    }

    if (errorData?.error) {
      throw new ApiError(
        errorData.error.code,
        errorData.error.message,
        res.status,
        errorData.error.details,
      );
    }

    throw new ApiError(
      "UNKNOWN_ERROR",
      `HTTP error ${res.status}: ${res.statusText}`,
      res.status,
    );
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}

/** Payload of GET /api/browser/status (`browser` field), mirroring shared BrowserStatus. */
export type BrowserStatusView = BrowserStatus;

/** Payload of GET /api/system/provisioning (`chromium` field). */
export interface ProvisioningStatusView {
  status: "missing" | "ready" | "unknown";
  executablePath: string | null;
  details: string;
}

export function createApiClient(baseUrl = "") {
  const cleanBase = baseUrl.replace(/\/$/, "");

  return {
    async getHealth(): Promise<HealthResponse> {
      const res = await fetch(`${cleanBase}/api/health`);
      return handleResponse<HealthResponse>(res);
    },

    async listRepositories(): Promise<RepositoryListResponse> {
      const res = await fetch(`${cleanBase}/api/repositories`);
      return handleResponse<RepositoryListResponse>(res);
    },

    async getRepository(id: string): Promise<RepositoryResponse> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}`,
      );
      return handleResponse<RepositoryResponse>(res);
    },

    async createRepository(
      input: CreateRepositoryInput,
    ): Promise<RepositoryResponse> {
      const res = await fetch(`${cleanBase}/api/repositories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return handleResponse<RepositoryResponse>(res);
    },

    async updateRepository(
      id: string,
      patch: UpdateRepositoryInput,
    ): Promise<RepositoryResponse> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      return handleResponse<RepositoryResponse>(res);
    },

    async deleteRepository(id: string): Promise<void> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );
      return handleResponse<void>(res);
    },

    async getRunStatus(id: string): Promise<{ status: any }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/runs/active`,
      );
      return handleResponse<{ status: any }>(res);
    },

    async startRun(
      id: string,
      goal: string,
      maxIterations?: number,
    ): Promise<{ run: any }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/runs/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, maxIterations }),
        },
      );
      return handleResponse<{ run: any }>(res);
    },

    async pauseRun(id: string): Promise<{ status: string }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/runs/pause`,
        {
          method: "POST",
        },
      );
      return handleResponse<{ status: string }>(res);
    },

    async resumeRun(id: string): Promise<{ status: string }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/runs/resume`,
        {
          method: "POST",
        },
      );
      return handleResponse<{ status: string }>(res);
    },

    async stopRun(id: string): Promise<{ status: string }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/runs/stop`,
        {
          method: "POST",
        },
      );
      return handleResponse<{ status: string }>(res);
    },

    async recoverRun(
      id: string,
      action: "retry" | "stop" | "complete",
    ): Promise<{ run: any }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/runs/recover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      return handleResponse<{ run: any }>(res);
    },

    async getTailscaleGuidance(): Promise<{ tailscale: any }> {
      const res = await fetch(`${cleanBase}/api/system/tailscale`);
      return handleResponse<{ tailscale: any }>(res);
    },

    async listCampaigns(id: string): Promise<{ campaigns: CampaignSummary[] }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/campaigns`,
      );
      return handleResponse<{ campaigns: CampaignSummary[] }>(res);
    },

    async getCampaign(
      id: string,
      runId: string,
    ): Promise<{ campaign: CampaignDetail }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/campaigns/${encodeURIComponent(runId)}`,
      );
      return handleResponse<{ campaign: CampaignDetail }>(res);
    },

    async getExecutorCapabilities(id: string): Promise<{
      capability: ExecutorCapabilitySnapshot | null;
      history: unknown[];
    }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/executor/capabilities`,
      );
      return handleResponse<{
        capability: ExecutorCapabilitySnapshot | null;
        history: unknown[];
      }>(res);
    },

    async probeExecutor(
      id: string,
      level: "STATIC" | "NON_INFERENCE" | "INFERENCE" = "NON_INFERENCE",
    ): Promise<{ capability: ExecutorCapabilitySnapshot }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/executor/probe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level }),
        },
      );
      return handleResponse<{ capability: ExecutorCapabilitySnapshot }>(res);
    },

    async getPhasePolicy(
      id: string,
    ): Promise<{ policy: PhaseBudgetPolicy | null }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/phase-policy`,
      );
      return handleResponse<{ policy: PhaseBudgetPolicy | null }>(res);
    },

    async getPermissions(id: string): Promise<{
      policy: AutonomyPermissionPolicy;
      decisions: PermissionDecision[];
    }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/permissions`,
      );
      return handleResponse<{
        policy: AutonomyPermissionPolicy;
        decisions: PermissionDecision[];
      }>(res);
    },

    async checkPermission(
      id: string,
      action: PermissionAction,
    ): Promise<{ evaluation: PermissionEvaluation }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/permissions/check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      return handleResponse<{ evaluation: PermissionEvaluation }>(res);
    },

    async resolvePermissionDecision(
      id: string,
      decisionId: string,
      outcome: "ALLOW" | "ALLOW_ONCE" | "DENY",
    ): Promise<{ decision: PermissionDecision }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/permissions/decisions/${encodeURIComponent(decisionId)}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome }),
        },
      );
      return handleResponse<{ decision: PermissionDecision }>(res);
    },

    async getUsage(
      id: string,
    ): Promise<{ metrics: UsageMetric[]; summary: UsageSummary }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/usage`,
      );
      return handleResponse<{ metrics: UsageMetric[]; summary: UsageSummary }>(
        res,
      );
    },

    async getSchedulerPolicy(): Promise<{ policy: SchedulerPolicy }> {
      const res = await fetch(`${cleanBase}/api/scheduler/policy`);
      return handleResponse<{ policy: SchedulerPolicy }>(res);
    },

    async getSchedulerDecisions(): Promise<{ decisions: SchedulerDecision[] }> {
      const res = await fetch(`${cleanBase}/api/scheduler/decisions`);
      return handleResponse<{ decisions: SchedulerDecision[] }>(res);
    },

    async getRoleModelPolicy(id: string): Promise<{ policy: RoleModelPolicy }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/role-model-policy`,
      );
      return handleResponse<{ policy: RoleModelPolicy }>(res);
    },

    async resolveRoleModel(
      id: string,
      role = "PRIMARY",
    ): Promise<{ resolution: RoleModelResolution }> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(id)}/role-model-policy/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      return handleResponse<{ resolution: RoleModelResolution }>(res);
    },

    async triggerExecutorKill(repoId: string): Promise<void> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(repoId)}/executor/kill`,
        {
          method: "POST",
        },
      );
      await handleResponse<{ status: string }>(res);
    },

    async triggerExecutorStart(repoId: string): Promise<void> {
      // Server resolves the dispatch itself; empty body keeps request.body defined.
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(repoId)}/executor/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      await handleResponse<{ run: unknown }>(res);
    },

    async wakeSol(repoId: string): Promise<void> {
      const res = await fetch(
        `${cleanBase}/api/repositories/${encodeURIComponent(repoId)}/wake`,
        {
          method: "POST",
        },
      );
      await handleResponse<{ wake: SolWakeRecord }>(res);
    },

    async getBrowserStatus(): Promise<BrowserStatusView> {
      const res = await fetch(`${cleanBase}/api/browser/status`);
      const data = await handleResponse<{ browser: BrowserStatus }>(res);
      return data.browser;
    },

    async openChatGptSetup(): Promise<void> {
      const res = await fetch(`${cleanBase}/api/browser/setup/open`, {
        method: "POST",
      });
      await handleResponse<{ status: string }>(res);
    },

    async closeChatGptSetup(): Promise<void> {
      const res = await fetch(`${cleanBase}/api/browser/setup/close`, {
        method: "POST",
      });
      await handleResponse<{ status: string }>(res);
    },

    /** Change 023: auth readiness for the dedicated ChatGPT profile. */
    async checkChatGptAuth(): Promise<AuthReadinessReport> {
      const res = await fetch(`${cleanBase}/api/browser/auth/check`, {
        method: "POST",
      });
      const data = await handleResponse<{ auth: AuthReadinessReport }>(res);
      return data.auth;
    },

    async getProvisioningStatus(): Promise<ProvisioningStatusView> {
      const res = await fetch(`${cleanBase}/api/system/provisioning`);
      const data = await handleResponse<{ chromium: ProvisioningStatusView }>(
        res,
      );
      return data.chromium;
    },
  };
}

export const apiClient = createApiClient();

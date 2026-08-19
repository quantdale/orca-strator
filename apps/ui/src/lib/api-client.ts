import type {
  HealthResponse,
  RepositoryListResponse,
  RepositoryResponse,
  CreateRepositoryInput,
  UpdateRepositoryInput,
  ApiErrorEnvelope,
  FieldError
} from "@orca/shared";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: FieldError[]
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
        errorData.error.details
      );
    }

    throw new ApiError(
      "UNKNOWN_ERROR",
      `HTTP error ${res.status}: ${res.statusText}`,
      res.status
    );
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
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
      const res = await fetch(`${cleanBase}/api/repositories/${encodeURIComponent(id)}`);
      return handleResponse<RepositoryResponse>(res);
    },

    async createRepository(input: CreateRepositoryInput): Promise<RepositoryResponse> {
      const res = await fetch(`${cleanBase}/api/repositories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      return handleResponse<RepositoryResponse>(res);
    },

    async updateRepository(id: string, patch: UpdateRepositoryInput): Promise<RepositoryResponse> {
      const res = await fetch(`${cleanBase}/api/repositories/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      return handleResponse<RepositoryResponse>(res);
    },

    async deleteRepository(id: string): Promise<void> {
      const res = await fetch(`${cleanBase}/api/repositories/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      return handleResponse<void>(res);
    }
  };
}

export const apiClient = createApiClient();

import { useRef, useState, useEffect, useCallback } from "react";
import type {
  RepositoryRecord,
  CreateRepositoryInput,
  UpdateRepositoryInput,
  LoopState
} from "@orca/shared";
import { apiClient } from "./api-client.js";
import { eventsClient, type ConnectionStatus } from "./events-client.js";
import { notifyStateChange } from "./notifications.js";

/** Live loop-state snapshot for one repository, derived from `loop.state_changed` events. */
export interface LoopStateView {
  state: LoopState;
  reason?: string;
  updatedAt: string;
  runId?: string;
  iteration?: number;
}

export function useRepositories() {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runStatesByRepo, setRunStatesByRepo] = useState<Record<string, LoopStateView>>({});
  const repositoriesRef = useRef<RepositoryRecord[]>([]);

  useEffect(() => {
    repositoriesRef.current = repositories;
  }, [repositories]);

  const fetchRepositories = useCallback(async () => {
    try {
      setError(null);
      const res = await apiClient.listRepositories();
      setRepositories(res.repositories);
      setStatus("connected");
    } catch (err: any) {
      setError(err.message || "Failed to load repositories");
      setStatus("disconnected");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchRepositories();

    // Retain WebSocket connection
    const releaseEvents = eventsClient.retain();

    // Subscribe to connection status changes
    const unsubStatus = eventsClient.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus === "connected") {
        // Refetch on reconnect to guarantee fresh state
        fetchRepositories();
      }
    });

    // Subscribe to real-time repository mutations and live run state
    const unsubEvents = eventsClient.subscribe((event) => {
      if (event.type === "repository.created" && event.data?.repository) {
        setRepositories((prev) => {
          if (prev.some((r) => r.id === event.repositoryId)) return prev;
          return [event.data!.repository!, ...prev];
        });
      } else if (event.type === "repository.updated" && event.data?.repository) {
        setRepositories((prev) =>
          prev.map((r) => (r.id === event.repositoryId ? event.data!.repository! : r))
        );
      } else if (event.type === "repository.deleted") {
        setRepositories((prev) => prev.filter((r) => r.id !== event.repositoryId));
        setRunStatesByRepo((prev) => {
          if (!(event.repositoryId in prev)) return prev;
          const next = { ...prev };
          delete next[event.repositoryId];
          return next;
        });
      } else if (event.type === "loop.state_changed") {
        const data = event.data ?? {};
        const state = data.loopState as LoopState | undefined;
        if (!state) return;
        const view: LoopStateView = {
          state,
          reason: data.reason,
          updatedAt: event.at,
          runId: data.runId,
          iteration: data.iteration
        };
        setRunStatesByRepo((prev) => ({ ...prev, [event.repositoryId]: view }));
        // Problem/terminal transitions surface as OS notifications; filtering
        // and permission gating live in notifyStateChange.
        const repoName =
          repositoriesRef.current.find((r) => r.id === event.repositoryId)?.displayName ??
          event.repositoryId;
        notifyStateChange(repoName, state, view.reason);
      }
    });

    return () => {
      unsubStatus();
      unsubEvents();
      releaseEvents();
    };
  }, [fetchRepositories]);

  const createRepo = async (input: CreateRepositoryInput) => {
    const res = await apiClient.createRepository(input);
    setRepositories((prev) => {
      if (prev.some((r) => r.id === res.repository.id)) return prev;
      return [res.repository, ...prev];
    });
    return res.repository;
  };

  const updateRepo = async (id: string, patch: UpdateRepositoryInput) => {
    const res = await apiClient.updateRepository(id, patch);
    setRepositories((prev) =>
      prev.map((r) => (r.id === id ? res.repository : r))
    );
    return res.repository;
  };

  const deleteRepo = async (id: string) => {
    await apiClient.deleteRepository(id);
    setRepositories((prev) => prev.filter((r) => r.id !== id));
  };

  return {
    repositories,
    status,
    // True only while the event stream is live; false means degraded (run
    // states may be stale), distinct from a repository merely being idle.
    eventsConnected: status === "connected",
    runStatesByRepo,
    isLoading,
    error,
    refetch: fetchRepositories,
    createRepository: createRepo,
    updateRepository: updateRepo,
    deleteRepository: deleteRepo
  };
}

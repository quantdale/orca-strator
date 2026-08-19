import { useState, useEffect, useCallback } from "react";
import type {
  RepositoryRecord,
  CreateRepositoryInput,
  UpdateRepositoryInput
} from "@orca/shared";
import { apiClient } from "./api-client.js";
import { eventsClient, type ConnectionStatus } from "./events-client.js";

export function useRepositories() {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    // Connect WebSocket
    eventsClient.connect();

    // Subscribe to connection status changes
    const unsubStatus = eventsClient.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus === "connected") {
        // Refetch on reconnect to guarantee fresh state
        fetchRepositories();
      }
    });

    // Subscribe to real-time repository mutations
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
      }
    });

    return () => {
      unsubStatus();
      unsubEvents();
      eventsClient.disconnect();
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
    isLoading,
    error,
    refetch: fetchRepositories,
    createRepository: createRepo,
    updateRepository: updateRepo,
    deleteRepository: deleteRepo
  };
}

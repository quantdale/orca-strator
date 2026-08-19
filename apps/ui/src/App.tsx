import React, { useState, useEffect } from "react";
import { Shell } from "./components/Shell.js";
import { RepositoryList } from "./components/RepositoryList.js";
import { RepositoryDetail } from "./components/RepositoryDetail.js";
import { RepositoryForm } from "./components/RepositoryForm.js";
import { ConfirmModal } from "./components/ConfirmModal.js";
import { useRepositories } from "./lib/use-repositories.js";
import type { CreateRepositoryInput, UpdateRepositoryInput } from "@orca/shared";

export const App: React.FC = () => {
  const {
    repositories,
    status,
    isLoading,
    refetch,
    createRepository,
    updateRepository,
    deleteRepository
  } = useRepositories();

  const [currentView, setCurrentView] = useState<"list" | "add" | "detail" | "edit">("list");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [deletingRepoId, setDeletingRepoId] = useState<string | null>(null);

  // Sync state with URL hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, "");
      if (!hash || hash === "list" || hash === "") {
        setCurrentView("list");
        setSelectedRepoId(null);
      } else if (hash === "add") {
        setCurrentView("add");
        setSelectedRepoId(null);
      } else if (hash.startsWith("repositories/")) {
        const id = hash.replace("repositories/", "");
        setSelectedRepoId(id);
        setCurrentView("detail");
      } else if (hash.startsWith("edit/")) {
        const id = hash.replace("edit/", "");
        setSelectedRepoId(id);
        setCurrentView("edit");
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigateTo = (view: "list" | "add" | "detail" | "edit", repoId?: string) => {
    if (view === "list") {
      window.location.hash = "#/";
    } else if (view === "add") {
      window.location.hash = "#/add";
    } else if (view === "detail" && repoId) {
      window.location.hash = `#/repositories/${repoId}`;
    } else if (view === "edit" && repoId) {
      window.location.hash = `#/edit/${repoId}`;
    }
  };

  const selectedRepo = repositories.find((r) => r.id === selectedRepoId);

  const handleCreate = async (data: CreateRepositoryInput | UpdateRepositoryInput) => {
    const created = await createRepository(data as CreateRepositoryInput);
    navigateTo("detail", created.id);
  };

  const handleUpdate = async (data: CreateRepositoryInput | UpdateRepositoryInput) => {
    if (!selectedRepoId) return;
    await updateRepository(selectedRepoId, data as UpdateRepositoryInput);
    navigateTo("detail", selectedRepoId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingRepoId) return;
    await deleteRepository(deletingRepoId);
    setDeletingRepoId(null);
    navigateTo("list");
  };

  return (
    <Shell
      status={status}
      currentView={currentView}
      onNavigate={(v) => navigateTo(v as any)}
    >
      {currentView === "list" && (
        <RepositoryList
          repositories={repositories}
          status={status}
          isLoading={isLoading}
          onSelectRepo={(id) => navigateTo("detail", id)}
          onEditRepo={(id) => navigateTo("edit", id)}
          onAddRepo={() => navigateTo("add")}
          onRetry={refetch}
        />
      )}

      {currentView === "add" && (
        <RepositoryForm
          onSubmit={handleCreate}
          onCancel={() => navigateTo("list")}
          isEditing={false}
        />
      )}

      {currentView === "detail" && selectedRepo && (
        <RepositoryDetail
          repository={selectedRepo}
          onBack={() => navigateTo("list")}
          onEdit={() => navigateTo("edit", selectedRepo.id)}
          onDelete={() => setDeletingRepoId(selectedRepo.id)}
        />
      )}

      {currentView === "detail" && !selectedRepo && !isLoading && (
        <div className="py-12 text-center text-slate-400">
          <p>Repository not found.</p>
          <button
            onClick={() => navigateTo("list")}
            className="mt-4 text-cyan-400 hover:underline"
          >
            ← Back to Repositories
          </button>
        </div>
      )}

      {currentView === "edit" && selectedRepo && (
        <RepositoryForm
          initialValues={selectedRepo}
          onSubmit={handleUpdate}
          onCancel={() => navigateTo("detail", selectedRepo.id)}
          isEditing={true}
        />
      )}

      <ConfirmModal
        isOpen={deletingRepoId !== null}
        title="Delete Repository"
        message={`Are you sure you want to delete "${selectedRepo?.displayName}"? This removes the configuration record from Orca-Strator. Your local working directory and git remote will not be touched.`}
        confirmLabel="Delete Repository"
        isDestructive={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingRepoId(null)}
      />
    </Shell>
  );
};

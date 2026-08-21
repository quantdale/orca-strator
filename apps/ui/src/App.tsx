import React, { useState, useEffect } from "react";
import { Shell } from "./components/Shell.js";
import { RepositoryList } from "./components/RepositoryList.js";
import { RepositoryDetail } from "./components/RepositoryDetail.js";
import { RepositoryForm } from "./components/RepositoryForm.js";
import { Settings } from "./components/Settings.js";
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

  const [currentView, setCurrentView] = useState<"list" | "add" | "detail" | "edit" | "settings">("list");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [deletingRepoId, setDeletingRepoId] = useState<string | null>(null);

  // Sync state with URL pathname (and hash fallback)
  useEffect(() => {
    const handleLocationChange = () => {
      const pathname = window.location.pathname;
      const hash = window.location.hash.replace(/^#\/?/, "");

      if (pathname === "/repositories/new" || pathname === "/add" || hash === "add") {
        setCurrentView("add");
        setSelectedRepoId(null);
      } else if (pathname === "/settings" || hash === "settings") {
        setCurrentView("settings");
        setSelectedRepoId(null);
      } else if (pathname.startsWith("/repositories/") && pathname.endsWith("/edit")) {
        const match = pathname.match(/^\/repositories\/([^/]+)\/edit$/);
        if (match && match[1]) {
          setSelectedRepoId(match[1]);
          setCurrentView("edit");
        }
      } else if (pathname.startsWith("/edit/")) {
        const id = pathname.replace("/edit/", "");
        setSelectedRepoId(id);
        setCurrentView("edit");
      } else if (pathname.startsWith("/repositories/")) {
        const id = pathname.replace("/repositories/", "");
        setSelectedRepoId(id);
        setCurrentView("detail");
      } else if (hash.startsWith("repositories/")) {
        const id = hash.replace("repositories/", "");
        setSelectedRepoId(id);
        setCurrentView("detail");
      } else if (hash.startsWith("edit/")) {
        const id = hash.replace("edit/", "");
        setSelectedRepoId(id);
        setCurrentView("edit");
      } else {
        setCurrentView("list");
        setSelectedRepoId(null);
      }
    };

    handleLocationChange();
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  const navigateTo = (view: "list" | "add" | "detail" | "edit" | "settings", repoId?: string) => {
    let targetPath = "/";
    if (view === "add") {
      targetPath = "/repositories/new";
    } else if (view === "settings") {
      targetPath = "/settings";
    } else if (view === "detail" && repoId) {
      targetPath = `/repositories/${repoId}`;
    } else if (view === "edit" && repoId) {
      targetPath = `/repositories/${repoId}/edit`;
    }

    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, "", targetPath);
    }

    if (view === "list") {
      setCurrentView("list");
      setSelectedRepoId(null);
    } else if (view === "add") {
      setCurrentView("add");
      setSelectedRepoId(null);
    } else if (view === "settings") {
      setCurrentView("settings");
      setSelectedRepoId(null);
    } else if (view === "detail" && repoId) {
      setCurrentView("detail");
      setSelectedRepoId(repoId);
    } else if (view === "edit" && repoId) {
      setCurrentView("edit");
      setSelectedRepoId(repoId);
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

      {currentView === "settings" && <Settings />}

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

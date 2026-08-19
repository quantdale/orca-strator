import React from "react";
import type { ConnectionStatus } from "../lib/events-client.js";

interface HeaderProps {
  status: ConnectionStatus;
  currentView: string;
  onNavigate: (view: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ status, currentView, onNavigate }) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate("list")}
            className="flex items-center gap-2 text-left focus:outline-none"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500 font-bold text-white shadow-lg shadow-cyan-500/20">
              🐋
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                Orca-Strator
              </h1>
              <p className="hidden text-xs text-slate-400 sm:block">
                Local Agent Orchestration Plane
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {/* Connection Status Badge */}
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              status === "connected"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : status === "connecting"
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
            }`}
            data-testid="connection-status-badge"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status === "connected"
                  ? "bg-emerald-400"
                  : status === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-rose-400"
              }`}
            />
            <span className="capitalize">{status}</span>
          </div>

          {/* Navigation Action */}
          {currentView !== "add" && (
            <button
              onClick={() => onNavigate("add")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-medium text-white shadow hover:bg-cyan-500 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 sm:text-sm"
              data-testid="add-repo-nav-button"
            >
              <span className="text-base leading-none">+</span>
              <span>Add Repository</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

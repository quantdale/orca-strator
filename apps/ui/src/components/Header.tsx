import React, { useState } from "react";
import type { ConnectionStatus } from "../lib/events-client.js";
import { apiClient } from "../lib/api-client.js";
import { requestNotificationPermission } from "../lib/notifications.js";

interface HeaderProps {
  status: ConnectionStatus;
  currentView: string;
  onNavigate: (view: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ status, currentView, onNavigate }) => {
  const [showTailscale, setShowTailscale] = useState(false);
  const [guidance, setGuidance] = useState<any>(null);
  const [tailscaleError, setTailscaleError] = useState<string | null>(null);

  const openTailscale = async () => {
    setTailscaleError(null);
    try {
      const res = await apiClient.getTailscaleGuidance();
      setGuidance(res.tailscale);
      setShowTailscale(true);
    } catch (err) {
      setTailscaleError(
        err instanceof Error && err.message
          ? `Could not load Tailscale guidance: ${err.message}`
          : "Could not load Tailscale guidance from the controller."
      );
    }
  };

  return (
    <>
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

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Notifications Button */}
            <button
              onClick={() => requestNotificationPermission()}
              className="rounded p-1.5 text-slate-400 hover:text-white transition-colors text-xs border border-slate-800 hover:bg-slate-800"
              title="Enable browser notifications"
              data-testid="notifications-button"
            >
              🔔
            </button>

            {/* Tailscale Phone Access Button */}
            <button
              onClick={openTailscale}
              className="rounded px-2.5 py-1 text-xs font-medium text-slate-300 border border-slate-700 hover:bg-slate-800 transition-colors"
              title="Tailscale Phone Access"
              data-testid="tailscale-button"
            >
              📱 Phone Access
            </button>

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

            {/* Settings Button */}
            {currentView !== "settings" && (
              <button
                onClick={() => onNavigate("settings")}
                className="rounded px-2.5 py-1 text-xs font-medium text-slate-300 border border-slate-700 hover:bg-slate-800 transition-colors"
                title="Settings"
                data-testid="settings-nav-button"
              >
                ⚙ Settings
              </button>
            )}

            {/* Navigation Action */}
            {currentView !== "add" && (
              <button
                onClick={() => onNavigate("add")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-cyan-500 transition-colors focus:outline-none sm:text-sm sm:px-3.5"
                data-testid="add-repo-nav-button"
              >
                <span className="text-base leading-none">+</span>
                <span>Add Repo</span>
              </button>
            )}
          </div>
        </div>

        {tailscaleError && (
          <div
            className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 pb-3 sm:px-6"
            data-testid="tailscale-error-banner"
          >
            <p className="text-xs text-rose-300">{tailscaleError}</p>
            <button
              onClick={() => setTailscaleError(null)}
              className="shrink-0 text-xs text-slate-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}
      </header>

      {/* Tailscale Guidance Modal */}
      {showTailscale && guidance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="tailscale-modal">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">📱 Private Phone Access (Tailscale Serve)</h3>
              <button
                onClick={() => setShowTailscale(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Orca-Strator is bound securely to your loopback address. To view and control runs from your phone without public internet exposure:
            </p>

            <div className="rounded-lg bg-slate-950 p-3 border border-slate-800 text-xs font-mono text-cyan-300 break-all">
              {guidance.command}
            </div>

            <ul className="space-y-1.5 text-xs text-slate-400">
              {guidance.instructions.map((inst: string, idx: number) => (
                <li key={idx}>{inst}</li>
              ))}
            </ul>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowTailscale(false)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

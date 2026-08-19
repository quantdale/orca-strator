import React from "react";
import { Header } from "./Header.js";
import type { ConnectionStatus } from "../lib/events-client.js";

interface ShellProps {
  status: ConnectionStatus;
  currentView: string;
  onNavigate: (view: string) => void;
  children: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  status,
  currentView,
  onNavigate,
  children
}) => {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <Header status={status} currentView={currentView} onNavigate={onNavigate} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <p>Orca-Strator v0.1.0 • Control Plane Foundation</p>
      </footer>
    </div>
  );
};

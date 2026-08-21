import React, { useCallback, useEffect, useState } from "react";
import type { TailscaleGuidance } from "@orca/shared";
import type { BrowserStatusView, ProvisioningStatusView } from "../lib/api-client.js";
import { ApiError, apiClient } from "../lib/api-client.js";

const TAILSCALE_GUIDANCE_TEXT =
  "Controller remains loopback-only. Tailscale Serve publishes the Orca web origin privately to your tailnet. The expected phone URL is the Tailscale HTTPS origin, not a localhost controller URL.";

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return `${err.message} [${err.code}]`;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

export const Settings: React.FC = () => {
  const [browser, setBrowser] = useState<BrowserStatusView | null>(null);
  const [browserLoading, setBrowserLoading] = useState(true);
  const [browserError, setBrowserError] = useState<string | null>(null);

  const [provisioning, setProvisioning] = useState<ProvisioningStatusView | null>(null);
  const [provisioningLoading, setProvisioningLoading] = useState(true);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);

  const [tailscale, setTailscale] = useState<TailscaleGuidance | null>(null);
  const [tailscaleLoading, setTailscaleLoading] = useState(true);
  const [tailscaleError, setTailscaleError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<"open" | "close" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshBrowser = useCallback(async () => {
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      setBrowser(await apiClient.getBrowserStatus());
    } catch (err) {
      setBrowserError(toErrorMessage(err, "Failed to load browser status."));
    } finally {
      setBrowserLoading(false);
    }
  }, []);

  const refreshProvisioning = useCallback(async () => {
    setProvisioningLoading(true);
    setProvisioningError(null);
    try {
      setProvisioning(await apiClient.getProvisioningStatus());
    } catch (err) {
      setProvisioningError(toErrorMessage(err, "Failed to load Chromium provisioning status."));
    } finally {
      setProvisioningLoading(false);
    }
  }, []);

  const refreshTailscale = useCallback(async () => {
    setTailscaleLoading(true);
    setTailscaleError(null);
    try {
      const res = await apiClient.getTailscaleGuidance();
      setTailscale(res.tailscale as TailscaleGuidance);
    } catch (err) {
      setTailscaleError(toErrorMessage(err, "Failed to load Tailscale status."));
    } finally {
      setTailscaleLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBrowser();
    void refreshProvisioning();
    void refreshTailscale();
  }, [refreshBrowser, refreshProvisioning, refreshTailscale]);

  const handleOpenSetup = async () => {
    setActionError(null);
    setPendingAction("open");
    try {
      await apiClient.openChatGptSetup();
      await refreshBrowser();
    } catch (err) {
      setActionError(toErrorMessage(err, "Failed to open the ChatGPT setup browser."));
    } finally {
      setPendingAction(null);
    }
  };

  const handleCloseSetup = async () => {
    setActionError(null);
    setPendingAction("close");
    try {
      await apiClient.closeChatGptSetup();
      await refreshBrowser();
    } catch (err) {
      setActionError(toErrorMessage(err, "Failed to close the setup browser."));
    } finally {
      setPendingAction(null);
    }
  };

  // Derived per UI-UX-SPEC §19. BrowserStatus carries no verification timestamp,
  // so "Last setup verification" is reported as unknown.
  const profileConfigured = Boolean(browser?.profilePath);
  const profileUse = !browser
    ? null
    : browser.isSetupOpen
    ? "Setup active"
    : browser.isRunning
    ? "Automation active"
    : "Available";

  const openConflictReason = !browser
    ? null
    : browser.isSetupOpen
    ? "The headed setup browser is already open. Close it before launching another."
    : browser.isRunning || browser.activePages > 0 || browser.lockHolderPid !== null
    ? "Automated Chromium owns the profile; headed setup cannot reuse it. Wait for automated operations to finish."
    : null;

  const actionsDisabled = pendingAction !== null || browserLoading;

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="settings-view">
      <div>
        <h2 className="text-xl font-bold text-white sm:text-2xl">Settings</h2>
        <p className="text-sm text-slate-400">
          Local automation, provisioning, and private phone access configuration.
        </p>
      </div>

      {/* ChatGPT Automation (UI-UX-SPEC §19) */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4"
        data-testid="settings-chatgpt-section"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            ChatGPT Automation
          </h3>
          <button
            onClick={() => void refreshBrowser()}
            disabled={browserLoading}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {browserLoading && !browser && (
          <p className="text-sm text-slate-500" data-testid="chatgpt-status-loading">
            Loading automation status…
          </p>
        )}

        {browserError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300" data-testid="chatgpt-status-error">
            {browserError}
          </div>
        )}

        {!browserLoading && !browserError && !browser && (
          <p className="text-sm text-slate-500">No automation status available.</p>
        )}

        {browser && (
          <>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Automation profile</dt>
                <dd className={`mt-1 text-sm ${profileConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                  {profileConfigured ? "Configured" : "Not configured"}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Profile use</dt>
                <dd className="mt-1 text-sm text-slate-200">{profileUse ?? "Unknown"}</dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Last setup verification</dt>
                <dd className="mt-1 text-sm text-slate-200">unknown</dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Active pages</dt>
                <dd className="mt-1 text-sm font-mono text-slate-200">{browser.activePages}</dd>
              </div>

              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Profile path</dt>
                <dd className="mt-1 text-sm font-mono text-slate-200 bg-slate-950 p-2.5 rounded-lg border border-slate-800 break-all">
                  {browser.profilePath}
                </dd>
              </div>
            </dl>

            {openConflictReason && (
              <p className="text-xs text-amber-400" data-testid="chatgpt-open-conflict">
                {openConflictReason}
              </p>
            )}

            {actionError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300" data-testid="chatgpt-action-error">
                {actionError}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <button
                onClick={() => void handleOpenSetup()}
                disabled={actionsDisabled || openConflictReason !== null}
                className="inline-flex items-center rounded-lg bg-cyan-600 px-3.5 py-2 text-xs font-medium text-white shadow hover:bg-cyan-500 transition-colors focus:outline-none sm:text-sm disabled:opacity-50 disabled:hover:bg-cyan-600"
                data-testid="open-setup-browser-button"
              >
                {pendingAction === "open" ? "Opening…" : "Open ChatGPT Setup Browser"}
              </button>
              <button
                onClick={() => void handleCloseSetup()}
                disabled={actionsDisabled || !browser.isSetupOpen}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-700 transition-colors sm:text-sm disabled:opacity-50"
                data-testid="close-setup-browser-button"
              >
                {pendingAction === "close" ? "Closing…" : "Close Setup Browser"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Chromium provisioning */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4"
        data-testid="settings-provisioning-section"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Chromium Provisioning
          </h3>
          <button
            onClick={() => void refreshProvisioning()}
            disabled={provisioningLoading}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {provisioningLoading && !provisioning && (
          <p className="text-sm text-slate-500">Loading provisioning status…</p>
        )}

        {provisioningError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300">
            {provisioningError}
          </div>
        )}

        {!provisioningLoading && !provisioningError && !provisioning && (
          <p className="text-sm text-slate-500">No provisioning status available.</p>
        )}

        {provisioning && (
          <dl className="grid grid-cols-1 gap-4">
            <div>
              <dt className="text-xs text-slate-500">Status</dt>
              <dd
                className={`mt-1 text-sm ${
                  provisioning.status === "ready"
                    ? "text-emerald-400"
                    : provisioning.status === "missing"
                    ? "text-rose-400"
                    : "text-amber-400"
                }`}
              >
                {provisioning.status}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500">Executable path</dt>
              <dd className="mt-1 text-sm font-mono text-slate-200 bg-slate-950 p-2.5 rounded-lg border border-slate-800 break-all">
                {provisioning.executablePath ?? "Not found"}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500">Details</dt>
              <dd className="mt-1 text-sm text-slate-300">{provisioning.details}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* Phone access / Tailscale (UI-UX-SPEC §20) */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4"
        data-testid="settings-tailscale-section"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Phone Access (Tailscale)
          </h3>
          <button
            onClick={() => void refreshTailscale()}
            disabled={tailscaleLoading}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <p className="text-sm text-slate-300">{TAILSCALE_GUIDANCE_TEXT}</p>

        {tailscaleLoading && !tailscale && (
          <p className="text-sm text-slate-500">Loading Tailscale status…</p>
        )}

        {tailscaleError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300">
            {tailscaleError}
          </div>
        )}

        {!tailscaleLoading && !tailscaleError && !tailscale && (
          <p className="text-sm text-slate-500">No Tailscale status available.</p>
        )}

        {tailscale && (
          <dl className="grid grid-cols-1 gap-4">
            <div>
              <dt className="text-xs text-slate-500">Detected status</dt>
              <dd
                className={`mt-1 text-sm ${
                  tailscale.status === "configured" ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {tailscale.status === "configured" ? "Available" : "Not configured"}
                <span className="ml-2 text-xs text-slate-500">({tailscale.status})</span>
              </dd>
            </div>

            {tailscale.details && (
              <div>
                <dt className="text-xs text-slate-500">Details</dt>
                <dd className="mt-1 text-sm text-slate-300">{tailscale.details}</dd>
              </div>
            )}

            <div>
              <dt className="text-xs text-slate-500">Serve command</dt>
              <dd className="mt-1 text-sm font-mono text-cyan-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800 break-all">
                {tailscale.command}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
};

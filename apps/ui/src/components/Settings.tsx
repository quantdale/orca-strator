import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { AuthReadinessReport, SystemReadinessResponse, TailscaleGuidance } from "@orca/shared";
import type {
  BrowserStatusView,
  ProvisioningStatusView,
  SystemBackupResponse,
} from "../lib/api-client.js";
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

  const [provisioning, setProvisioning] =
    useState<ProvisioningStatusView | null>(null);
  const [provisioningLoading, setProvisioningLoading] = useState(true);
  const [provisioningError, setProvisioningError] = useState<string | null>(
    null,
  );

  const [tailscale, setTailscale] = useState<TailscaleGuidance | null>(null);
  const [tailscaleLoading, setTailscaleLoading] = useState(true);
  const [tailscaleError, setTailscaleError] = useState<string | null>(null);

  const [readiness, setReadiness] = useState<SystemReadinessResponse | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<
    "open" | "check" | "close" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [authReport, setAuthReport] = useState<AuthReadinessReport | null>(
    null,
  );
  const [authError, setAuthError] = useState<string | null>(null);

  // Change 026 §5: Settings Create Backup (controller-side bundle; the UI
  // supplies no paths and gains no filesystem authority).
  const [backupPending, setBackupPending] = useState(false);
  const [backupResult, setBackupResult] = useState<SystemBackupResponse | null>(
    null,
  );
  const [backupError, setBackupError] = useState<string | null>(null);

  const handleCreateBackup = async () => {
    setBackupError(null);
    setBackupPending(true);
    try {
      setBackupResult(await apiClient.createSystemBackup());
    } catch (err) {
      setBackupResult(null);
      setBackupError(toErrorMessage(err, "Failed to create a state backup."));
    } finally {
      setBackupPending(false);
    }
  };

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
      setProvisioningError(
        toErrorMessage(err, "Failed to load Chromium provisioning status."),
      );
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
      setTailscaleError(
        toErrorMessage(err, "Failed to load Tailscale status."),
      );
    } finally {
      setTailscaleLoading(false);
    }
  }, []);

  const refreshReadiness = useCallback(async () => {
    setReadinessLoading(true);
    setReadinessError(null);
    try {
      setReadiness(await apiClient.getSystemReadiness());
    } catch (err) {
      setReadinessError(toErrorMessage(err, "Failed to load system readiness."));
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBrowser();
    void refreshProvisioning();
    void refreshTailscale();
    void refreshReadiness();
  }, [refreshBrowser, refreshProvisioning, refreshTailscale, refreshReadiness]);

  const handleOpenSetup = async () => {
    setActionError(null);
    setPendingAction("open");
    try {
      await apiClient.openChatGptSetup();
      await refreshBrowser();
    } catch (err) {
      setActionError(
        toErrorMessage(err, "Failed to open the ChatGPT setup browser."),
      );
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

  // Change 023 §6: explicit readiness check through safe UI/navigation signals.
  const handleCheckLogin = async () => {
    setAuthError(null);
    setPendingAction("check");
    try {
      const report = await apiClient.checkChatGptAuth();
      setAuthReport(report);
      await refreshBrowser();
    } catch (err) {
      setAuthError(
        toErrorMessage(err, "Failed to check ChatGPT login readiness."),
      );
    } finally {
      setPendingAction(null);
    }
  };

  // Derived per UI-UX-SPEC §19 + Change 023 §6.
  const profileConfigured = Boolean(browser?.profilePath);
  const profileUse = browser
    ? browser.isSetupOpen
      ? "Setup active"
      : browser.isRunning
        ? "Automation active"
        : "Available"
    : null;

  const chromeLabel = browser
    ? browser.systemChrome.status === "FOUND"
      ? `Detected${browser.systemChrome.version ? ` · v${browser.systemChrome.version}` : ""}`
      : browser.systemChrome.status === "NOT_FOUND"
        ? "Not found — install Google Chrome"
        : "Unknown (probe failed)"
    : "Unknown";

  const authLabel = authReport
    ? authReport.status
    : browser?.authReadiness
      ? browser.authReadiness.status
      : "Not checked";

  const ownershipLabel = browser
    ? browser.isSetupOpen && browser.setupPid !== null
      ? `External setup Chrome (PID ${browser.setupPid})`
      : browser.lockHolderPid === null
        ? "Free — automation may acquire"
        : browser.lockHolderPid === browser.setupPid
          ? `External setup Chrome (PID ${browser.lockHolderPid})`
          : `Automation / controller (PID ${browser.lockHolderPid})`
    : "Unknown";

  const openConflictReason = browser
    ? browser.isSetupOpen
      ? "The setup browser is already open. Close it before launching another."
      : browser.isRunning ||
          browser.activePages > 0 ||
          browser.lockHolderPid !== null
        ? "Automation owns the dedicated profile; setup cannot reuse it until automated operations finish."
        : null
    : null;

  const actionsDisabled = pendingAction !== null || browserLoading;

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="settings-view">
      <div>
        <h2 className="text-xl font-bold text-white sm:text-2xl">Settings</h2>
        <p className="text-sm text-slate-400">
          Local automation, provisioning, and private phone access
          configuration.
        </p>
      </div>

      {/* System Readiness / Doctor (Change 025 §6) */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4"
        data-testid="settings-readiness-section"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            System Readiness
          </h3>
          <button
            onClick={() => void refreshReadiness()}
            disabled={readinessLoading}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            data-testid="readiness-refresh"
          >
            Refresh
          </button>
        </div>

        {readinessLoading && !readiness && (
          <p className="text-sm text-slate-500" data-testid="readiness-loading">
            Evaluating system readiness…
          </p>
        )}

        {readinessError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300" data-testid="readiness-error">
            {readinessError}
          </div>
        )}

        {readiness && (
          <>
            <p
              className={`rounded-lg border p-3.5 text-sm ${
                readiness.ready
                  ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-300"
                  : "border-amber-500/30 bg-amber-950/40 text-amber-300"
              }`}
              data-testid="readiness-verdict"
            >
              {readiness.ready
                ? "Core Orca runtime is ready. Optional capabilities below do not block operation."
                : "Core Orca runtime needs attention before autonomous campaigns can run."}
              <span className="ml-2 text-xs text-slate-500">
                controller v{readiness.identity.version} (protocol {readiness.identity.protocol})
              </span>
            </p>

            <ul className="space-y-2" data-testid="readiness-checks">
              {readiness.checks.map((checkItem) => (
                <li
                  key={checkItem.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
                  data-testid={`readiness-check-${checkItem.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-200">{checkItem.title}</span>
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        checkItem.status === "READY"
                          ? "text-emerald-400"
                          : checkItem.status === "ACTION_REQUIRED"
                            ? checkItem.blocking
                              ? "text-rose-400"
                              : "text-amber-400"
                            : checkItem.status === "OPTIONAL"
                              ? "text-slate-500"
                              : "text-sky-400"
                      }`}
                    >
                      {checkItem.status}
                      {checkItem.status === "ACTION_REQUIRED" && !checkItem.blocking && " (optional)"}
                    </span>
                  </div>
                  {checkItem.detail && (
                    <p className="mt-1 break-all text-xs text-slate-400">{checkItem.detail}</p>
                  )}
                  {checkItem.remediation && (
                    <p className="mt-1 text-xs text-cyan-400/80">{checkItem.remediation}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

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
          <p
            className="text-sm text-slate-500"
            data-testid="chatgpt-status-loading"
          >
            Loading automation status…
          </p>
        )}

        {browserError && (
          <div
            className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300"
            data-testid="chatgpt-status-error"
          >
            {browserError}
          </div>
        )}

        {!browserLoading && !browserError && !browser && (
          <p className="text-sm text-slate-500">
            No automation status available.
          </p>
        )}

        {browser && (
          <>
            {/* Change 023 §6 truthfulness copy */}
            <p
              className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5 text-sm leading-relaxed text-slate-300"
              data-testid="chatgpt-setup-explanation"
            >
              Opens ordinary Google Chrome using Orca's dedicated browser
              profile. Use this window to sign into ChatGPT manually. Close it
              when login is complete. Orca automation will reuse this dedicated
              profile afterward.
            </p>

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">
                  Chrome detected/version
                </dt>
                <dd
                  className={`mt-1 text-sm ${
                    browser.systemChrome.status === "FOUND"
                      ? "text-emerald-400"
                      : browser.systemChrome.status === "NOT_FOUND"
                        ? "text-rose-400"
                        : "text-amber-400"
                  }`}
                  data-testid="chrome-detected"
                >
                  {chromeLabel}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Profile use</dt>
                <dd className="mt-1 text-sm text-slate-200">
                  {profileUse ?? "Unknown"}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Setup browser</dt>
                <dd
                  className="mt-1 text-sm text-slate-200"
                  data-testid="setup-browser-state"
                >
                  {browser.isSetupOpen ? "OPEN" : "CLOSED"}
                  {browser.isSetupOpen &&
                    browser.setupLauncherKind === "external-chrome" && (
                      <span className="ml-2 text-xs text-slate-500">
                        (ordinary Chrome, no automation)
                      </span>
                    )}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">
                  Authentication readiness
                </dt>
                <dd
                  className={`mt-1 text-sm ${
                    authLabel === "AUTHENTICATED"
                      ? "text-emerald-400"
                      : authLabel === "LOGIN_REQUIRED" ||
                          authLabel === "VERIFICATION_REQUIRED"
                        ? "text-amber-400"
                        : "text-slate-200"
                  }`}
                  data-testid="auth-readiness"
                >
                  {authLabel}
                  {authReport && authReport.evidence.length > 0 && (
                    <span className="ml-2 text-xs text-slate-500">
                      ({authReport.evidence.join(", ")})
                    </span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">
                  Automation-profile ownership
                </dt>
                <dd
                  className="mt-1 text-sm text-slate-200"
                  data-testid="profile-ownership"
                >
                  {ownershipLabel}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Active pages</dt>
                <dd className="mt-1 text-sm font-mono text-slate-200">
                  {browser.activePages}
                </dd>
              </div>

              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">
                  Dedicated profile location
                </dt>
                <dd
                  className={`mt-1 text-sm font-mono text-slate-200 bg-slate-950 p-2.5 rounded-lg border border-slate-800 break-all ${profileConfigured ? "" : "text-amber-400"}`}
                >
                  {profileConfigured ? browser.profilePath : "Not configured"}
                </dd>
              </div>
            </dl>

            {openConflictReason && (
              <p
                className="text-xs text-amber-400"
                data-testid="chatgpt-open-conflict"
              >
                {openConflictReason}
              </p>
            )}

            {authError && (
              <p
                className="text-xs text-rose-400"
                data-testid="chatgpt-auth-error"
              >
                {authError}
              </p>
            )}

            {actionError && (
              <div
                className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300"
                data-testid="chatgpt-action-error"
              >
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
                {pendingAction === "open" ? "Opening…" : "Open Setup Browser"}
              </button>
              <button
                onClick={() => void handleCheckLogin()}
                disabled={actionsDisabled || Boolean(browser.isSetupOpen)}
                title={
                  browser.isSetupOpen
                    ? "Close the setup browser before checking login"
                    : "Verifies ChatGPT login using the dedicated profile"
                }
                className="inline-flex items-center rounded-lg border border-cyan-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-cyan-300 hover:bg-slate-700 transition-colors sm:text-sm disabled:opacity-50"
                data-testid="check-login-button"
              >
                {pendingAction === "check" ? "Checking…" : "Check Login"}
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
          <p className="text-sm text-slate-500">
            No provisioning status available.
          </p>
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
              <dd className="mt-1 text-sm text-slate-300">
                {provisioning.details}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* State backup / recovery (Change 026 §5) */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4"
        data-testid="settings-backup-section"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Backup / Recovery
          </h3>
          <button
            onClick={() => void handleCreateBackup()}
            disabled={backupPending}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            data-testid="create-backup-button"
          >
            {backupPending ? "Creating…" : "Create Backup"}
          </button>
        </div>

        <p className="text-sm text-slate-300">
          Creates a verified bundle of durable Orca state under the controller
          data directory. Cookies/profiles, credentials, repository working
          directories, locks, and logs are structurally excluded. Restore is an
          offline CLI (<code className="text-cyan-300">npm run restore</code>) so quiescence is provable.
        </p>

        {backupError && (
          <div
            className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300"
            data-testid="backup-error"
          >
            {backupError}
          </div>
        )}

        {backupResult && (
          <div
            className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-4 text-sm text-emerald-300 space-y-1"
            data-testid="backup-result"
          >
            <p>Backup created.</p>
            <p className="break-all font-mono text-xs">{backupResult.bundleDir}</p>
            <p className="text-xs text-slate-400">
              schema v{backupResult.manifest.sourceSchemaVersion} ·{" "}
              {backupResult.manifest.files.length} file(s) · sha256 verified
            </p>
          </div>
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
          <p className="text-sm text-slate-500">
            No Tailscale status available.
          </p>
        )}

        {tailscale && (
          <dl className="grid grid-cols-1 gap-4">
            <div>
              <dt className="text-xs text-slate-500">Detected status</dt>
              <dd
                className={`mt-1 text-sm ${
                  tailscale.status === "configured"
                    ? "text-emerald-400"
                    : "text-amber-400"
                }`}
              >
                {tailscale.status === "configured"
                  ? "Available"
                  : "Not configured"}
                <span className="ml-2 text-xs text-slate-500">
                  ({tailscale.status})
                </span>
              </dd>
            </div>

            {tailscale.details && (
              <div>
                <dt className="text-xs text-slate-500">Details</dt>
                <dd className="mt-1 text-sm text-slate-300">
                  {tailscale.details}
                </dd>
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

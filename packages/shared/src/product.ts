/**
 * Product-level contracts for Windows productization (Change 025):
 * controller build identity, singleton runtime ownership, system readiness,
 * and the desktop startup state machine.
 */

/** Bump on any breaking change to the loopback controller contract surface. */
export const ORCA_PROTOCOL_VERSION = 1;

/**
 * Controller build identity (Change 025 + Change 026).
 *
 * `buildId` is the immutable build identity (Git commit SHA or CI build id);
 * wall-clock timestamps are never identity. `mode` distinguishes packaged
 * installs from development runs; `maxSchemaVersion` is the highest database
 * schema the binary knows (drives downgrade refusal and desktop pairing).
 * The Change 026 fields are optional so protocol-1 peers from Change 025
 * remain parseable.
 */
export interface ControllerIdentity {
  service: "orca-controller";
  version: string;
  protocol: number;
  pid: number;
  buildId?: string;
  mode?: "packaged" | "development";
  maxSchemaVersion?: number;
}

/** Explicit outcomes of pairing a desktop with a probed Orca controller. */
export type ControllerCompatibilityVerdict =
  | "EXACT_MATCH"
  | "COMPATIBLE_VERSION_SKEW"
  | "RESTART_REQUIRED"
  | "PROTOCOL_INCOMPATIBLE"
  | "DATABASE_INCOMPATIBLE"
  | "FOREIGN_LISTENER"
  | "ABSENT";

export interface DesktopBuildIdentity {
  version: string;
  buildId?: string;
  mode: "packaged" | "development";
  maxSchemaVersion?: number;
}

/**
 * Pairing rule (Change 026): packaged desktops reuse only exact builds;
 * development keeps looser protocol-only reuse so `npm run dev` workflows
 * stay unaffected. `RESTART_REQUIRED` means "Orca controller, same protocol,
 * not this exact build" — eligible for safe replacement, never silent mixing.
 */
export function evaluateControllerCompatibility(
  desktop: DesktopBuildIdentity,
  probed:
    | { kind: "identity"; identity: ControllerIdentity }
    | { kind: "foreign"; status?: number }
    | { kind: "absent" }
): ControllerCompatibilityVerdict {
  if (probed.kind === "absent") return "ABSENT";
  if (probed.kind === "foreign") return "FOREIGN_LISTENER";
  const identity = probed.identity;
  if (identity.protocol !== ORCA_PROTOCOL_VERSION) return "PROTOCOL_INCOMPATIBLE";
  if (
    typeof identity.maxSchemaVersion === "number" &&
    typeof desktop.maxSchemaVersion === "number" &&
    identity.maxSchemaVersion > desktop.maxSchemaVersion
  ) {
    return "DATABASE_INCOMPATIBLE";
  }
  const sameVersion = identity.version === desktop.version;
  const sameBuild =
    (identity.buildId ?? null) === (desktop.buildId ?? null);
  if (sameVersion && sameBuild) return "EXACT_MATCH";
  if (desktop.mode === "development") {
    // Development deliberately tolerates version skew against an already
    // running controller; it never owns installed-upgrade semantics.
    return "COMPATIBLE_VERSION_SKEW";
  }
  return "RESTART_REQUIRED";
}

export type ReadinessStatus = "READY" | "ACTION_REQUIRED" | "OPTIONAL" | "UNKNOWN";

export interface ReadinessCheck {
  id: string;
  title: string;
  status: ReadinessStatus;
  /** Blocking ACTION_REQUIRED checks make the core runtime not-ready. */
  blocking: boolean;
  detail?: string;
  remediation?: string;
}

export interface SystemReadinessResponse {
  ready: boolean;
  identity: ControllerIdentity;
  checks: ReadinessCheck[];
}

export interface ControllerIdentityResponse {
  identity: ControllerIdentity;
  dataDir: string;
}

export type DesktopStartupState =
  | "CHECKING_CONTROLLER"
  | "STARTING_CONTROLLER"
  | "WAITING_FOR_READY"
  | "CONNECTED"
  | "PORT_CONFLICT"
  | "INCOMPATIBLE_CONTROLLER"
  | "DATABASE_TOO_NEW"
  | "RESTART_PENDING"
  | "STARTUP_FAILED";

export const TERMINAL_DESKTOP_STARTUP_STATES: readonly DesktopStartupState[] = [
  "PORT_CONFLICT",
  "INCOMPATIBLE_CONTROLLER",
  "DATABASE_TOO_NEW",
  "RESTART_PENDING",
  "STARTUP_FAILED"
];

/**
 * Product-level contracts for Windows productization (Change 025):
 * controller build identity, singleton runtime ownership, system readiness,
 * and the desktop startup state machine.
 */

/** Bump on any breaking change to the loopback controller contract surface. */
export const ORCA_PROTOCOL_VERSION = 1;

export interface ControllerIdentity {
  service: "orca-controller";
  version: string;
  protocol: number;
  pid: number;
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
  | "STARTUP_FAILED";

export const TERMINAL_DESKTOP_STARTUP_STATES: readonly DesktopStartupState[] = [
  "PORT_CONFLICT",
  "INCOMPATIBLE_CONTROLLER",
  "STARTUP_FAILED"
];

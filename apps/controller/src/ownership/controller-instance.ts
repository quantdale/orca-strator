import { randomUUID } from "node:crypto";

/**
 * Change 028 (D1): every controller process gets a fresh cryptographic
 * instance id (a startup epoch). It is written to every actor/process
 * ownership record so an old controller's ownership can be distinguished from
 * the current process. It is NOT a secret and NOT an authentication token; do
 * not reuse the lifecycle controlToken for this purpose.
 */
export function generateControllerInstanceId(): string {
  return randomUUID();
}

export interface ControllerInstance {
  readonly instanceId: string;
}

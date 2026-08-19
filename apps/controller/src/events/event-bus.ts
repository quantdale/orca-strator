import { EventEmitter } from 'node:events';
import type { RepositoryMutationEvent } from '@orca/shared';

// Credentials embedded in git remote URLs (https://user:token@host/...) must never
// reach the UI websocket (Finding O). Redact them at the single event chokepoint.
const URL_CREDENTIAL_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/g;
const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api_key|privatekey)/i;

function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(URL_CREDENTIAL_RE, "$1***:***@") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? "***redacted***" : redactSecrets(val);
    }
    return out as unknown as T;
  }
  return value;
}

export class EventBus extends EventEmitter {
  publish(event: RepositoryMutationEvent): void {
    this.emit('event', redactSecrets(event));
  }

  subscribe(listener: (event: RepositoryMutationEvent) => void): () => void {
    this.on('event', listener);
    return () => {
      this.off('event', listener);
    };
  }
}

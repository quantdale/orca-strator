import { EventEmitter } from 'node:events';
import type { RepositoryMutationEvent } from '@orca/shared';

// Credentials embedded in git remote URLs (https://user:token@host/...) must never
// reach the UI websocket (Finding O). Redact them at the single event chokepoint.
const URL_CREDENTIAL_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/g;
const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api_key|privatekey)/i;

export function redactSecrets<T>(value: T): T {
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

export const MAX_REASON_CHARS = 512;
export const MAX_DATA_STRING = 2048;
export const MAX_DATA_JSON = 4096;

export function truncateString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function boundDataStrings(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") {
      let s = v;
      if (k === "reason" || k === "detail" || k === "failureReason" || k === "lastError" || k === "errorMessage") {
        s = truncateString(s, MAX_REASON_CHARS);
      }
      if (s.length > MAX_DATA_STRING) s = s.slice(0, MAX_DATA_STRING);
      out[k] = s;
    } else if (Array.isArray(v)) {
      out[k] = v.map((e) => typeof e === "string" && e.length > MAX_DATA_STRING ? e.slice(0, MAX_DATA_STRING) : e);
    } else {
      out[k] = v;
    }
  }
  // Ensure total JSON size bounded to MAX_DATA_JSON (4KiB) and also to 2KiB per eventBus payload.
  // If still over, iteratively truncate longest string field.
  let json = JSON.stringify(out);
  if (json.length > MAX_DATA_STRING) {
    // For EventBus payload bound (2KiB), truncate longest strings to fit.
    const keys = Object.keys(out).filter((k) => typeof out[k] === "string") as string[];
    // Sort by length descending
    keys.sort((a, b) => (out[b] as string).length - (out[a] as string).length);
    for (const k of keys) {
      if (json.length <= MAX_DATA_STRING) break;
      const s = out[k] as string;
      const over = json.length - MAX_DATA_STRING;
      const newLen = Math.max(0, s.length - over - 16);
      out[k] = s.slice(0, newLen) + (newLen < s.length ? "…[truncated]" : "");
      json = JSON.stringify(out);
    }
    if (json.length > MAX_DATA_STRING) {
      // Fallback: slice JSON directly and mark truncated
      const sliced = json.slice(0, MAX_DATA_STRING - 32) + "…[truncated]";
      try {
        const parsed = JSON.parse(sliced);
        return parsed;
      } catch {
        out["_truncated"] = true;
        // ensure we stay within bound by dropping largest field
        for (const k of keys) {
          if (JSON.stringify(out).length <= MAX_DATA_STRING) break;
          delete out[k];
        }
      }
    }
  }
  return out;
}

export function boundDataJson(data: Record<string, unknown>, max = MAX_DATA_JSON): Record<string, unknown> {
  let out = { ...data };
  let json = JSON.stringify(out);
  if (json.length <= max) return out;
  // Truncate longest string fields first
  const stringKeys = Object.keys(out).filter((k) => typeof out[k] === "string") as string[];
  stringKeys.sort((a, b) => (out[b] as string).length - (out[a] as string).length);
  for (const k of stringKeys) {
    if (json.length <= max) break;
    const s = out[k] as string;
    const over = json.length - max;
    const newLen = Math.max(64, s.length - over - 20);
    out[k] = s.slice(0, newLen) + "…[truncated]";
    json = JSON.stringify(out);
  }
  if (json.length > max) {
    // Last resort: truncate json string and store as detail
    json = json.slice(0, max);
    return { _truncated: true, detail: truncateString(json, max) } as unknown as Record<string, unknown>;
  }
  return out;
}

export class EventBus extends EventEmitter {
  // Ledger, reconcile, and one listener per WS client all attach here, so Node's
  // default cap of 10 would start warning around ~8 concurrent UI sessions.
  constructor() {
    super();
    this.setMaxListeners(64);
  }

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

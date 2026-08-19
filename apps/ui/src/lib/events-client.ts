import type { RepositoryMutationEvent } from "@orca/shared";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function getEventsWsUrl(customLocation?: { protocol: string; host: string }): string {
  const loc = customLocation || (typeof window !== "undefined" ? window.location : { protocol: "http:", host: "127.0.0.1:47100" });
  const wsProto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${loc.host}/api/events`;
}

export interface EventsClientOptions {
  reconnectDelayMs?: number;
}

export class EventsClient {
  private ws: WebSocket | null = null;
  private listeners: Set<(event: RepositoryMutationEvent) => void> = new Set();
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private reconnectTimer: any = null;
  private shouldReconnect = true;
  private currentStatus: ConnectionStatus = "disconnected";
  private refCount = 0;
  private reconnectDelayMs = 2000;

  constructor(
    private readonly getUrl: () => string = getEventsWsUrl,
    options?: EventsClientOptions
  ) {
    if (options?.reconnectDelayMs !== undefined) {
      this.reconnectDelayMs = options.reconnectDelayMs;
    }
  }

  getStatus(): ConnectionStatus {
    return this.currentStatus;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.statusListeners.forEach((l) => l(status));
    }
  }

  connect(): void {
    this.shouldReconnect = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const WSClass = typeof WebSocket !== "undefined" ? WebSocket : (globalThis as any).WebSocket;
    if (!WSClass) {
      return;
    }

    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      try {
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onclose = null;
        oldWs.onerror = null;
        oldWs.close();
      } catch {}
    }

    this.setStatus("connecting");
    const url = this.getUrl();

    try {
      const socket = new WSClass(url);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws === socket) {
          this.setStatus("connected");
        }
      };

      socket.onmessage = (e: any) => {
        try {
          const event: RepositoryMutationEvent = JSON.parse(e.data);
          this.listeners.forEach((listener) => listener(event));
        } catch {
          // Ignore parse errors for keepalives
        }
      };

      socket.onclose = () => {
        if (this.ws === socket) {
          this.ws = null;
          this.setStatus("disconnected");
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        }
      };

      socket.onerror = () => {
        if (this.ws === socket) {
          this.setStatus("disconnected");
          try {
            socket.close();
          } catch {}
        }
      };
    } catch {
      this.setStatus("disconnected");
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  subscribe(listener: (event: RepositoryMutationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {}
    }
    this.setStatus("disconnected");
  }

  retain(): () => void {
    this.refCount++;
    if (this.refCount === 1) {
      this.connect();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) {
        this.disconnect();
      }
    };
  }
}

export const eventsClient = new EventsClient();

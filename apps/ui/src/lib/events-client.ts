import type { RepositoryMutationEvent } from "@orca/shared";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function getEventsWsUrl(customLocation?: { protocol: string; host: string }): string {
  const loc = customLocation || (typeof window !== "undefined" ? window.location : { protocol: "http:", host: "127.0.0.1:47100" });
  const wsProto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${loc.host}/api/events`;
}

export class EventsClient {
  private ws: WebSocket | null = null;
  private listeners: Set<(event: RepositoryMutationEvent) => void> = new Set();
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;
  private currentStatus: ConnectionStatus = "disconnected";

  constructor(private readonly getUrl: () => string = getEventsWsUrl) {}

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
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      return;
    }

    if (this.ws) {
      this.ws.close();
    }

    this.setStatus("connecting");
    const url = this.getUrl();

    try {
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws === socket) {
          this.setStatus("connected");
        }
      };

      socket.onmessage = (e) => {
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
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        if (this.ws === socket) {
          this.ws = null;
          this.setStatus("disconnected");
          socket.close();
        }
      };
    } catch {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
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
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }
}

export const eventsClient = new EventsClient();

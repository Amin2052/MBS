export type RealtimeMessageEvent<T = unknown> = {
  type: "message.created" | "message.updated" | "message.deleted" | "message.read";
  payload: T;
};

export type RealtimeMessagingOptions = {
  wsUrl?: string;
  onEvent: (event: RealtimeMessageEvent) => void;
  reconnectMs?: number;
};

export class RealtimeMessagingService {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: number | null = null;

  constructor(private readonly options: RealtimeMessagingOptions) {}

  connect(): void {
    if (!this.options.wsUrl || this.stopped || this.socket) return;
    try {
      this.socket = new WebSocket(this.options.wsUrl);
      this.socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.type) this.options.onEvent(parsed);
        } catch {
          // Ignore malformed events without breaking the messaging UI.
        }
      };
      this.socket.onclose = () => {
        this.socket = null;
        if (!this.stopped) {
          this.reconnectTimer = window.setTimeout(
            () => this.connect(),
            this.options.reconnectMs ?? 3000,
          );
        }
      };
      this.socket.onerror = () => this.socket?.close();
    } catch {
      this.socket = null;
    }
  }

  send(event: RealtimeMessageEvent): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}

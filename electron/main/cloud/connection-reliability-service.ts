export type ConnectionState = "online" | "offline" | "reconnecting";

export type ConnectionSnapshot = {
  state: ConnectionState;
  changedAt: number;
  failures: number;
};

export class ConnectionReliabilityService {
  private snapshot: ConnectionSnapshot = {
    state: typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
    changedAt: Date.now(),
    failures: 0,
  };

  getSnapshot(): ConnectionSnapshot {
    return { ...this.snapshot };
  }

  markOnline(): void {
    this.snapshot = { state: "online", changedAt: Date.now(), failures: 0 };
  }

  markOffline(): void {
    this.snapshot = { ...this.snapshot, state: "offline", changedAt: Date.now() };
  }

  markFailure(): number {
    const failures = this.snapshot.failures + 1;
    this.snapshot = { state: "reconnecting", changedAt: Date.now(), failures };
    return failures;
  }

  retryDelay(baseMs = 1000, maxMs = 30000): number {
    const exponent = Math.max(0, this.snapshot.failures - 1);
    return Math.min(maxMs, baseMs * (2 ** exponent));
  }
}

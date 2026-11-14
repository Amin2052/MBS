export class SyncIdempotency {
  private readonly completed = new Set<string>();

  has(operationId: string): boolean {
    return this.completed.has(operationId);
  }

  markCompleted(operationId: string): void {
    this.completed.add(operationId);
  }

  clear(): void {
    this.completed.clear();
  }
}

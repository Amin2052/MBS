export type SyncQueueOperation = "create" | "update" | "delete";

export type SyncQueueItem<T = unknown> = {
  id: string;
  collection: string;
  operation: SyncQueueOperation;
  payload: T;
  queuedAt: number;
};

export class OfflineSyncQueue<T = unknown> {
  private items: SyncQueueItem<T>[] = [];

  enqueue(item: Omit<SyncQueueItem<T>, "queuedAt">): void {
    this.items.push({ ...item, queuedAt: Date.now() });
  }

  peek(): SyncQueueItem<T> | undefined {
    return this.items[0];
  }

  remove(id: string): void {
    this.items = this.items.filter(item => item.id !== id);
  }

  list(): SyncQueueItem<T>[] {
    return [...this.items].sort((a, b) => a.queuedAt - b.queuedAt);
  }

  clear(): void {
    this.items = [];
  }
}

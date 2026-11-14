export type SyncRevision = {
  version: number;
  updatedAt: number;
  updatedBy?: string;
};

export type SyncEnvelope<T> = {
  id: string;
  data: T;
  revision: SyncRevision;
};

export type ConflictResult<T> =
  | { status: "accepted"; value: SyncEnvelope<T> }
  | { status: "conflict"; local: SyncEnvelope<T>; remote: SyncEnvelope<T> };

export function acceptIfCurrent<T>(
  local: SyncEnvelope<T>,
  remote: SyncEnvelope<T>,
): ConflictResult<T> {
  if (remote.revision.version !== local.revision.version) {
    return { status: "conflict", local, remote };
  }
  return {
    status: "accepted",
    value: {
      ...remote,
      revision: {
        ...remote.revision,
        version: remote.revision.version + 1,
        updatedAt: Date.now(),
      },
    },
  };
}

export function newerRevision(a: SyncRevision, b: SyncRevision): SyncRevision {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

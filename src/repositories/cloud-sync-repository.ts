import { getDatabase } from "../database/database";

// See the schema comment in src/database/database.ts (search
// "REAL BIDIRECTIONAL CLOUD SYNC") for why these three tables exist.

export type CloudSyncMapping = {
    table_name: string;
    cloud_local_id: string;
    local_row_id: number;
    revision: number;
    content_hash: string | null;
    has_conflict: number;
    last_synced_at: string;
};

export function getMappingByCloudId(table: string, cloudLocalId: string): CloudSyncMapping | undefined {
    const db = getDatabase();
    return db
        .prepare(`SELECT * FROM cloud_sync_map WHERE table_name=? AND cloud_local_id=?`)
        .get(table, cloudLocalId) as CloudSyncMapping | undefined;
}

export function getMappingByLocalRow(table: string, localRowId: number): CloudSyncMapping | undefined {
    const db = getDatabase();
    return db
        .prepare(`SELECT * FROM cloud_sync_map WHERE table_name=? AND local_row_id=?`)
        .get(table, localRowId) as CloudSyncMapping | undefined;
}

// contentHash: a hash of the row's synced fields at the moment this
// mapping was recorded (whether from a successful push or a pull-applied
// update) -- see computeContentHash() in cloud-sync-manager.ts. This is
// what lets a later sync cycle tell "this local row hasn't changed since
// it was last synced, no need to push it again" from "this genuinely
// changed and needs pushing" -- without it, every mapped row gets pushed
// on every single cycle regardless of whether it changed (confirmed as a
// real bug by tests/main/entry-bidirectional-sync.ts: a record pulled
// from another device got pushed right back, unchanged, on the very next
// cycle, which server-side still counts as a real update and bumps
// sync_revision -- creating spurious "conflicts" against a device that
// never actually saw a real edit).
//
// Any call to this function clears has_conflict: reaching a genuinely
// successful sync (a push that succeeded, or a pull actually applied) for
// this record means whatever unresolved state existed before is now
// moot -- either this device's edit won and is now the cloud's current
// version, or the pull path (see markMappingConflicted below and its use
// in cloud-sync-manager.ts) explicitly re-applied the cloud's version
// on the user's behalf, both of which are legitimate resolutions.
export function upsertMapping(table: string, cloudLocalId: string, localRowId: number, revision: number, contentHash: string | null): void {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO cloud_sync_map(table_name, cloud_local_id, local_row_id, revision, content_hash, has_conflict, last_synced_at)
        VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP)
        ON CONFLICT(table_name, cloud_local_id) DO UPDATE SET
            local_row_id=excluded.local_row_id,
            revision=excluded.revision,
            content_hash=excluded.content_hash,
            has_conflict=0,
            last_synced_at=CURRENT_TIMESTAMP
    `).run(table, cloudLocalId, localRowId, revision, contentHash);
}

// Marks a mapping as having an unresolved conflict, WITHOUT touching its
// revision or content_hash -- see the comment in cloud-sync-manager.ts's
// syncTable() at the CloudSyncRevisionConflictError catch branch for why
// those must stay exactly as they were. The pull path (applyPulledRow())
// checks this flag and deliberately does NOT overwrite the local row
// while it's set, so a losing device's un-reconciled edit survives on
// disk until a person (or a future explicit "accept remote"/"keep mine
// and retry" action -- not built yet, see checkpoint) resolves it,
// instead of a same-cycle pull silently clobbering it with the winning
// side's version right after the push was correctly rejected.
export function markMappingConflicted(table: string, cloudLocalId: string): void {
    const db = getDatabase();
    db.prepare(`UPDATE cloud_sync_map SET has_conflict=1 WHERE table_name=? AND cloud_local_id=?`).run(table, cloudLocalId);
}

export function deleteMappingByLocalRow(table: string, localRowId: number): void {
    const db = getDatabase();
    db.prepare(`DELETE FROM cloud_sync_map WHERE table_name=? AND local_row_id=?`).run(table, localRowId);
}

export function getSyncCursor(table: string): string {
    const db = getDatabase();
    const row = db.prepare(`SELECT last_synced_at FROM sync_cursor WHERE table_name=?`).get(table) as { last_synced_at: string } | undefined;
    return row?.last_synced_at ?? "1970-01-01T00:00:00.000Z";
}

export function setSyncCursor(table: string, isoTimestamp: string): void {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO sync_cursor(table_name, last_synced_at) VALUES(?,?)
        ON CONFLICT(table_name) DO UPDATE SET last_synced_at=excluded.last_synced_at
    `).run(table, isoTimestamp);
}

export type OfflineQueueItem = {
    id: string;
    collection: string;
    operation: "create" | "update" | "delete";
    payload: string;
    queued_at: string;
    attempts: number;
    last_error: string | null;
};

export function enqueueOfflineOperation(item: { id: string; collection: string; operation: "create" | "update" | "delete"; payload: unknown }): void {
    const db = getDatabase();
    // ON CONFLICT(id) DO UPDATE: a later write to the SAME record while
    // still offline (e.g. two edits to the same product before
    // reconnecting) collapses into one queued operation carrying the
    // latest payload, rather than piling up redundant queue entries that
    // would just replay in order to the same end state anyway.
    db.prepare(`
        INSERT INTO sync_offline_queue(id, collection, operation, payload, queued_at)
        VALUES(?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET operation=excluded.operation, payload=excluded.payload
    `).run(item.id, item.collection, item.operation, JSON.stringify(item.payload));
}

export function listOfflineQueue(): OfflineQueueItem[] {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM sync_offline_queue ORDER BY queued_at ASC`).all() as OfflineQueueItem[];
}

export function removeOfflineQueueItem(id: string): void {
    const db = getDatabase();
    db.prepare(`DELETE FROM sync_offline_queue WHERE id=?`).run(id);
}

export function recordOfflineQueueFailure(id: string, errorMessage: string): void {
    const db = getDatabase();
    db.prepare(`UPDATE sync_offline_queue SET attempts=attempts+1, last_error=? WHERE id=?`).run(errorMessage, id);
}

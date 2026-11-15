-- 0006_workspace_reset_epoch.sql
--
-- Cloud reset needs a way to tell every already-synced device that the
-- central copy it is holding is no longer the truth. Deleting rows alone is
-- not enough: an offline desktop still has (a) its own copies, (b) a
-- cloud_sync_map pointing at cloud rows that no longer exist, and (c) an
-- offline queue that may still be holding a create for a record the owner
-- just wiped. On its next cycle that device would treat the empty cloud as
-- "nothing changed" and push its local copies straight back, silently
-- undoing the reset.
--
-- reset_epoch is a per-workspace counter that only ever increases. A reset
-- bumps it; every write from a client carries the epoch it believes it is
-- syncing against (x-reset-epoch). A stale client is refused with 409
-- reset_epoch_mismatch instead of being allowed to recreate pre-reset
-- records, and only re-baselines (clears its sync bookkeeping) once it has
-- seen the new epoch.
--
-- Default 0 means "never reset", so existing workspaces need no data
-- migration and an un-migrated deployment behaves exactly as before.
ALTER TABLE workspaces ADD COLUMN reset_epoch INTEGER NOT NULL DEFAULT 0;

-- Append-only record of every central reset actually performed. Kept
-- separately from audit_log because it must survive the reset itself
-- (audit_log rows are tenant data too, so they are scoped/deleted like the
-- rest) and because a support engineer needs "who reset this workspace,
-- when, and with which scope" even after the business tables are empty.
CREATE TABLE IF NOT EXISTS workspace_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  reset_epoch INTEGER NOT NULL,
  requested_by TEXT,
  deleted_counts TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_resets_workspace ON workspace_resets(workspace_id, id);

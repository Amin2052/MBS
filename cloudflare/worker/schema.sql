-- Mooral Business Suite Central Cloud (Cloudflare D1)
-- Uses the existing MBS business/auth schema already present in mooral-db.
-- This migration adds only the cloud synchronization layer.

CREATE TABLE IF NOT EXISTS cloud_records (
  workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, collection, record_id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_records_collection
  ON cloud_records(workspace_id, collection, updated_at);

CREATE INDEX IF NOT EXISTS idx_cloud_records_updated
  ON cloud_records(workspace_id, updated_at);

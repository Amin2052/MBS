-- Mooral Business Suite — sync cursor columns for real bidirectional sync.
--
-- CONTEXT: implementing the actual PC A <-> Cloud <-> PC B pull path
-- (previously push-only, see .claude/multi-company-sync-checkpoint.md)
-- needs a way to ask the Worker "give me only what changed since I last
-- asked", so a periodic sync tick doesn't re-fetch whole tables every
-- cycle (brief section 21: "Do NOT synchronize the entire database every
-- interval").
--
-- CORRECTION (caught by tests/main/entry-worker-tenant-isolation.ts
-- actually failing with "duplicate column name: updated_at", not by
-- inspection alone): an earlier pass through this migration's own header
-- claimed NONE of the business tables had an updated_at column in 0001.
-- That claim was wrong -- it came from a flawed grep/awk check (a pattern
-- mismatch on "TABLE_NAME (" vs "TABLE_NAME(" silently matched nothing
-- for several tables instead of erroring). Re-checked properly this time,
-- table by table, against the actual CREATE TABLE blocks in
-- 0001_mbs_core_schema.sql:
--   ALREADY HAD updated_at in 0001: products, customers, employees,
--     orders, transactions, invoices, certificates, employee_contracts.
--   DID NOT have updated_at in 0001 (confirmed missing): accounts,
--     journal_entries, ledger_entries, inventory_transactions,
--     notifications.
-- This migration now only ADD COLUMNs updated_at where it was actually
-- missing, and adds sync_revision (which no table had) everywhere. The
-- Worker's INSERT/UPDATE paths (handleData in worker/index.js) stamp
-- updated_at with CURRENT_TIMESTAMP on every write regardless of which
-- migration originally created the column, and its GET-list path accepts
-- an optional ?since=<ISO timestamp> query param filtering
-- WHERE updated_at > ?, ordered by updated_at ASC so a resumed pull picks
-- up exactly where the last one left off.
--
-- SAFETY: purely additive, same safety profile as 0002. Existing rows in
-- a genuinely-new updated_at column backfill to CURRENT_TIMESTAMP (the
-- time this migration runs) -- meaning the very first incremental pull
-- after this migration ships will still see all pre-existing rows in
-- those 5 tables as "changed" once, which is correct and desired: every
-- existing device needs a first full pull to populate its local
-- cloud_sync_map, since pre-this-session there was no pull at all. For
-- the 8 tables that already had updated_at, existing values (whatever
-- they already were, likely all CURRENT_TIMESTAMP-at-insert-time from
-- 0001's own DEFAULT) are left untouched -- only sync_revision is added.

-- sync_revision: a simple monotonic per-row version counter, exactly
-- matching sync-conflict-service.ts's SyncRevision.version. INSERT starts
-- a row at 1; every UPDATE increments it (see worker/index.js's
-- handleData PATCH/POST-upsert paths). This is what acceptIfCurrent()
-- compares to detect a genuine conflict (both sides changed a record
-- neither had seen the other's latest revision of) instead of just
-- always overwriting with whichever write happens to land last
-- ("last-write-wins", which the brief explicitly rules out).

-- Tables that already had updated_at in 0001 -- add sync_revision only.
ALTER TABLE products ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employee_contracts ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE transactions ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE certificates ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;

-- Tables that genuinely lacked updated_at in 0001 -- add both columns.
ALTER TABLE inventory_transactions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE inventory_transactions ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE accounts ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journal_entries ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE journal_entries ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ledger_entries ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE ledger_entries ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notifications ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE notifications ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_products_workspace_updated ON products(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_workspace_updated ON customers(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_employees_workspace_updated ON employees(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_workspace_updated ON employee_contracts(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_orders_workspace_updated ON orders(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_workspace_updated ON inventory_transactions(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_transactions_workspace_updated ON transactions(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_accounts_workspace_updated ON accounts(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_journal_entries_workspace_updated ON journal_entries(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_workspace_updated ON ledger_entries(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_certificates_workspace_updated ON certificates(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_updated ON notifications(workspace_id, updated_at);

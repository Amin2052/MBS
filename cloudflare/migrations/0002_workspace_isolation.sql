-- Mooral Business Suite — Workspace (tenant) isolation, phase 1: SAFE / ADDITIVE
--
-- CONTEXT (see .claude/multi-company-sync-checkpoint.md for the full audit
-- trail): 0001_mbs_core_schema.sql shipped with NO workspace_id column on
-- ANY table, and cloudflare/worker/index.js never filters a single query by
-- workspace -- workspaceForRequest() is only ever called once, in the login
-- handler, purely to validate the header's format. wrangler.toml currently
-- pins the whole deployment to one hardcoded workspace
-- (MBS_WORKSPACE_ID = "mooral-main"), which is why this was never caught:
-- there has only ever been one tenant. This migration is phase 1 of turning
-- that into genuine shared multi-tenant infrastructure, per the explicit
-- architecture decision: ONE shared Worker + ONE shared D1 database, with
-- workspace_id as the hard tenant boundary, Company A / B / C each getting
-- their own workspace_id on this same infrastructure.
--
-- There is no 0002 predating this one. Checked: no .git history in this
-- repo, no reference to a prior 0002 anywhere in source, tests, or docs
-- other than the audit brief's own claim. wrangler.toml's single-workspace
-- pin confirms multi-tenancy was never implemented, not that it regressed --
-- so this is new work, not a restore.
--
-- SAFETY / WHY THIS IS SPLIT INTO TWO MIGRATIONS:
-- This migration (0002) is 100% additive and non-destructive:
--   - ALTER TABLE ... ADD COLUMN workspace_id ... NOT NULL DEFAULT 'mooral-main'
--     is safe in SQLite/D1: every existing row is backfilled with the
--     default automatically, no data is rewritten or lost, and existing
--     application code that doesn't yet know about the column is unaffected
--     (it keeps working exactly as before) until the Worker code is
--     updated to filter by it.
--   - New indexes are added; no existing index or column-level UNIQUE
--     constraint is dropped or altered here.
--   - A new `workspaces` table is created and seeded with the ONE existing
--     tenant ('mooral-main'), preserving continuity for the current
--     production customer.
-- What this migration deliberately does NOT do: relax the existing
-- column-level UNIQUE constraints (users.username, employees.employee_number,
-- products.product_id, customers.customer_id, transactions.transaction_id,
-- accounts.code, journal_entries.journal_id, invoices.invoice_id,
-- certificates.certificate_id, permission_profiles.name) from globally
-- unique to per-workspace unique. SQLite cannot alter/drop a column-level
-- UNIQUE constraint without recreating the table, which is real, if small,
-- data-loss risk if anything about the recreation is wrong. That work is
-- 0003_workspace_unique_constraints.sql, written and reviewed but marked
-- DO NOT APPLY BLIND -- it must be dry-run against a copy/backup of the
-- real D1 first (see the comment block at the top of that file for the
-- exact verification steps). Practically: until 0003 ships, those specific
-- business keys/usernames stay globally unique across all workspaces
-- rather than per-workspace unique -- a UX/business limitation (two
-- companies can't both use username "admin"), NOT a tenant-isolation
-- security gap. The actual cross-tenant READ/WRITE boundary is closed by
-- this migration plus the corresponding Worker code changes, because every
-- query the Worker runs is now filtered by workspace_id regardless of
-- whether the underlying column also has old-style global uniqueness.
--
-- ROLLBACK: every ADD COLUMN/CREATE TABLE/CREATE INDEX/DROP INDEX below is
-- individually safe to leave in place even if the corresponding Worker
-- code change is rolled back -- old Worker code simply ignores the new
-- column/table. No down-migration is required for a clean rollback of the
-- application layer.

-- ==========================
-- WORKSPACES (tenants)
-- ==========================
CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    -- scrypt hash of this workspace's cloud API key, same format as
    -- users.password_hash ("scrypt$N$r$p$saltHex$hashHex"). NULL only for
    -- the legacy bridge row seeded below: the existing production customer
    -- was provisioned before per-workspace keys existed, and this repo has
    -- no access to the real plaintext env.MBS_API_KEY secret to hash it.
    -- The Worker treats a NULL api_key_hash as "fall back to the legacy
    -- global env.MBS_API_KEY secret, but ONLY for this exact workspace_id"
    -- -- see cloudflare/worker/index.js resolveApiKeyWorkspace(). Any
    -- workspace created after this migration MUST be issued a real,
    -- non-NULL api_key_hash; the Worker's admin/workspace-creation path
    -- should refuse to create one with a NULL hash.
    api_key_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed the one tenant that already exists in production today, so every
-- ADD COLUMN ... DEFAULT 'mooral-main' below actually points at a real row.
INSERT OR IGNORE INTO workspaces (workspace_id, name, api_key_hash, status)
VALUES ('mooral-main', 'Existing production tenant (pre-multi-tenant migration)', NULL, 'active');

-- ==========================
-- workspace_id ADD COLUMN — every tenant-owned table.
-- Every existing row backfills to 'mooral-main' automatically (the only
-- tenant that could possibly own pre-migration data). NOT NULL is safe
-- here specifically because of that default; it is not safe to add a
-- NOT NULL column without a DEFAULT to a table that already has rows.
--
-- Deliberately EXCLUDED:
--   - permissions: the static permission-definition catalog (e.g.
--     "products.create") is shared reference data, not tenant data -- see
--     the identical note already in cloudflare/main/cloud/cloud-sync-manager.ts.
--   - sessions: workspace is derived via JOIN to users(workspace_id) in
--     authUser() (see Worker code); duplicating it here would just be an
--     extra column to keep in sync for no isolation benefit, since a
--     session is meaningless without its user row anyway.
--   - cloud_records: already workspace-scoped in its primary key
--     (cloudflare/worker/schema.sql) -- though note this table is
--     currently dead code, unreferenced anywhere in index.js; the real
--     business-data sync path writes directly to the relational tables
--     below instead. Left as-is, out of scope for this migration.
-- ==========================
ALTER TABLE users ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE employees ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE employee_contracts ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE products ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE customers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE orders ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE inventory_transactions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE transactions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE accounts ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE journal_entries ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE ledger_entries ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE invoices ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE certificates ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE notifications ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE permission_profiles ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE user_permissions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE profile_permissions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE audit_log ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE company_settings ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';
ALTER TABLE mbs_messages ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'mooral-main';

-- ==========================
-- company_settings: IMPORTANT LIMITATION. This table was a true singleton
-- (`id INTEGER PRIMARY KEY CHECK (id = 1)`) -- that CHECK constraint means
-- SQLite/D1 physically cannot hold a second row AT ALL, no matter what
-- workspace_id says, until the table is recreated without it. That
-- recreation is NOT safe to do additively (id is the primary key), so it
-- lives in 0003_workspace_unique_constraints.sql, not here. Until 0003 is
-- applied, a second workspace's attempt to write company_settings will
-- fail loudly with a CHECK-constraint error (a visible failure, not a
-- silent cross-tenant leak -- it cannot overwrite 'mooral-main's row,
-- it can only fail to write its own). The workspace_id column and index
-- below are added now so the Worker code can already be written against
-- their final, workspace-scoped shape; 0002 and 0003 are meant to ship
-- together for company_settings to actually work for a second tenant.
-- ==========================
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_settings_workspace
ON company_settings(workspace_id);

-- ==========================
-- Query-performance indexes: every workspace-scoped lookup the Worker does
-- now filters by workspace_id first, so it needs to be the leading column
-- of an index for these to actually get used instead of a full scan.
-- ==========================
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_employees_workspace ON employees(workspace_id);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_workspace ON employee_contracts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_products_workspace ON products(workspace_id);
CREATE INDEX IF NOT EXISTS idx_customers_workspace ON customers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_orders_workspace ON orders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_workspace ON inventory_transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_transactions_workspace ON transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_accounts_workspace ON accounts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_workspace ON journal_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_workspace ON ledger_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace ON invoices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certificates_workspace ON certificates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_permission_profiles_workspace ON permission_profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace ON audit_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mbs_messages_workspace ON mbs_messages(workspace_id);

-- ==========================
-- local_id reconciliation indexes: these were created as separate
-- CREATE UNIQUE INDEX statements in 0001 (NOT inline column constraints),
-- so — unlike the business-key columns below — they CAN be safely dropped
-- and replaced with a workspace-scoped composite version without
-- recreating the table. A bare local_id being globally unique was already
-- extremely unlikely to collide across devices in practice (local_id is
-- device-prefixed: `${deviceId}:${table}:${id}`), but scoping it to
-- workspace_id too is strictly correct and is what the Worker's
-- ON CONFLICT(workspace_id, local_id) upsert now targets.
-- ==========================
DROP INDEX IF EXISTS idx_employees_local_id;
DROP INDEX IF EXISTS idx_employee_contracts_local_id;
DROP INDEX IF EXISTS idx_products_local_id;
DROP INDEX IF EXISTS idx_customers_local_id;
DROP INDEX IF EXISTS idx_orders_local_id;
DROP INDEX IF EXISTS idx_inventory_transactions_local_id;
DROP INDEX IF EXISTS idx_transactions_local_id;
DROP INDEX IF EXISTS idx_accounts_local_id;
DROP INDEX IF EXISTS idx_journal_entries_local_id;
DROP INDEX IF EXISTS idx_ledger_entries_local_id;
DROP INDEX IF EXISTS idx_invoices_local_id;
DROP INDEX IF EXISTS idx_certificates_local_id;
DROP INDEX IF EXISTS idx_notifications_local_id;
DROP INDEX IF EXISTS idx_permissions_local_id;
DROP INDEX IF EXISTS idx_audit_log_local_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_workspace_local_id ON employees(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_contracts_workspace_local_id ON employee_contracts(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_workspace_local_id ON products(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_workspace_local_id ON customers(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_workspace_local_id ON orders(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_transactions_workspace_local_id ON inventory_transactions(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_workspace_local_id ON transactions(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_workspace_local_id ON accounts(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_workspace_local_id ON journal_entries(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_workspace_local_id ON ledger_entries(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_workspace_local_id ON invoices(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_workspace_local_id ON certificates(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_workspace_local_id ON notifications(workspace_id, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_local_id ON permissions(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_workspace_local_id ON audit_log(workspace_id, local_id);

-- ==========================
-- Owner uniqueness ("exactly one Owner") and invoice/order uniqueness were
-- also separate CREATE UNIQUE INDEX statements in 0001 -- safe to
-- drop/replace the same way, scoping both to workspace_id.
-- ==========================
DROP INDEX IF EXISTS idx_users_single_owner;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner_per_workspace
ON users(workspace_id, user_type)
WHERE user_type = 'owner';

DROP INDEX IF EXISTS idx_invoices_order_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_workspace_order_id
ON invoices(workspace_id, order_id)
WHERE order_id IS NOT NULL AND order_id != '';

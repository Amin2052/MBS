-- Mooral Business Suite — Workspace isolation, phase 2: RELAX GLOBAL
-- UNIQUE CONSTRAINTS TO PER-WORKSPACE.
--
-- ============================================================
-- DO NOT APPLY THIS TO PRODUCTION D1 WITHOUT FIRST:
--   1. Exporting/backing up the real production D1 database
--      (`wrangler d1 export mooral-db --output backup-before-0003.sql`).
--   2. Restoring that export into a LOCAL or STAGING D1
--      (`wrangler d1 execute mooral-db-staging --local --file=backup-before-0003.sql`,
--      or a separate staging database_id in wrangler.toml).
--   3. Applying 0002 then this file to that staging copy and verifying:
--        - row counts match before/after for every table touched below
--        - `PRAGMA foreign_key_check` reports no violations
--        - a real login, a real record create/update/delete, and a real
--          username/business-key conflict all behave correctly against
--          the recreated tables
--   4. Only then applying to production, ideally during a maintenance
--      window, with the export from step 1 kept as a rollback path.
-- This migration was written and reviewed but COULD NOT be tested against
-- the real production D1 in this session (no live Cloudflare/D1 access
-- was available). Table recreation is the one D1/SQLite operation where a
-- mistake is genuinely destructive, so treat this file as a reviewed DRAFT,
-- not a verified migration, until the steps above have actually been run.
-- ============================================================
--
-- WHAT THIS DOES AND WHY IT'S NEEDED
-- 0002 added workspace_id to every tenant table and closed the actual
-- cross-tenant READ/WRITE security boundary (every Worker query is now
-- workspace-filtered). What 0002 could NOT do without recreating tables is
-- relax the pre-existing column-level UNIQUE constraints below from
-- globally-unique to unique-within-a-workspace, because SQLite has no
-- ALTER TABLE ... DROP CONSTRAINT / ALTER COLUMN. Left as-is, these stay
-- global forever: e.g. once Company A registers username "admin", NO
-- other company could ever use "admin", and once Company A's device
-- generates product code "PRD-000001", no other company could ever use
-- that code either. That's a real business/UX limitation the brief's test
-- matrix explicitly calls out ("same username where allowed", "same
-- business number in separate workspaces"), even though it is NOT a
-- tenant-isolation security gap (0002 already prevents any cross-workspace
-- read/write regardless of this).
--
-- Tables recreated: users, employees, products, customers, transactions,
-- accounts, journal_entries, invoices, certificates, permission_profiles,
-- company_settings (this last one for a different reason than the others
-- -- see its section below: it was a true singleton, id CHECK(id=1), not
-- just a globally-unique business key).
-- Pattern used (SQLite's documented safe procedure, since D1 supports the
-- same ALTER/CREATE/DROP primitives as SQLite -- see
-- https://www.sqlite.org/lang_altertable.html#otheralter):
--   1. CREATE the new table under a temp name with the SAME columns, but
--      the UNIQUE constraint rewritten as UNIQUE(workspace_id, <column>).
--   2. INSERT INTO new SELECT * FROM old, preserving every column
--      including the original `id` (critical: other tables reference
--      `id` values, e.g. employee_contracts.employee_id, sessions.user_id,
--      users.employee_id -- renumbering rowids here would silently break
--      those references).
--   3. DROP the old table.
--   4. ALTER TABLE new RENAME TO <original name>.
--   5. Recreate every index that pointed at the old table (SQLite does
--      NOT carry indexes over automatically when a table is dropped).
-- Each block is independent; if this migration fails partway, the
-- already-completed table swaps are still internally consistent (each
-- swap is atomic on its own table), but re-run any remaining blocks
-- rather than assuming a partial run is safe to leave as-is.

PRAGMA foreign_keys = OFF;

-- ---------- users ----------
CREATE TABLE users__new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_type TEXT NOT NULL DEFAULT 'employee',
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    employee_id INTEGER,
    permission_profile_id INTEGER,
    created_by INTEGER,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until DATETIME,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    recovery_key_hash TEXT,
    photo_blob BLOB,
    photo_mime TEXT DEFAULT '',
    full_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    designation TEXT DEFAULT '',
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, username)
);
INSERT INTO users__new SELECT id, user_type, username, password_hash, must_change_password, status,
  employee_id, permission_profile_id, created_by, failed_login_attempts, locked_until, last_login_at,
  created_at, updated_at, recovery_key_hash, photo_blob, photo_mime, full_name, email, phone, designation,
  workspace_id FROM users;
DROP TABLE users;
ALTER TABLE users__new RENAME TO users;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner_per_workspace ON users(workspace_id, user_type) WHERE user_type = 'owner';
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);

-- ---------- employees ----------
CREATE TABLE employees__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_number TEXT,
    photo_blob BLOB,
    photo_mime TEXT DEFAULT '',
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    gender TEXT DEFAULT '',
    date_of_birth DATETIME,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    department TEXT DEFAULT '',
    designation TEXT DEFAULT '',
    joining_date DATETIME,
    employment_status TEXT NOT NULL DEFAULT 'Active',
    salary REAL DEFAULT 0,
    emergency_contact_name TEXT DEFAULT '',
    emergency_contact_phone TEXT DEFAULT '',
    nid_passport TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    employment_type TEXT DEFAULT '',
    resignation_date DATETIME,
    contract_start_date DATETIME,
    contract_end_date DATETIME,
    identity_type TEXT DEFAULT '',
    identity_number TEXT DEFAULT '',
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, employee_number)
);
INSERT INTO employees__new SELECT local_id, id, employee_number, photo_blob, photo_mime, first_name, last_name,
  gender, date_of_birth, phone, email, address, department, designation, joining_date, employment_status, salary,
  emergency_contact_name, emergency_contact_phone, nid_passport, notes, created_at, updated_at, employment_type,
  resignation_date, contract_start_date, contract_end_date, identity_type, identity_number, workspace_id FROM employees;
DROP TABLE employees;
ALTER TABLE employees__new RENAME TO employees;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_workspace_local_id ON employees(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_employees_workspace ON employees(workspace_id);

-- ---------- products ----------
CREATE TABLE products__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT,
    name TEXT NOT NULL,
    category TEXT,
    sku TEXT,
    price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, product_id)
);
INSERT INTO products__new SELECT local_id, id, product_id, name, category, sku, price, stock, created_at,
  updated_at, workspace_id FROM products;
DROP TABLE products;
ALTER TABLE products__new RENAME TO products;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_workspace_local_id ON products(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_products_workspace ON products(workspace_id);

-- ---------- customers ----------
CREATE TABLE customers__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, customer_id)
);
INSERT INTO customers__new SELECT local_id, id, customer_id, name, phone, email, address, created_at, updated_at,
  workspace_id FROM customers;
DROP TABLE customers;
ALTER TABLE customers__new RENAME TO customers;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_workspace_local_id ON customers(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_customers_workspace ON customers(workspace_id);

-- ---------- transactions ----------
CREATE TABLE transactions__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    amount REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    reference_no TEXT,
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source_invoice_id TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, transaction_id)
);
INSERT INTO transactions__new SELECT local_id, id, transaction_id, type, category, description, amount,
  payment_method, reference_no, transaction_date, notes, created_at, updated_at, source_invoice_id, workspace_id
  FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions__new RENAME TO transactions;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_workspace_local_id ON transactions(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_transactions_workspace ON transactions(workspace_id);

-- ---------- accounts ----------
CREATE TABLE accounts__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    is_system INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, code)
);
INSERT INTO accounts__new SELECT local_id, id, code, name, type, is_system, created_at, workspace_id FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts__new RENAME TO accounts;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_workspace_local_id ON accounts(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_accounts_workspace ON accounts(workspace_id);

-- ---------- journal_entries ----------
CREATE TABLE journal_entries__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_id TEXT,
    entry_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    debit_account_id INTEGER NOT NULL,
    debit_account_name TEXT NOT NULL,
    credit_account_id INTEGER NOT NULL,
    credit_account_name TEXT NOT NULL,
    amount REAL NOT NULL,
    reference TEXT,
    reference_type TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, journal_id)
);
INSERT INTO journal_entries__new SELECT local_id, id, journal_id, entry_date, debit_account_id, debit_account_name,
  credit_account_id, credit_account_name, amount, reference, reference_type, description, created_at, workspace_id
  FROM journal_entries;
DROP TABLE journal_entries;
ALTER TABLE journal_entries__new RENAME TO journal_entries;
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_workspace_local_id ON journal_entries(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_workspace ON journal_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_journal_reference ON journal_entries(reference_type, reference);

-- ---------- invoices ----------
CREATE TABLE invoices__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id TEXT,
    order_id TEXT,
    customer_id TEXT,
    customer_name TEXT,
    items TEXT,
    subtotal REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    due REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    status TEXT DEFAULT 'Unpaid',
    invoice_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, invoice_id)
);
INSERT INTO invoices__new SELECT local_id, id, invoice_id, order_id, customer_id, customer_name, items, subtotal,
  discount, tax, total, paid, due, payment_method, status, invoice_date, due_date, notes, created_at, updated_at,
  workspace_id FROM invoices;
DROP TABLE invoices;
ALTER TABLE invoices__new RENAME TO invoices;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_workspace_local_id ON invoices(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace ON invoices(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_workspace_order_id ON invoices(workspace_id, order_id) WHERE order_id IS NOT NULL AND order_id != '';

-- ---------- certificates ----------
CREATE TABLE certificates__new (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id TEXT,
    customer_id TEXT,
    customer_name TEXT,
    product_id TEXT,
    product_name TEXT,
    title TEXT NOT NULL,
    description TEXT,
    issue_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiry_date DATETIME,
    status TEXT DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    certificate_category TEXT DEFAULT 'Employee',
    certificate_type TEXT DEFAULT '',
    employee_name TEXT DEFAULT '',
    serial_number TEXT DEFAULT '',
    employee_id TEXT DEFAULT '',
    employee_number_snapshot TEXT DEFAULT '',
    employee_name_snapshot TEXT DEFAULT '',
    department_snapshot TEXT DEFAULT '',
    designation_snapshot TEXT DEFAULT '',
    employment_type_snapshot TEXT DEFAULT '',
    joining_date_snapshot DATETIME,
    employment_status_snapshot TEXT DEFAULT '',
    product_name_snapshot TEXT DEFAULT '',
    category_snapshot TEXT DEFAULT '',
    sku_snapshot TEXT DEFAULT '',
    printed_at DATETIME,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, certificate_id)
);
INSERT INTO certificates__new SELECT local_id, id, certificate_id, customer_id, customer_name, product_id,
  product_name, title, description, issue_date, expiry_date, status, created_at, updated_at, certificate_category,
  certificate_type, employee_name, serial_number, employee_id, employee_number_snapshot, employee_name_snapshot,
  department_snapshot, designation_snapshot, employment_type_snapshot, joining_date_snapshot,
  employment_status_snapshot, product_name_snapshot, category_snapshot, sku_snapshot, printed_at, workspace_id
  FROM certificates;
DROP TABLE certificates;
ALTER TABLE certificates__new RENAME TO certificates;
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_workspace_local_id ON certificates(workspace_id, local_id);
CREATE INDEX IF NOT EXISTS idx_certificates_workspace ON certificates(workspace_id);

-- ---------- permission_profiles ----------
CREATE TABLE permission_profiles__new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id, name)
);
INSERT INTO permission_profiles__new SELECT id, name, description, is_system, created_at, updated_at, workspace_id
  FROM permission_profiles;
DROP TABLE permission_profiles;
ALTER TABLE permission_profiles__new RENAME TO permission_profiles;
CREATE INDEX IF NOT EXISTS idx_permission_profiles_workspace ON permission_profiles(workspace_id);

-- ---------- company_settings ----------
-- Was `id INTEGER PRIMARY KEY CHECK (id = 1)` -- a true singleton, not
-- just a globally-unique business key. That CHECK constraint physically
-- caps the table at ONE row total regardless of workspace_id, so unlike
-- the other tables above, company_settings CANNOT hold a second tenant's
-- settings at all until this recreation runs (0002 alone is insufficient
-- for this specific table -- see the note in 0002 where this column was
-- added). Recreated with a normal autoincrement id; workspace_id becomes
-- the real per-tenant key via the unique index below, which the Worker's
-- INSERT ... ON CONFLICT(workspace_id) upsert targets.
CREATE TABLE company_settings__new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT DEFAULT '', business_type TEXT DEFAULT '', owner_name TEXT DEFAULT '', phone TEXT DEFAULT '',
    mobile TEXT DEFAULT '', email TEXT DEFAULT '', website TEXT DEFAULT '', address TEXT DEFAULT '',
    city TEXT DEFAULT '', state TEXT DEFAULT '', postal_code TEXT DEFAULT '', country TEXT DEFAULT '',
    trade_license TEXT DEFAULT '', registration_number TEXT DEFAULT '', bin_vat TEXT DEFAULT '', tin TEXT DEFAULT '',
    currency TEXT DEFAULT 'BDT', timezone TEXT DEFAULT 'Asia/Dhaka', financial_year TEXT DEFAULT 'January - December',
    company_description TEXT DEFAULT '', invoice_footer TEXT DEFAULT '', report_footer TEXT DEFAULT '',
    notes TEXT DEFAULT '', logo_path TEXT DEFAULT '', tax_rate REAL DEFAULT 0, invoice_prefix TEXT DEFAULT 'INV-',
    payment_terms TEXT DEFAULT '', language TEXT DEFAULT 'en', theme TEXT DEFAULT 'light', logo_blob BLOB,
    logo_mime TEXT DEFAULT '', certificate_employee_prefix TEXT DEFAULT 'EMP-', certificate_product_prefix TEXT DEFAULT 'PRD-',
    certificate_auto_numbering INTEGER DEFAULT 1, certificate_qr_verification INTEGER DEFAULT 1,
    certificate_authorized_signature TEXT DEFAULT '', certificate_authorized_designation TEXT DEFAULT '',
    certificate_footer_text TEXT DEFAULT '', certificate_enable_expiry INTEGER DEFAULT 0,
    certificate_default_validity_days INTEGER DEFAULT 0, certificate_default_template TEXT DEFAULT 'classic',
    certificate_reuse_company_logo INTEGER DEFAULT 1, business_mode TEXT NOT NULL DEFAULT 'starter',
    security_max_login_attempts INTEGER NOT NULL DEFAULT 5, security_lockout_minutes INTEGER NOT NULL DEFAULT 15,
    security_session_timeout_minutes INTEGER NOT NULL DEFAULT 0, stock_low_threshold INTEGER NOT NULL DEFAULT 10,
    stock_default_warehouse TEXT DEFAULT 'Main Warehouse', stock_allow_negative INTEGER NOT NULL DEFAULT 0,
    stock_auto_reorder_alert INTEGER NOT NULL DEFAULT 1, sales_order_prefix TEXT DEFAULT 'ORD-',
    purchase_order_prefix TEXT DEFAULT 'PO-', sales_default_payment_terms TEXT DEFAULT 'Due on Receipt',
    purchase_default_payment_terms TEXT DEFAULT 'Net 30', sales_require_approval INTEGER NOT NULL DEFAULT 0,
    fiscal_year_start TEXT DEFAULT '01-01', accounting_default_tax_rate REAL DEFAULT 0,
    accounting_default_payment_method TEXT DEFAULT 'Cash', accounting_auto_post_journal INTEGER NOT NULL DEFAULT 1,
    payroll_pay_day INTEGER NOT NULL DEFAULT 1, payroll_salary_cycle TEXT DEFAULT 'Monthly',
    employee_probation_days INTEGER NOT NULL DEFAULT 90, payroll_overtime_rate REAL DEFAULT 1.5,
    notify_email_enabled INTEGER NOT NULL DEFAULT 1, notify_low_stock INTEGER NOT NULL DEFAULT 1,
    notify_order_updates INTEGER NOT NULL DEFAULT 1, notify_payment_due INTEGER NOT NULL DEFAULT 1,
    integration_api_key TEXT DEFAULT '', integration_webhook_url TEXT DEFAULT '', integration_enabled INTEGER NOT NULL DEFAULT 0,
    invoice_template_style TEXT DEFAULT 'classic', report_template_style TEXT DEFAULT 'classic',
    document_show_logo INTEGER NOT NULL DEFAULT 1, date_format TEXT DEFAULT 'DMY', number_format TEXT DEFAULT 'en-US',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT NOT NULL DEFAULT 'mooral-main',
    UNIQUE(workspace_id)
);
INSERT INTO company_settings__new SELECT id, company_name, business_type, owner_name, phone, mobile, email, website,
  address, city, state, postal_code, country, trade_license, registration_number, bin_vat, tin, currency, timezone,
  financial_year, company_description, invoice_footer, report_footer, notes, logo_path, tax_rate, invoice_prefix,
  payment_terms, language, theme, logo_blob, logo_mime, certificate_employee_prefix, certificate_product_prefix,
  certificate_auto_numbering, certificate_qr_verification, certificate_authorized_signature,
  certificate_authorized_designation, certificate_footer_text, certificate_enable_expiry,
  certificate_default_validity_days, certificate_default_template, certificate_reuse_company_logo, business_mode,
  security_max_login_attempts, security_lockout_minutes, security_session_timeout_minutes, stock_low_threshold,
  stock_default_warehouse, stock_allow_negative, stock_auto_reorder_alert, sales_order_prefix, purchase_order_prefix,
  sales_default_payment_terms, purchase_default_payment_terms, sales_require_approval, fiscal_year_start,
  accounting_default_tax_rate, accounting_default_payment_method, accounting_auto_post_journal, payroll_pay_day,
  payroll_salary_cycle, employee_probation_days, payroll_overtime_rate, notify_email_enabled, notify_low_stock,
  notify_order_updates, notify_payment_due, integration_api_key, integration_webhook_url, integration_enabled,
  invoice_template_style, report_template_style, document_show_logo, date_format, number_format, created_at,
  updated_at, workspace_id FROM company_settings;
DROP TABLE company_settings;
ALTER TABLE company_settings__new RENAME TO company_settings;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_settings_workspace ON company_settings(workspace_id);

PRAGMA foreign_keys = ON;

-- Post-apply verification (run manually against staging before promoting
-- to production, per the checklist at the top of this file):
--   SELECT COUNT(*) FROM users;         -- compare to pre-migration count
--   SELECT COUNT(*) FROM employees;
--   SELECT COUNT(*) FROM products;
--   SELECT COUNT(*) FROM customers;
--   SELECT COUNT(*) FROM transactions;
--   SELECT COUNT(*) FROM accounts;
--   SELECT COUNT(*) FROM journal_entries;
--   SELECT COUNT(*) FROM invoices;
--   SELECT COUNT(*) FROM certificates;
--   SELECT COUNT(*) FROM permission_profiles;
--   SELECT COUNT(*) FROM company_settings;
--   PRAGMA foreign_key_check;

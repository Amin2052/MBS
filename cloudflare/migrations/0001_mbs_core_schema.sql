-- Mooral Business Suite — D1 core relational schema
--
-- SAFETY: every statement is CREATE TABLE/INDEX IF NOT EXISTS. This migration
-- never DROPs, ALTERs, or writes to any existing table. It is a no-op for any
-- table that already exists (schema drift, if any, must be handled by a
-- separate, explicitly-reviewed migration — not this one).
--
-- Deliberately NOT touched by this migration (verified against production D1):
--   - cloud_records   -> already exists (cloudflare/worker/schema.sql), left as-is.
--   - messages        -> already exists in production D1 with CONFIRMED columns
--                        (id, sender, receiver, message, updated_at, created_at)
--                        holding 1 real row (Admin -> All / "Hello Team!").
--                        This is NOT the same shape MBS/the Worker need
--                        (sender_id, recipient_id, subject, body, category,
--                        is_read, deleted_by_sender/recipient — see
--                        src/database/database.ts:740). Reusing, renaming, or
--                        ALTERing this table would either corrupt the existing
--                        row or silently redefine its meaning. Instead, the
--                        MBS relational messaging schema lives in a
--                        DIFFERENTLY NAMED table below: `mbs_messages`. The
--                        legacy `messages` table is left completely
--                        untouched and unreferenced by the Worker.
--   - erp_data        -> already exists in production D1 (1 row, module_name
--                        "inventory"), confirmed not referenced anywhere in
--                        the MBS repo or the Worker. Left untouched.
--
-- Source of truth: src/database/database.ts (the real MBS SQLite schema).
-- Column definitions below are copied 1:1 from that file. D1 is SQLite, so
-- the same DDL applies without translation.
--
-- Scope: the 20 tables the Worker's ALLOWED_COLLECTIONS already expects via
-- /v1/data/:collection (cloudflare/worker/index.js), plus `sessions`, which
-- the Worker's own login/session code requires but which is never exposed
-- as a client-syncable collection.
--
-- Not yet included (out of scope for this migration — Worker doesn't use
-- them today): license (device-bound, not a cloud concept), id_counters
-- (local sequence generation), password_reset_requests /
-- password_reset_audit_log (forgot-password flow isn't wired to the cloud
-- API yet). Add these in a later migration if/when the Worker gains that
-- functionality.

-- ==========================
-- USERS
-- ==========================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_type TEXT NOT NULL DEFAULT 'employee',
    username TEXT NOT NULL UNIQUE,
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
    designation TEXT DEFAULT ''
);

-- Same "exactly one Owner" guarantee as local SQLite.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner
ON users(user_type)
WHERE user_type = 'owner';

-- ==========================
-- SESSIONS (Worker-internal; not a client-syncable collection)
-- ==========================
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    remember_me INTEGER NOT NULL DEFAULT 0,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME
);

-- ==========================
-- PERMISSION PROFILES / PERMISSIONS / OVERRIDES
-- ==========================
CREATE TABLE IF NOT EXISTS permission_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    permission_key TEXT NOT NULL UNIQUE,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    permission_key TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS profile_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    permission_key TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 1,
    UNIQUE(profile_id, permission_key)
);

-- ==========================
-- EMPLOYEES
-- ==========================
CREATE TABLE IF NOT EXISTS employees (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_number TEXT UNIQUE,
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
    identity_number TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS employee_contracts (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    contract_start_date DATETIME NOT NULL,
    contract_end_date DATETIME,
    extension_reason TEXT DEFAULT '',
    previous_contract_id INTEGER,
    is_current INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (previous_contract_id) REFERENCES employee_contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee_id
ON employee_contracts(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee_current
ON employee_contracts(employee_id, is_current);

-- ==========================
-- PRODUCTS / CUSTOMERS / ORDERS / INVENTORY
-- ==========================
CREATE TABLE IF NOT EXISTS products (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    sku TEXT,
    price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    customer_id TEXT,
    customer_name TEXT,
    product_id TEXT,
    product_name TEXT,
    quantity INTEGER DEFAULT 1,
    price REAL DEFAULT 0,
    total REAL DEFAULT 0,
    status TEXT DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================
-- ACCOUNTING
-- ==========================
CREATE TABLE IF NOT EXISTS transactions (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT UNIQUE,
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
    source_invoice_id TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    is_system INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entries (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_id TEXT UNIQUE,
    entry_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    debit_account_id INTEGER NOT NULL,
    debit_account_name TEXT NOT NULL,
    credit_account_id INTEGER NOT NULL,
    credit_account_name TEXT NOT NULL,
    amount REAL NOT NULL,
    reference TEXT,
    reference_type TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_id TEXT,
    account_id INTEGER NOT NULL,
    account_name TEXT NOT NULL,
    customer_id TEXT,
    customer_name TEXT,
    entry_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    running_balance REAL DEFAULT 0,
    reference_id TEXT,
    reference_type TEXT,
    description TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_account_customer
ON ledger_entries(account_id, customer_id, entry_date, id);

CREATE INDEX IF NOT EXISTS idx_ledger_reference
ON ledger_entries(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_journal_reference
ON journal_entries(reference_type, reference);

-- ==========================
-- INVOICES / CERTIFICATES
-- ==========================
CREATE TABLE IF NOT EXISTS invoices (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id TEXT UNIQUE,
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Partial unique index: prevents duplicate invoices for the same order
-- (legacy/manual invoices with NULL/empty order_id are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_order_id
ON invoices(order_id)
WHERE order_id IS NOT NULL AND order_id != '';

CREATE TABLE IF NOT EXISTS certificates (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id TEXT UNIQUE,
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
    printed_at DATETIME
);

-- ==========================
-- NOTIFICATIONS
-- ==========================
CREATE TABLE IF NOT EXISTS notifications (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    app_user TEXT,
    before_data TEXT,
    after_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
ON notifications(created_at);

-- ==========================
-- AUDIT LOG
-- ==========================
CREATE TABLE IF NOT EXISTS audit_log (
    local_id TEXT,
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    user_type TEXT,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    record_id TEXT,
    record_label TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_module ON audit_log(module);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);

-- ==========================
-- COMPANY SETTINGS (singleton row, id = 1)
-- ==========================
-- NOTE: local SQLite builds this table incrementally via ALTER TABLE ADD
-- COLUMN as features were added over time (see requiredCompanyColumns in
-- database.ts). D1 has no equivalent migration history, so this creates
-- the table with the FULL current column set in one step rather than
-- replaying that history.
CREATE TABLE IF NOT EXISTS company_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT DEFAULT '',
    business_type TEXT DEFAULT '',
    owner_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    mobile TEXT DEFAULT '',
    email TEXT DEFAULT '',
    website TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    postal_code TEXT DEFAULT '',
    country TEXT DEFAULT '',
    trade_license TEXT DEFAULT '',
    registration_number TEXT DEFAULT '',
    bin_vat TEXT DEFAULT '',
    tin TEXT DEFAULT '',
    currency TEXT DEFAULT 'BDT',
    timezone TEXT DEFAULT 'Asia/Dhaka',
    financial_year TEXT DEFAULT 'January - December',
    company_description TEXT DEFAULT '',
    invoice_footer TEXT DEFAULT '',
    report_footer TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    logo_path TEXT DEFAULT '',
    tax_rate REAL DEFAULT 0,
    invoice_prefix TEXT DEFAULT 'INV-',
    payment_terms TEXT DEFAULT '',
    language TEXT DEFAULT 'en',
    theme TEXT DEFAULT 'light',
    logo_blob BLOB,
    logo_mime TEXT DEFAULT '',
    certificate_employee_prefix TEXT DEFAULT 'EMP-',
    certificate_product_prefix TEXT DEFAULT 'PRD-',
    certificate_auto_numbering INTEGER DEFAULT 1,
    certificate_qr_verification INTEGER DEFAULT 1,
    certificate_authorized_signature TEXT DEFAULT '',
    certificate_authorized_designation TEXT DEFAULT '',
    certificate_footer_text TEXT DEFAULT '',
    certificate_enable_expiry INTEGER DEFAULT 0,
    certificate_default_validity_days INTEGER DEFAULT 0,
    certificate_default_template TEXT DEFAULT 'classic',
    certificate_reuse_company_logo INTEGER DEFAULT 1,
    business_mode TEXT NOT NULL DEFAULT 'starter',
    security_max_login_attempts INTEGER NOT NULL DEFAULT 5,
    security_lockout_minutes INTEGER NOT NULL DEFAULT 15,
    security_session_timeout_minutes INTEGER NOT NULL DEFAULT 0,
    stock_low_threshold INTEGER NOT NULL DEFAULT 10,
    stock_default_warehouse TEXT DEFAULT 'Main Warehouse',
    stock_allow_negative INTEGER NOT NULL DEFAULT 0,
    stock_auto_reorder_alert INTEGER NOT NULL DEFAULT 1,
    sales_order_prefix TEXT DEFAULT 'ORD-',
    purchase_order_prefix TEXT DEFAULT 'PO-',
    sales_default_payment_terms TEXT DEFAULT 'Due on Receipt',
    purchase_default_payment_terms TEXT DEFAULT 'Net 30',
    sales_require_approval INTEGER NOT NULL DEFAULT 0,
    fiscal_year_start TEXT DEFAULT '01-01',
    accounting_default_tax_rate REAL DEFAULT 0,
    accounting_default_payment_method TEXT DEFAULT 'Cash',
    accounting_auto_post_journal INTEGER NOT NULL DEFAULT 1,
    payroll_pay_day INTEGER NOT NULL DEFAULT 1,
    payroll_salary_cycle TEXT DEFAULT 'Monthly',
    employee_probation_days INTEGER NOT NULL DEFAULT 90,
    payroll_overtime_rate REAL DEFAULT 1.5,
    notify_email_enabled INTEGER NOT NULL DEFAULT 1,
    notify_low_stock INTEGER NOT NULL DEFAULT 1,
    notify_order_updates INTEGER NOT NULL DEFAULT 1,
    notify_payment_due INTEGER NOT NULL DEFAULT 1,
    integration_api_key TEXT DEFAULT '',
    integration_webhook_url TEXT DEFAULT '',
    integration_enabled INTEGER NOT NULL DEFAULT 0,
    invoice_template_style TEXT DEFAULT 'classic',
    report_template_style TEXT DEFAULT 'classic',
    document_show_logo INTEGER NOT NULL DEFAULT 1,
    date_format TEXT DEFAULT 'DMY',
    number_format TEXT DEFAULT 'en-US',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================
-- MBS RELATIONAL MESSAGES (named mbs_messages -- see note at top of file;
-- production's existing `messages` table has an incompatible legacy shape
-- and a real row that must not be touched, so this uses a distinct name
-- rather than colliding with it).
-- Column layout copied 1:1 from src/database/database.ts:740.
-- ==========================
CREATE TABLE IF NOT EXISTS mbs_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    sender_name TEXT NOT NULL,
    recipient_id INTEGER NOT NULL,
    recipient_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    parent_message_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    deleted_by_sender INTEGER NOT NULL DEFAULT 0,
    deleted_by_recipient INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mbs_messages_recipient ON mbs_messages(recipient_id, deleted_by_recipient, created_at);
CREATE INDEX IF NOT EXISTS idx_mbs_messages_sender ON mbs_messages(sender_id, deleted_by_sender, created_at);

-- ==========================
-- local_id RECONCILIATION INDEXES
--
-- `local_id` carries the identity value the desktop client already computes
-- per row (electron/main/cloud/cloud-sync-manager.ts: primaryKeyFor() +
-- getDeviceId()) as a composite, DEVICE-PREFIXED string: `${deviceId}:${table}:${id}`
-- — not the bare local autoincrement/business-key id. This is what keeps two
-- different PCs' records from silently colliding/overwriting one another in
-- D1 before either has synced (see cloud-sync-manager.ts:syncTable). It also
-- lets repeated 15-second syncs from the SAME PC correctly update the SAME
-- D1 row instead of inserting a new one every cycle.
--
-- Separately, a genuine BUSINESS-KEY collision (e.g. two devices independently
-- generating the same product_id "PRD-000001" for two different products) is
-- still possible, since local id_counters are per-device. That case is
-- handled at the Worker layer (cloudflare/worker/index.js handleData): a
-- UNIQUE-constraint failure on a business-key column is caught and returned
-- as a structured `409 business_key_conflict`, never a silent overwrite.
-- ==========================
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_local_id ON employees(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_contracts_local_id ON employee_contracts(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_local_id ON products(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_local_id ON customers(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_local_id ON orders(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_transactions_local_id ON inventory_transactions(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_local_id ON transactions(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_local_id ON accounts(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_local_id ON journal_entries(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_local_id ON ledger_entries(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_local_id ON invoices(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_local_id ON certificates(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_local_id ON notifications(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_local_id ON permissions(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_local_id ON audit_log(local_id);

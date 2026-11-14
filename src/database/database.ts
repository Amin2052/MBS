import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";


let db: Database.Database;



/**
 * Returns the absolute path of the SQLite database file, without
 * requiring the connection to already be open. Used by the Backup &
 * Restore module (database info, backup, and restore all need the
 * file path independently of an active `better-sqlite3` handle).
 */
export function getDatabaseFilePath(): string {

    return path.join(

        app.getPath("userData"),

        "mooral.db"

    );

}



/**
 * Closes the current database connection, if one is open, and clears
 * the cached handle so the next call to `getDatabase()` re-opens the
 * file from scratch. This is required by Restore (the on-disk file is
 * replaced while the app is running, so the existing handle must be
 * released first) and is otherwise never called during normal CRUD
 * operation of any module.
 */
/**
 * Reads, and atomically advances, a monotonic never-reused counter
 * (order numbers, invoice numbers, ...) stored in the `id_counters`
 * table.
 *
 * MUST be called from inside the same db.transaction() as the INSERT
 * that consumes the returned number (see order-repository.ts /
 * invoice-repository.ts) -- that's what makes "read next value, use it,
 * increment it" atomic and collision-free under SQLite's transaction
 * locking, the same guarantee id generation already relies on there.
 */
export function getNextSequenceValue(
    dbHandle: Database.Database,
    counterKey: string,
    seedNextValue: () => number
): number {

    const row = dbHandle.prepare(`
        SELECT next_value FROM id_counters WHERE counter_key = ?
    `).get(counterKey) as { next_value: number } | undefined;

    let next: number;

    if (row) {
        next = row.next_value;
    } else {
        // First time this counter has ever been used on this database --
        // seed it so pre-existing rows (created before id_counters
        // existed) are never renumbered or collided with.
        next = seedNextValue();
        dbHandle.prepare(`
            INSERT INTO id_counters (counter_key, next_value) VALUES (?, ?)
        `).run(counterKey, next);
    }

    dbHandle.prepare(`
        UPDATE id_counters SET next_value = next_value + 1 WHERE counter_key = ?
    `).run(counterKey);

    return next;

}


export function closeDatabase(): void {

    if (db) {

        db.close();

        // `db` keeps its original non-optional type so the existing
        // initializeDatabase() body (which assumes an always-open
        // handle once assigned) doesn't need any changes. Resetting it
        // to "not yet opened" here is what lets the next getDatabase()
        // call re-create the connection after Restore replaces the
        // file on disk.
        db = undefined as unknown as Database.Database;

    }

}



export function getDatabase() {


    if (!db) {


        const dbPath = getDatabaseFilePath();


        try {

            db = new Database(dbPath);

            // DATABASE INTEGRITY AUDIT: foreign_keys defaults to OFF in
            // SQLite unless explicitly enabled per-connection -- this was
            // never set anywhere in the app, so the real FOREIGN KEY
            // constraints declared on employee_contracts (employee_id ->
            // employees.id, previous_contract_id -> employee_contracts.id
            // -- see initializeDatabase() below) were silently
            // unenforced. Must be set on every connection, right after
            // opening and before initializeDatabase() runs any DDL/DML,
            // which is why it lives here rather than in an individual
            // repository file -- this is the ONLY place a Database
            // connection is ever constructed in this app (confirmed by
            // grep across the whole src/ and electron/ trees), so this
            // is the one correct, exhaustive location for it.
            // Turning this on does NOT retroactively validate rows that
            // already exist -- SQLite only enforces on subsequent
            // INSERT/UPDATE/DELETE, so no existing installation's data
            // can be broken by enabling this. Audited the one path that
            // writes employee_contracts (deleteEmployee() in
            // employee-repository.ts, confirmed the only DELETE FROM
            // employee_contracts site in the whole codebase): it already
            // manually cascades employee_contracts/certificates before
            // deleting the employee row, so this pragma is a genuine
            // safety net here, not something that changes existing
            // working behavior.
            db.pragma("foreign_keys = ON");

        }
        catch (error) {

            // The most common cause of a failure here is that the
            // better-sqlite3 native binary was built against the system
            // Node.js ABI instead of Electron's bundled Node ABI (i.e.
            // `electron-rebuild` was never run after `npm install`).
            // Every CRUD operation in the app routes through this
            // function, so a silent failure here looks like every
            // Save/Delete button in the app "doing nothing".
            console.error(
                "Failed to open SQLite database. If this is a native " +
                "module ABI mismatch, run the app's postinstall step " +
                "(electron-rebuild) and try again.",
                error
            );

            throw error;

        }


        console.log(

            "SQLite Database Connected:",

            dbPath

        );


        initializeDatabase();


    }


    return db;


}







function initializeDatabase() {



    // ==========================
    // PRODUCTS TABLE
    // ==========================


    db.exec(`

        CREATE TABLE IF NOT EXISTS products (

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

    `);







    // ==========================
    // CUSTOMERS TABLE
    // ==========================


    db.exec(`

        CREATE TABLE IF NOT EXISTS customers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            customer_id TEXT UNIQUE,

            name TEXT NOT NULL,

            phone TEXT,

            email TEXT,

            address TEXT,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

        );

    `);







    // ==========================
    // EMPLOYEES TABLE
    // ==========================


    db.exec(`

        CREATE TABLE IF NOT EXISTS employees (

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

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

        );

    `);




    // ==========================
    // ORDERS TABLE
    // ==========================


    db.exec(`

        CREATE TABLE IF NOT EXISTS orders (

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

    `);






    // ==========================
    // INVENTORY TRANSACTIONS TABLE
    // ==========================


    db.exec(`

        CREATE TABLE IF NOT EXISTS inventory_transactions (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            product_id TEXT NOT NULL,

            type TEXT NOT NULL,

            quantity INTEGER DEFAULT 0,

            note TEXT,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP

        );

    `);

     // ==========================
// ACCOUNTING TRANSACTIONS TABLE
// ==========================


db.exec(`

    CREATE TABLE IF NOT EXISTS transactions (

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

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

`);
	

    // ==========================
    // TRANSACTIONS TABLE SAFE MIGRATION
    // ==========================
    // Adds a proper link column from an accounting transaction back to the
    // invoice it was auto-generated from. Replaces the old soft match on
    // reference_no + type + category (see invoice-repository.ts). NULL for
    // manually entered transactions and for legacy invoice-generated rows
    // created before this column existed.

    const transactionColumns =
        db
        .prepare("PRAGMA table_info(transactions)")
        .all() as any[];


    if (
        !transactionColumns.some(
            column => column.name === "source_invoice_id"
        )
    ) {

        db.exec(`

            ALTER TABLE transactions

            ADD COLUMN source_invoice_id TEXT;

        `);

    }

    // ==========================
    // CHART OF ACCOUNTS TABLE
    // ==========================
    // Foundation of the double-entry ledger/journal system (Task 10).
    // Purely additive: existing single-entry `transactions` table above
    // is untouched and keeps powering the existing Accounting page as
    // before. This table just adds a proper Chart of Accounts that the
    // new ledger/journal tables below post against.

    db.exec(`

        CREATE TABLE IF NOT EXISTS accounts (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            code TEXT UNIQUE,

            name TEXT NOT NULL,

            type TEXT NOT NULL,

            is_system INTEGER DEFAULT 0,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP

        );

    `);


    // Seed the fixed system accounts every startup. INSERT OR IGNORE
    // keys off the UNIQUE `code`, so this is a no-op once they exist --
    // safe to run on every launch, never touches existing rows/data.
    const seedAccount = db.prepare(`

        INSERT OR IGNORE INTO accounts (code, name, type, is_system)
        VALUES (@code, @name, @type, 1)

    `);

    [
        { code: "1000", name: "Cash / Bank", type: "Asset" },
        { code: "1100", name: "Accounts Receivable (Customers)", type: "Asset" },
        { code: "4000", name: "Sales Revenue", type: "Income" },
        { code: "5000", name: "General Expense", type: "Expense" }
    ].forEach(account => seedAccount.run(account));


    // ==========================
    // JOURNAL ENTRIES TABLE
    // ==========================
    // One row per journal entry (debit account + credit account + a
    // single amount, always balanced by construction since both sides
    // always carry the same amount). `reference` is the free-text
    // business reference (invoice id, transaction id, or a manual
    // note); `reference_type` categorizes automatic postings
    // (invoice_creation / invoice_payment / manual_income /
    // manual_expense / manual) and, together with `reference`, is used
    // to prevent the same business event from being posted twice.

    db.exec(`

        CREATE TABLE IF NOT EXISTS journal_entries (

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

    `);


    // ==========================
    // LEDGER ENTRIES TABLE
    // ==========================
    // Every journal entry expands into exactly two ledger lines here
    // (one debit, one credit), each carrying its own running balance.
    // `customer_id`/`customer_name` are set only on lines posted
    // against the Accounts Receivable account -- that's what makes the
    // per-customer ledger view possible (filter by customer_id) while
    // the same table also serves the general-accounts ledger (filter
    // by customer_id IS NULL).

    db.exec(`

        CREATE TABLE IF NOT EXISTS ledger_entries (

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

    `);


    // Query patterns this module runs constantly: "all lines for this
    // account (+customer)" ordered by date, and "find the journal for
    // this business event" for duplicate-posting checks. Indexing both
    // keeps those lookups fast without touching unrelated tables.
    db.exec(`

        CREATE INDEX IF NOT EXISTS idx_ledger_account_customer
        ON ledger_entries(account_id, customer_id, entry_date, id);

        CREATE INDEX IF NOT EXISTS idx_ledger_reference
        ON ledger_entries(reference_type, reference_id);

        CREATE INDEX IF NOT EXISTS idx_journal_reference
        ON journal_entries(reference_type, reference);

    `);


    // ==========================
    // INVOICES TABLE
    // ==========================


    db.exec(`

        CREATE TABLE IF NOT EXISTS invoices (

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

    `);

// ==========================
// CERTIFICATES TABLE
// ==========================

    db.exec(`

        CREATE TABLE IF NOT EXISTS certificates (

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

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

        );

    `);

// ==========================
// NOTIFICATIONS TABLE
// ==========================
// Backs the Dashboard "Notifications" widget. Each row is a one-line
// activity summary (module + action) plus an optional before/after
// snapshot shown in the details modal. Rows are written by the main
// process at the same handful of hook points (employee/customer/
// product/certificate/settings/transaction/invoice actions) that
// generate the summaries the widget lists.

db.exec(`

    CREATE TABLE IF NOT EXISTS notifications (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        module TEXT NOT NULL,

        action TEXT NOT NULL,

        message TEXT NOT NULL,

        app_user TEXT,

        before_data TEXT,

        after_data TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

`);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notifications_created_at
        ON notifications(created_at);
    `);

// ==========================
// INTERNAL MESSAGES TABLE
// ==========================
// Backs the internal Messages system (replaces the Dashboard
// Notification widget for non-Owner users). A small in-app email
// analog: sender/recipient are real users.id, sender_name/
// recipient_name are Full Name snapshots taken at send time (so a
// later rename doesn't rewrite history -- same "snapshot, not live
// join" reasoning as reviewed_by_username elsewhere). is_read /
// deleted_by_* are per-mailbox-side flags: deleting a message from
// your own view never deletes the other party's copy, same as a real
// mailbox. parent_message_id threads a Reply back to the message it
// answers, purely for display grouping.

db.exec(`

    CREATE TABLE IF NOT EXISTS messages (

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

`);

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_recipient
    ON messages(recipient_id, deleted_by_recipient, is_read);
`);

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_sender
    ON messages(sender_id, deleted_by_sender);
`);

// ==========================
// LICENSE TABLE (Authentication & Licensing)
// ==========================
// Singleton row (id = 1), same pattern as company_settings below.
// This table is the local source of truth for OfflineLicenseProvider.
// `record_hmac` binds the row's mutable fields to this specific
// device's fingerprint (see electron/main/license/security/crypto.ts)
// so hand-editing the row with an external SQLite browser is detected
// as tampering rather than silently trusted.


db.exec(`

    CREATE TABLE IF NOT EXISTS license (

        id INTEGER PRIMARY KEY CHECK (id = 1),

        mode TEXT NOT NULL DEFAULT 'offline',

        license_key TEXT DEFAULT '',

        license_id TEXT DEFAULT '',

        device_fingerprint TEXT DEFAULT '',

        status TEXT NOT NULL DEFAULT 'not_activated',

        activated_at DATETIME,

        expires_at DATETIME,

        perpetual INTEGER DEFAULT 0,

        trial_started_at DATETIME,

        last_validated_at DATETIME,

        grace_started_at DATETIME,

        tamper_detected INTEGER DEFAULT 0,

        tamper_reason TEXT DEFAULT '',

        record_hmac TEXT DEFAULT '',

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

`);


db.exec(`

    INSERT OR IGNORE INTO license (
        id
    )
    VALUES (
        1
    );

`);


// ==========================
// LICENSE TABLE SAFE MIGRATION
// ==========================
// Present even though the table above already declares every column,
// following the same defensive pattern used for company_settings --
// any future column additions only need to be appended to this list.

const licenseColumns =
    db
        .prepare("PRAGMA table_info(license)")
        .all() as any[];

const requiredLicenseColumns = [
    ["customer_id", "TEXT DEFAULT ''"],

    ["customer_name", "TEXT DEFAULT ''"],

    ["company_name", "TEXT DEFAULT ''"],

    ["plan", "TEXT DEFAULT 'trial'"],

    ["modules", "TEXT DEFAULT '[]'"],

    ["max_users", "INTEGER DEFAULT 1"],

    ["device_limit", "INTEGER DEFAULT 1"],

    ["mode", "TEXT NOT NULL DEFAULT 'offline'"],

    ["license_key", "TEXT DEFAULT ''"],

    ["license_id", "TEXT DEFAULT ''"],

    ["device_fingerprint", "TEXT DEFAULT ''"],

    ["status", "TEXT NOT NULL DEFAULT 'not_activated'"],

    ["activated_at", "DATETIME"],

    ["expires_at", "DATETIME"],

    ["perpetual", "INTEGER DEFAULT 0"],

    ["trial_started_at", "DATETIME"],

    ["last_validated_at", "DATETIME"],

    ["grace_started_at", "DATETIME"],

    ["tamper_detected", "INTEGER DEFAULT 0"],

    ["tamper_reason", "TEXT DEFAULT ''"],

    ["record_hmac", "TEXT DEFAULT ''"],

    ["created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"],

    ["updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"]

    ] as const;

for (const [columnName, columnType] of requiredLicenseColumns) {

    if (!licenseColumns.some(column => column.name === columnName)) {

        db.exec(`

            ALTER TABLE license
            ADD COLUMN ${columnName} ${columnType};

        `);

    }

}


// ==========================
// COMPANY SETTINGS TABLE
// ==========================

db.exec(`

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

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

`);

db.exec(`

    INSERT OR IGNORE INTO company_settings (

        id

    )

    VALUES (

        1

    );

`);

    // ==========================
    // SAFE MIGRATION
    // ==========================



    const productColumns =
        db
        .prepare("PRAGMA table_info(products)")
        .all() as any[];




    if (
        !productColumns.some(
            column => column.name === "updated_at"
        )
    ) {


        db.exec(`

            ALTER TABLE products

            ADD COLUMN updated_at DATETIME;

        `);


    }







    const customerColumns =
        db
        .prepare("PRAGMA table_info(customers)")
        .all() as any[];




    if (
        !customerColumns.some(
            column => column.name === "updated_at"
        )
    ) {


        db.exec(`

            ALTER TABLE customers

            ADD COLUMN updated_at DATETIME;

        `);


    }
     
     // ==========================
// EMPLOYEES TABLE SAFE MIGRATION
// ==========================
// Present even though the table above already declares every column,
// following the same defensive pattern used for company_settings /
// license -- any future column additions only need to be appended to
// this list.

const employeeColumns =
    db
        .prepare("PRAGMA table_info(employees)")
        .all() as any[];

const requiredEmployeeColumns = [

    ["photo_blob", "BLOB"],

    ["photo_mime", "TEXT DEFAULT ''"],

    ["gender", "TEXT DEFAULT ''"],

    ["date_of_birth", "DATETIME"],

    ["phone", "TEXT DEFAULT ''"],

    ["email", "TEXT DEFAULT ''"],

    ["address", "TEXT DEFAULT ''"],

    ["department", "TEXT DEFAULT ''"],

    ["designation", "TEXT DEFAULT ''"],

    ["joining_date", "DATETIME"],

    ["employment_status", "TEXT NOT NULL DEFAULT 'Active'"],

    ["salary", "REAL DEFAULT 0"],

    ["emergency_contact_name", "TEXT DEFAULT ''"],

    ["emergency_contact_phone", "TEXT DEFAULT ''"],

    ["nid_passport", "TEXT DEFAULT ''"],

    ["notes", "TEXT DEFAULT ''"],

    ["updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"],

    // ------------------------------------------------------------
    // ERP Employment/Contract upgrade.
    // employment_type: Full Time / Part Time / Contract / Temporary /
    // Intern / Freelancer (src/constants/employee.ts). Kept as a plain
    // string column, same convention as employment_status -- not an
    // enforced CHECK constraint, so older rows (NULL/empty) remain
    // valid and are simply treated as "not set" by the UI.
    ["employment_type", "TEXT DEFAULT ''"],

    // resignation_date: only meaningful once employment_status moves
    // to Resigned/Terminated, but stored unconditionally (nullable)
    // like date_of_birth/joining_date above.
    ["resignation_date", "DATETIME"],

    // contract_start_date / contract_end_date: denormalized copies of
    // the *current* row in employee_contracts (see the new table
    // below), kept in sync by employee-contract-repository.ts so the
    // Employees list/detail views can read them without a join. The
    // employee_contracts table remains the single source of truth for
    // full contract history -- these two columns are a read-optimized
    // mirror of its "is_current" row, never hand-edited independently.
    ["contract_start_date", "DATETIME"],

    ["contract_end_date", "DATETIME"],

    // Employee Identity System: replaces the old single free-text
    // nid_passport field with a typed pair. nid_passport itself is left
    // in place (not dropped) so any previously entered data stays
    // recoverable -- it's just no longer read or written by the UI.
    ["identity_type", "TEXT DEFAULT ''"],

    ["identity_number", "TEXT DEFAULT ''"]

    ] as const;

for (const [columnName, columnType] of requiredEmployeeColumns) {

    if (!employeeColumns.some(column => column.name === columnName)) {

        db.exec(`

            ALTER TABLE employees
            ADD COLUMN ${columnName} ${columnType};

        `);

    }

}


// ==========================
// EMPLOYEE CONTRACTS TABLE (Contract Lifecycle & History)
// ==========================
// ERP-style contract history for Contract/Temporary/Freelancer-type
// employees (and any employee whose employment includes a fixed-term
// agreement). Rows are never overwritten or deleted by the app --
// "extending" a contract closes the current row (is_current = 0) and
// inserts a brand new row linked via previous_contract_id, so the full
// lineage is always reconstructable. contract_status (Active /
// Expiring Soon / Expired) is deliberately NOT stored here -- it is
// date-dependent and is computed at read time in
// employee-contract-repository.ts, the same approach already used for
// certificates.nearExpiryCount / overdueExpiredCount in
// getCertificateSummary() above.

db.exec(`

    CREATE TABLE IF NOT EXISTS employee_contracts (

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

`);

// Required indexes: every lookup this module performs is either "all
// contracts for one employee" (history view) or "the current contract
// for one employee" (contract section / extend flow), so both are
// indexed directly rather than relying on a full table scan.

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee_id
    ON employee_contracts(employee_id);
`);

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee_current
    ON employee_contracts(employee_id, is_current);
`);


// ==========================
// COMPANY SETTINGS SAFE MIGRATION
// ==========================

const companyColumns =
    db
        .prepare("PRAGMA table_info(company_settings)")
        .all() as any[];

const requiredCompanyColumns = [

    ["company_name", "TEXT DEFAULT ''"],

    ["business_type", "TEXT DEFAULT ''"],

    ["owner_name", "TEXT DEFAULT ''"],

    ["phone", "TEXT DEFAULT ''"],

    ["mobile", "TEXT DEFAULT ''"],

    ["email", "TEXT DEFAULT ''"],

    ["website", "TEXT DEFAULT ''"],

    ["address", "TEXT DEFAULT ''"],

    ["city", "TEXT DEFAULT ''"],

    ["state", "TEXT DEFAULT ''"],

    ["postal_code", "TEXT DEFAULT ''"],

    ["country", "TEXT DEFAULT ''"],

    ["trade_license", "TEXT DEFAULT ''"],

    ["registration_number", "TEXT DEFAULT ''"],

    ["bin_vat", "TEXT DEFAULT ''"],

    ["tin", "TEXT DEFAULT ''"],

    ["currency", "TEXT DEFAULT 'BDT'"],

    ["timezone", "TEXT DEFAULT 'Asia/Dhaka'"],

    ["financial_year", "TEXT DEFAULT 'January - December'"],

    ["company_description", "TEXT DEFAULT ''"],

    ["invoice_footer", "TEXT DEFAULT ''"],

    ["report_footer", "TEXT DEFAULT ''"],

    ["notes", "TEXT DEFAULT ''"],

    ["logo_path", "TEXT DEFAULT ''"],

    // Settings Dashboard redesign additions
    // (Financial & Invoice / Localization fields that used to live only
    // in the JSON settings file, now first-class SQLite columns)
    ["tax_rate", "REAL DEFAULT 0"],

    ["invoice_prefix", "TEXT DEFAULT 'INV-'"],

    ["payment_terms", "TEXT DEFAULT ''"],

    ["language", "TEXT DEFAULT 'en'"],

    ["theme", "TEXT DEFAULT 'light'"],

    // Database-backed company logo (replaces filesystem logo_path lookups)
    ["logo_blob", "BLOB"],

    ["logo_mime", "TEXT DEFAULT ''"],

    // Certificate module configuration (Settings > Certificate).
    ["certificate_employee_prefix", "TEXT DEFAULT 'EMP-'"],

    ["certificate_product_prefix", "TEXT DEFAULT 'PRD-'"],

    ["certificate_auto_numbering", "INTEGER DEFAULT 1"],

    ["certificate_qr_verification", "INTEGER DEFAULT 1"],

    ["certificate_authorized_signature", "TEXT DEFAULT ''"],

    ["certificate_authorized_designation", "TEXT DEFAULT ''"],

    ["certificate_footer_text", "TEXT DEFAULT ''"],

    ["certificate_enable_expiry", "INTEGER DEFAULT 0"],

    ["certificate_default_validity_days", "INTEGER DEFAULT 0"],

    ["certificate_default_template", "TEXT DEFAULT 'classic'"],

    // When true (default), certificate PDFs reuse the company logo above.
    // There is no separate certificate logo storage -- this only toggles
    // whether the existing company logo is printed on certificates.
    ["certificate_reuse_company_logo", "INTEGER DEFAULT 1"],

    // Authentication & Security Architecture (MBS Master Spec Phase 1).
    // 'starter' (single Owner, no employee logins/permissions) or
    // 'enterprise' (Owner + Administrator + Employee accounts, full
    // permission system). Not an enforced CHECK constraint -- same
    // convention as employment_status/employment_type above -- valid
    // values are documented here and in BusinessMode (electron.d.ts).
    // Only the Owner can change this (enforced in business-mode-service.ts,
    // not at the schema level), and changing it never deletes data; it
    // only toggles which features/UI are enabled.
    ["business_mode", "TEXT NOT NULL DEFAULT 'starter'"],

    // Security Policies (Phase 5 - Owner Control Center). Populates
    // the failed_login_attempts/locked_until columns added to `users`
    // in Phase 1 specifically so this could be added later without
    // another migration to that table.
    ["security_max_login_attempts", "INTEGER NOT NULL DEFAULT 5"],

    ["security_lockout_minutes", "INTEGER NOT NULL DEFAULT 15"],

    // Security Hardening (Phase 8) -- Session Timeout / Automatic Lock.
    // 0 = disabled. When enabled, the renderer's inactivity tracker
    // (see src/hooks/use-idle-lock.ts) shows a lock screen requiring
    // the current user's password after this many minutes of no
    // mouse/keyboard/touch activity.
    ["security_session_timeout_minutes", "INTEGER NOT NULL DEFAULT 0"],

    // Settings Completion (Phase 3) -- Inventory & Warehouse
    ["stock_low_threshold", "INTEGER NOT NULL DEFAULT 10"],

    ["stock_default_warehouse", "TEXT DEFAULT 'Main Warehouse'"],

    ["stock_allow_negative", "INTEGER NOT NULL DEFAULT 0"],

    ["stock_auto_reorder_alert", "INTEGER NOT NULL DEFAULT 1"],

    // Settings Completion (Phase 3) -- Sales & Purchase
    ["sales_order_prefix", "TEXT DEFAULT 'ORD-'"],

    ["purchase_order_prefix", "TEXT DEFAULT 'PO-'"],

    ["sales_default_payment_terms", "TEXT DEFAULT 'Due on Receipt'"],

    ["purchase_default_payment_terms", "TEXT DEFAULT 'Net 30'"],

    ["sales_require_approval", "INTEGER NOT NULL DEFAULT 0"],

    // Settings Completion (Phase 3) -- Finance & Accounting
    ["fiscal_year_start", "TEXT DEFAULT '01-01'"],

    ["accounting_default_tax_rate", "REAL DEFAULT 0"],

    ["accounting_default_payment_method", "TEXT DEFAULT 'Cash'"],

    ["accounting_auto_post_journal", "INTEGER NOT NULL DEFAULT 1"],

    // Settings Completion (Phase 3) -- HR & Payroll
    ["payroll_pay_day", "INTEGER NOT NULL DEFAULT 1"],

    ["payroll_salary_cycle", "TEXT DEFAULT 'Monthly'"],

    ["employee_probation_days", "INTEGER NOT NULL DEFAULT 90"],

    ["payroll_overtime_rate", "REAL DEFAULT 1.5"],

    // Settings Completion (Phase 3) -- Notifications
    ["notify_email_enabled", "INTEGER NOT NULL DEFAULT 1"],

    ["notify_low_stock", "INTEGER NOT NULL DEFAULT 1"],

    ["notify_order_updates", "INTEGER NOT NULL DEFAULT 1"],

    ["notify_payment_due", "INTEGER NOT NULL DEFAULT 1"],

    // Settings Completion (Phase 3) -- Integrations / External Services
    ["integration_api_key", "TEXT DEFAULT ''"],

    ["integration_webhook_url", "TEXT DEFAULT ''"],

    ["integration_enabled", "INTEGER NOT NULL DEFAULT 0"],

    // Settings Completion (Phase 3) -- Document Templates
    ["invoice_template_style", "TEXT DEFAULT 'classic'"],

    ["report_template_style", "TEXT DEFAULT 'classic'"],

    ["document_show_logo", "INTEGER NOT NULL DEFAULT 1"],

    // Localization (Phase 9) -- Date Format / Number Format
    ["date_format", "TEXT DEFAULT 'DMY'"],

    ["number_format", "TEXT DEFAULT 'en-US'"],

    ["created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"],

    ["updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"]

    ] as const;

for (const [columnName, columnType] of requiredCompanyColumns) {

    if (!companyColumns.some(column => column.name === columnName)) {

        db.exec(`

            ALTER TABLE company_settings

            ADD COLUMN ${columnName} ${columnType};

        `);

    }

}


// ==========================
// CERTIFICATES TABLE MIGRATION
// ==========================

const certificateColumns =
    db
        .prepare("PRAGMA table_info(certificates)")
        .all() as any[];

const requiredCertificateColumns = [

    // Distinguishes the two Certificates sub-modules and their specific
    // document types (Experience/Employment/... for Employee,
    // Warranty/Installation/... for Product).
    ["certificate_category", "TEXT DEFAULT 'Employee'"],

    ["certificate_type", "TEXT DEFAULT ''"],

    // Employee Certificates aren't linked to a customer/product record,
    // so the recipient's name is stored directly.
    ["employee_name", "TEXT DEFAULT ''"],

    // Product Certificates only.
    ["serial_number", "TEXT DEFAULT ''"],

    // ------------------------------------------------------------
    // Task 9: Certificate <-> Employee/Product database sync.
    // Certificates must never depend on a live join back to
    // employees/products (those rows can be deleted later), so the
    // selected record's data is copied into these *_snapshot columns
    // at save time. employee_id / product_id store the natural
    // external key (employee_number / product_id string) purely as an
    // optional reference for traceability -- deleting the underlying
    // employee/product record does NOT cascade or invalidate the
    // certificate, since nothing here is an enforced foreign key.
    // ------------------------------------------------------------

    // Employee snapshot fields.
    ["employee_id", "TEXT DEFAULT ''"],
    ["employee_number_snapshot", "TEXT DEFAULT ''"],
    ["employee_name_snapshot", "TEXT DEFAULT ''"],
    ["department_snapshot", "TEXT DEFAULT ''"],
    ["designation_snapshot", "TEXT DEFAULT ''"],

    // ------------------------------------------------------------
    // Certificate Automation (Employment Type/Status-driven certificate
    // type, title and description -- see certificates-page.tsx). These
    // extend the Task 9 snapshot set above with exactly the employment
    // fields the automation rules read, captured at save time so a
    // historical certificate's wording never changes if the employee's
    // live record is edited afterward (e.g. re-hired, status changed).
    // ------------------------------------------------------------
    ["employment_type_snapshot", "TEXT DEFAULT ''"],
    ["joining_date_snapshot", "DATETIME"],
    ["employment_status_snapshot", "TEXT DEFAULT ''"],

    // Product snapshot fields. product_id/product_name already exist
    // above (added when the Product Certificate select was first
    // built) -- only the additional Category/SKU snapshots are new.
    ["product_name_snapshot", "TEXT DEFAULT ''"],
    ["category_snapshot", "TEXT DEFAULT ''"],
    ["sku_snapshot", "TEXT DEFAULT ''"],

    // Employee Certificate status automation: set exactly once, the
    // moment a certificate is first successfully printed/exported (see
    // markCertificatePrinted in certificate-repository.ts). Deliberately
    // separate from updated_at, which changes on every edit.
    ["printed_at", "DATETIME"]

    ] as const;

for (const [columnName, columnType] of requiredCertificateColumns) {

    if (!certificateColumns.some(column => column.name === columnName)) {

        db.exec(`

            ALTER TABLE certificates

            ADD COLUMN ${columnName} ${columnType};

        `);

    }

}

db.exec(`

    INSERT OR IGNORE INTO company_settings (

        id

    )

    VALUES (

        1

    );

`);







    const orderColumns =
        db
        .prepare("PRAGMA table_info(orders)")
        .all() as any[];




    if (
        !orderColumns.some(
            column => column.name === "updated_at"
        )
    ) {


        db.exec(`

            ALTER TABLE orders

            ADD COLUMN updated_at DATETIME;

        `);


    }



    // ==========================
    // ORDERS TABLE MIGRATION: drop legacy UNIQUE(order_id) constraint
    // ==========================
    //
    // Data model: `orders` is single-row-per-line-item. One logical
    // order with several products is several rows that all share the
    // same `order_id` (see createOrder() in order-repository.ts, which
    // inserts one row per item inside a single transaction). That is
    // correct and by design -- an Order Number is not a table row, it's
    // a value shared by every product line belonging to that order.
    //
    // Root cause of "SqliteError: UNIQUE constraint failed:
    // orders.order_id": on any database file that was ever created (or
    // upgraded through) an older build where `orders` used a
    // single-row-per-order model with `order_id TEXT UNIQUE`, that
    // constraint is baked into the on-disk table. `CREATE TABLE IF NOT
    // EXISTS orders` above is a no-op against a table that already
    // exists, so it can never remove a stale constraint, and SQLite has
    // no `ALTER TABLE ... DROP CONSTRAINT` / `DROP INDEX ON COLUMN`.
    // The only way to remove a column-level UNIQUE constraint is to
    // rebuild the table. Without this, the very first multi-product
    // order ever saved against such a database fails on its second
    // line-item INSERT, because both rows try to share one order_id.
    //
    // This detects a UNIQUE index on `orders.order_id` and, only when
    // one is actually present, rebuilds the table without it --
    // preserving every existing row and column exactly as-is. On a
    // database that already has the correct (non-unique) schema this
    // check is cheap and the block below is skipped entirely.

    const orderIdHasUniqueConstraint = (
        db
        .prepare("PRAGMA index_list(orders)")
        .all() as { name: string; unique: number }[]
    ).some(index => {

        if (!index.unique) return false;

        const indexedColumns =
            db
            .prepare(`PRAGMA index_info(${index.name})`)
            .all() as { name: string }[];

        // Only rebuild for a UNIQUE constraint that covers order_id.
        // (Composite or unrelated unique indexes, if any were ever
        // added, are intentionally left untouched.)
        return indexedColumns.some(
            column => column.name === "order_id"
        );

    });

    if (orderIdHasUniqueConstraint) {

        console.log(
            "Migrating orders table: removing legacy UNIQUE(order_id) " +
            "constraint so a multi-product order can save all of its " +
            "line items under one Order Number."
        );

        db.exec(`

            CREATE TABLE orders__rebuild (

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

            INSERT INTO orders__rebuild (
                id, order_id, customer_id, customer_name, product_id,
                product_name, quantity, price, total, status,
                created_at, updated_at
            )
            SELECT
                id, order_id, customer_id, customer_name, product_id,
                product_name, quantity, price, total, status,
                created_at, updated_at
            FROM orders;

            DROP TABLE orders;

            ALTER TABLE orders__rebuild RENAME TO orders;

        `);

    }






    const invoiceColumns =
        db
        .prepare("PRAGMA table_info(invoices)")
        .all() as any[];


    if (
        !invoiceColumns.some(
            column => column.name === "items"
        )
    ) {

        db.exec(`

            ALTER TABLE invoices

            ADD COLUMN items TEXT;

        `);

    }


    if (
        !invoiceColumns.some(
            column => column.name === "order_id"
        )
    ) {

        db.exec(`

            ALTER TABLE invoices

            ADD COLUMN order_id TEXT;

        `);

    }


    if (
        !invoiceColumns.some(
            column => column.name === "updated_at"
        )
    ) {

        db.exec(`

            ALTER TABLE invoices

            ADD COLUMN updated_at DATETIME;

        `);

    }

// ==========================
// INVOICE <-> ORDER LINK INDEX
// ==========================
// Partial unique index: only enforces uniqueness where order_id is
// actually set, so legacy/manual invoices (order_id NULL/empty) are
// unaffected. This is the database-level safety net behind
// createInvoiceFromCompletedOrder()'s own existing-invoice check --
// it guarantees "never create duplicate invoices" for the same order
// even under an unexpected concurrent write.

db.exec(`

    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_order_id
    ON invoices(order_id)
    WHERE order_id IS NOT NULL AND order_id != '';

`);

// ==========================================================
// AUTHENTICATION, USER MANAGEMENT & SECURITY (Phase 1)
// ==========================================================
//
// Five tables, matching the Master Implementation Spec's suggested
// schema. Only `users` and `sessions` are populated/used by Phase 1
// (a single Owner account + login sessions). `permission_profiles`,
// `permissions`, and `user_permissions` are created now so the schema
// never needs a breaking migration later -- Phase 2 (Employee/User
// Management) and Phase 3 (Permission Engine) populate and read them,
// but the tables themselves are foundation, not placeholders: they are
// real, queryable, indexed tables from day one.

// --------------------------
// USERS TABLE
// --------------------------
// One row per login-capable account (Owner, Administrator, or
// Employee). Only 'owner' rows are ever created in Phase 1 -- Phase 2
// adds Administrator/Employee creation from the User Management UI.
// employee_id / permission_profile_id / created_by are nullable FKs
// used starting Phase 2/3; they exist now so those phases only need
// to *populate* columns, never ALTER TABLE again for this part of the
// design. failed_login_attempts/locked_until exist for the same
// reason ahead of Phase 5's Security Policies (account lockout) --
// the columns are written with safe defaults today but no lockout
// logic reads them yet.

db.exec(`

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

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

`);

// Partial unique index: only one row may ever have user_type = 'owner'.
// This is a hard database-level guarantee behind "Only ONE Owner
// exists" -- createOwnerAccount() also checks this in application code
// first (for a clean error message), but this index is what actually
// prevents a second Owner row under any circumstance, including a
// future bug in that check.
db.exec(`

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner
    ON users(user_type)
    WHERE user_type = 'owner';

`);

// recovery_key_hash: added for the Owner "Forgot Password" flow (Task
// 2). Only ever populated for the single 'owner' row -- generated once
// during First-Time Setup (see setupOwnerAccount in auth-manager.ts)
// and never readable in plaintext again, same "hash only" principle as
// password_hash. An Administrator can never use this column to reset
// the Owner's password; it is only ever checked against a plaintext
// Recovery Key the Owner re-enters themselves.
const userColumns =
    db
    .prepare("PRAGMA table_info(users)")
    .all() as any[];

if (!userColumns.some(column => column.name === "recovery_key_hash")) {

    db.exec(`

        ALTER TABLE users

        ADD COLUMN recovery_key_hash TEXT;

    `);

}

// photo_blob / photo_mime: added for the Profile Picture UI/UX
// improvement. Same "own profile photo" concept as employees.photo_blob
// / employees.photo_mime (see employee-repository.ts) -- deliberately
// kept on the users row itself rather than a new table, since a photo
// is a 1:1, independently-replaceable piece of a single user's
// profile, same reasoning as recovery_key_hash above.
if (!userColumns.some(column => column.name === "photo_blob")) {

    db.exec(`

        ALTER TABLE users

        ADD COLUMN photo_blob BLOB;

    `);

}

if (!userColumns.some(column => column.name === "photo_mime")) {

    db.exec(`

        ALTER TABLE users

        ADD COLUMN photo_mime TEXT DEFAULT '';

    `);

}

// full_name / email / phone / designation: added for the expanded
// Edit Profile form. Kept on the users row itself (same reasoning as
// photo_blob/photo_mime above) rather than always going through the
// employees table, since Owner/some Administrator accounts have no
// linked employee row (employee_id can be null) -- this way every
// account type has one consistent place to store its own profile
// info. designation is included here for display/self-view only; who
// is allowed to *change* it is enforced in auth-manager.ts /
// authorization.ts (employees.edit permission), not by this column.
for (const col of ["full_name", "email", "phone", "designation"]) {

    if (!userColumns.some(column => column.name === col)) {

        db.exec(`

            ALTER TABLE users

            ADD COLUMN ${col} TEXT DEFAULT '';

        `);

    }

}

// --------------------------
// SESSIONS TABLE
// --------------------------
// A row per issued login session (both the short-lived in-memory kind
// and "Remember Me" sessions that survive an app restart). The raw
// session token is NEVER stored here -- only a SHA-256 hash of it,
// the same "never store the usable secret" principle as password_hash.
// The raw token itself only ever exists in memory and, for Remember Me
// sessions, encrypted at rest via Electron's OS-backed `safeStorage`
// (see electron/main/auth/session-storage.ts) -- never in this table,
// never in a plaintext file. expires_at is nullable today (no session
// timeout policy exists yet) so Phase 5 can populate it later without
// another migration. revoked_at is set on logout so a stolen/replayed
// token hash can never be reused after the user signs out.

db.exec(`

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

`);

// --------------------------
// PASSWORD RESET REQUESTS TABLE (Task 2 - Forgot Password Workflow)
// --------------------------
// One row per Forgot Password request. Employee requests are reviewed
// by an Administrator; Administrator requests are reviewed by the
// Owner -- reviewer_id / reviewer_type record who actually generated
// the Reset Code. The Reset Code itself is never stored in plaintext,
// only its hash (reset_code_hash), the same "never store the usable
// secret" principle as users.password_hash -- and it expires
// (reset_code_expires_at) so an approved-but-unused code cannot be
// redeemed indefinitely. The Owner never has rows here: Owner password
// recovery is the separate Recovery Key flow (see users.recovery_key_hash
// above), which never goes through an approval step.

db.exec(`

    CREATE TABLE IF NOT EXISTS password_reset_requests (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        user_type TEXT NOT NULL,

        status TEXT NOT NULL DEFAULT 'pending',

        request_type TEXT NOT NULL DEFAULT 'password',

        reset_code_hash TEXT,

        -- Stores a Unix timestamp (seconds since epoch) as an
        -- INTEGER, not an ISO datetime string -- SQLite's NUMERIC
        -- type affinity (which DATETIME maps to) stores this
        -- losslessly, so the column declaration doesn't need to
        -- change. See the comment in password-reset-repository.ts.
        reset_code_expires_at DATETIME,

        reset_code_used_at DATETIME,

        reviewed_by INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        resolved_at DATETIME

    );

`);

// --------------------------
// PASSWORD RESET AUDIT LOG TABLE (Task 2 enhancement)
// --------------------------
// Append-only trail of every event in the Forgot Password Workflow, for
// a request that may span several actors (requester, reviewer). Never
// updated or deleted, only inserted into -- mirrors how sessions/audit
// tables elsewhere in this schema are treated as historical record, not
// live state (live state lives on password_reset_requests itself).
db.exec(`

    CREATE TABLE IF NOT EXISTS password_reset_audit_log (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        request_id INTEGER NOT NULL,

        event TEXT NOT NULL,

        actor_user_id INTEGER,

        detail TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

    -- General-purpose audit trail covering Product / Customer / Order /
    -- Inventory / Certificate / Employee / User-Permission / Settings
    -- changes (distinct from password_reset_audit_log above, which only
    -- covers the password-reset-request approval flow).
    CREATE TABLE IF NOT EXISTS audit_log (

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

    -- Monotonic, never-reused sequence counters (order numbers, invoice
    -- numbers, ...). A counter is lazily seeded the first time it's
    -- used -- see getNextSequenceValue() below -- from the current
    -- MAX(existing number)+1, so upgrading an existing installation
    -- never renumbers or collides with orders/invoices created before
    -- this table existed. Once seeded, a value handed out here is never
    -- handed out again even if the row that used it is later deleted.
    CREATE TABLE IF NOT EXISTS id_counters (

        counter_key TEXT PRIMARY KEY,

        next_value INTEGER NOT NULL

    );

`);

// ==========================
// PASSWORD_RESET_REQUESTS SAFE MIGRATION
// ==========================
// request_type was added after this table already shipped -- existing
// installations' CREATE TABLE IF NOT EXISTS above is a no-op for them,
// so the column has to be added out-of-band, same defensive pattern
// used for employees/customers above. Existing rows backfill to
// 'password' via the column default, which is correct: every request
// created before this migration was a password-reset request (Forgot
// Username didn't go through this table yet).

const passwordResetRequestColumns =
    db
        .prepare("PRAGMA table_info(password_reset_requests)")
        .all() as any[];

if (
    !passwordResetRequestColumns.some(
        column => column.name === "request_type"
    )
) {

    db.exec(`

        ALTER TABLE password_reset_requests

        ADD COLUMN request_type TEXT NOT NULL DEFAULT 'password';

    `);

}

// --------------------------
// PERMISSION PROFILES TABLE
// --------------------------
// Reusable permission templates (Sales / Accounts / Inventory / HR /
// Manager / Custom, per the spec). Empty in Phase 1 -- Phase 2 is
// where Administrators create/assign these from the User Management
// UI. is_system marks the built-in starter templates (not user
// deletable) once Phase 2 seeds them, vs. fully custom profiles.

db.exec(`

    CREATE TABLE IF NOT EXISTS permission_profiles (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL UNIQUE,

        description TEXT DEFAULT '',

        is_system INTEGER NOT NULL DEFAULT 0,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

`);

// --------------------------
// PERMISSIONS CATALOG TABLE
// --------------------------
// The full catalog of permission keys the engine understands (one row
// per "module.action", e.g. "products.view"). Seeded below from the
// static catalog in src/auth/permission-catalog.ts so the database and
// the TypeScript engine can never drift apart. This is what Phase 3's
// navigation/module/button/action filtering reads against -- Phase 1
// only seeds the catalog, nothing yet assigns or checks these per user.

db.exec(`

    CREATE TABLE IF NOT EXISTS permissions (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        permission_key TEXT NOT NULL UNIQUE,

        module TEXT NOT NULL,

        action TEXT NOT NULL,

        description TEXT DEFAULT ''

    );

`);

// --------------------------
// USER PERMISSIONS TABLE
// --------------------------
// Per-user permission overrides layered on top of a user's
// permission_profile_id (profile grants a baseline set; a row here
// flips one specific permission_key on/off for that one user -- the
// "Customize Permissions (optional)" step in the spec's Employee Login
// Creation workflow). Unused until Phase 2/3 wire up real assignment.

db.exec(`

    CREATE TABLE IF NOT EXISTS user_permissions (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        permission_key TEXT NOT NULL,

        allowed INTEGER NOT NULL DEFAULT 1,

        UNIQUE(user_id, permission_key)

    );

`);

// --------------------------
// PROFILE PERMISSIONS TABLE (Phase 2)
// --------------------------
// The permission set a permission_profile actually grants (its
// baseline). Not part of the spec's "suggested tables" list verbatim,
// but a direct, necessary consequence of it: permission_profiles was
// always going to need somewhere to store what it grants, and
// permission-engine.ts's design (see Phase 1 comment there) already
// anticipated "profile baseline + per-user overrides merged" -- this
// table is that baseline. user_permissions (above) remains purely a
// per-user delta on top of it.

db.exec(`

    CREATE TABLE IF NOT EXISTS profile_permissions (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        profile_id INTEGER NOT NULL,

        permission_key TEXT NOT NULL,

        allowed INTEGER NOT NULL DEFAULT 1,

        UNIQUE(profile_id, permission_key)

    );

`);

// Seed the five system permission profiles named in the spec (Sales,
// Accounts, Inventory, HR, Manager) with sensible default grants.
// is_system = 1 marks them as not deletable (see permission-profile-
// repository.ts). "Custom" from the spec's example list isn't a seeded
// row -- it's simply what creating a new, non-system profile from the
// User Management UI produces.

type SystemProfileSeed = {
    name: string;
    description: string;
    grants: string[];
};

const SYSTEM_PROFILE_SEEDS: SystemProfileSeed[] = [
    {
        name: "Sales",
        description: "Orders, customers, and invoices",
        grants: [
            "dashboard.view",
            "products.view",
            "customers.view", "customers.create", "customers.edit",
            "orders.view", "orders.create", "orders.edit",
            "invoices.view", "invoices.create", "invoices.edit"
        ]
    },
    {
        name: "Accounts",
        description: "Accounting and financial reporting",
        grants: [
            "dashboard.view",
            "invoices.view",
            "accounting.view", "accounting.create", "accounting.edit",
            "reports.view"
        ]
    },
    {
        name: "Inventory",
        description: "Products and stock-affecting orders",
        grants: [
            "dashboard.view",
            "products.view", "products.create", "products.edit",
            "inventory.view", "inventory.create", "inventory.edit",
            "orders.view"
        ]
    },
    {
        name: "HR",
        description: "Employee records and certificates",
        grants: [
            "dashboard.view",
            "employees.view", "employees.create", "employees.edit",
            "certificates.view", "certificates.create", "certificates.edit"
        ]
    },
    {
        name: "Manager",
        description: "Broad operational access, excluding Settings and User Management",
        grants: [
            "dashboard.view",
            "products.view", "products.create", "products.edit",
            "inventory.view", "inventory.create", "inventory.edit",
            "customers.view", "customers.create", "customers.edit",
            "orders.view", "orders.create", "orders.edit", "orders.approve",
            "invoices.view", "invoices.create", "invoices.edit",
            "accounting.view",
            "employees.view",
            "certificates.view", "certificates.create", "certificates.print", "certificates.pdf_export",
            "reports.view", "reports.print", "reports.pdf_export",
            "settings.view"
        ]
    }
];

const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO permission_profiles
    (name, description, is_system)
    VALUES (@name, @description, 1)
`);

const findProfileByName = db.prepare(`
    SELECT id FROM permission_profiles WHERE name = ?
`);

const insertProfilePermission = db.prepare(`
    INSERT OR IGNORE INTO profile_permissions
    (profile_id, permission_key, allowed)
    VALUES (@profile_id, @permission_key, 1)
`);

for (const seed of SYSTEM_PROFILE_SEEDS) {

    insertProfile.run({ name: seed.name, description: seed.description });

    const profileRow = findProfileByName.get(seed.name) as { id: number };

    for (const permissionKey of seed.grants) {

        insertProfilePermission.run({
            profile_id: profileRow.id,
            permission_key: permissionKey
        });

    }

}

// Seed the permissions catalog (idempotent -- INSERT OR IGNORE keyed on
// the UNIQUE permission_key). Defined inline rather than imported from
// src/auth/permission-catalog.ts because this file is shared between
// the main process and (via better-sqlite3) needs to stay dependency-
// free of renderer-oriented paths; the two lists are kept in sync by
// convention -- see the comment in permission-catalog.ts.
const PERMISSION_CATALOG_MODULES = [
    "dashboard",
    "products",
    "customers",
    "orders",
    "invoices",
    "inventory",
    "accounting",
    "employees",
    "certificates",
    "reports",
    "settings"
] as const;

const PERMISSION_CATALOG_ACTIONS = [
    "view",
    "create",
    "edit",
    "delete",
    "approve",
    "print",
    "pdf_export"
] as const;

const insertPermission = db.prepare(`
    INSERT OR IGNORE INTO permissions
    (permission_key, module, action, description)
    VALUES (@permission_key, @module, @action, @description)
`);

for (const permissionModule of PERMISSION_CATALOG_MODULES) {

    for (const action of PERMISSION_CATALOG_ACTIONS) {

        insertPermission.run({
            permission_key: `${permissionModule}.${action}`,
            module: permissionModule,
            action,
            description: `${action.charAt(0).toUpperCase()}${action.slice(1)} access to ${permissionModule}`
        });

    }

}

// ==========================
// AUTH INDEXES
// ==========================

db.exec(`

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id
    ON sessions(user_id);

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
    ON sessions(token_hash);

    CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id
    ON user_permissions(user_id);

    CREATE INDEX IF NOT EXISTS idx_profile_permissions_profile_id
    ON profile_permissions(profile_id);

    CREATE INDEX IF NOT EXISTS idx_users_employee_id
    ON users(employee_id);

    CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user_id
    ON password_reset_requests(user_id);

    CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status
    ON password_reset_requests(status);

    CREATE INDEX IF NOT EXISTS idx_password_reset_audit_log_request_id
    ON password_reset_audit_log(request_id);

`);

// ==========================
// DEMO DATA SEED
// ==========================
// Seeds a realistic demo dataset only when the core business tables are
// completely empty. This makes a fresh installation immediately useful
// for simulation/testing without overwriting real user data.

seedDemoData();

// ==========================
// DATABASE INDEXES
// ==========================

db.exec(`

    CREATE INDEX IF NOT EXISTS idx_products_product_id
    ON products(product_id);

    CREATE INDEX IF NOT EXISTS idx_customers_customer_id
    ON customers(customer_id);

    CREATE INDEX IF NOT EXISTS idx_orders_order_id
    ON orders(order_id);

    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_id
    ON invoices(invoice_id);

    CREATE INDEX IF NOT EXISTS idx_inventory_product_id
    ON inventory_transactions(product_id);

    CREATE INDEX IF NOT EXISTS idx_transactions_transaction_id
    ON transactions(transaction_id);

    CREATE INDEX IF NOT EXISTS idx_transactions_transaction_date
    ON transactions(transaction_date);

    CREATE INDEX IF NOT EXISTS idx_transactions_type
    ON transactions(type);

    CREATE INDEX IF NOT EXISTS idx_transactions_source_invoice_id
    ON transactions(source_invoice_id);

    CREATE INDEX IF NOT EXISTS idx_employees_employee_number
    ON employees(employee_number);

`);

// ==========================
// REAL BIDIRECTIONAL CLOUD SYNC — support tables
// ==========================
// cloud_sync_map: the local half of "stable cross-device identity".
// Local `id` (INTEGER PRIMARY KEY AUTOINCREMENT) is never meaningful
// across devices -- PC A's employee id=1 and PC B's employee id=1 are
// unrelated rows. Every table's push to the cloud already computes a
// stable `cloud_local_id` (`${deviceId}:${table}:${businessKeyOrId}`,
// see cloud-sync-manager.ts). This table is what lets a PULL translate
// a cloud record's stable id back into THIS device's own local `id`
// for that table (insert a new row + remember the mapping the first
// time this device sees it; look the mapping up and UPDATE thereafter),
// and is also how a local write that originated here (rather than being
// pulled down) gets remembered so a later pull of its own echo is
// recognized as "already have this" instead of creating a duplicate row.
// `revision` is this record's local view of SyncRevision.version
// (see sync-conflict-service.ts) -- the last revision this device
// either pushed or accepted from a pull, used to detect a genuine
// conflict (both sides changed a record neither had seen the other's
// latest revision of) rather than just always overwriting.
db.exec(`

    CREATE TABLE IF NOT EXISTS cloud_sync_map (

        table_name TEXT NOT NULL,

        cloud_local_id TEXT NOT NULL,

        local_row_id INTEGER NOT NULL,

        revision INTEGER NOT NULL DEFAULT 1,

        content_hash TEXT,

        has_conflict INTEGER NOT NULL DEFAULT 0,

        last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (table_name, cloud_local_id)

    );

`);

db.exec(`

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_sync_map_reverse
    ON cloud_sync_map(table_name, local_row_id);

`);

// sync_cursor: per-table pull watermark ("only ask the cloud for records
// changed after the last time I asked"), so a periodic sync tick pulls
// only what changed since last time instead of re-fetching whole tables
// every cycle (see cloud-sync-manager.ts's syncOnce()). Deliberately a
// single row per table, not a running log -- there is only ever one
// "how far has THIS device's pull gotten" watermark per table.
db.exec(`

    CREATE TABLE IF NOT EXISTS sync_cursor (

        table_name TEXT PRIMARY KEY,

        last_synced_at DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'

    );

`);

// sync_offline_queue: the persisted backing store for
// offline-sync-queue.ts's in-memory OfflineSyncQueue. A push that fails
// because the cloud is unreachable is written here (not just kept in a
// JS array) so a change made offline survives an app restart before
// connectivity returns -- see brief section 8 ("Queue must survive
// restart if the architecture requires persistence"), which it does
// here: MBS is a desktop app that can very plausibly be closed while
// offline and reopened after connectivity is back.
db.exec(`

    CREATE TABLE IF NOT EXISTS sync_offline_queue (

        id TEXT PRIMARY KEY,

        collection TEXT NOT NULL,

        operation TEXT NOT NULL,

        payload TEXT NOT NULL,

        queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

        attempts INTEGER NOT NULL DEFAULT 0,

        last_error TEXT

    );

`);

}

function seedDemoData(): void {

    const coreCounts = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM products) AS products,
            (SELECT COUNT(*) FROM customers) AS customers,
            (SELECT COUNT(*) FROM employees) AS employees,
            (SELECT COUNT(*) FROM orders) AS orders,
            (SELECT COUNT(*) FROM transactions) AS transactions
    `).get() as {
        products: number;
        customers: number;
        employees: number;
        orders: number;
        transactions: number;
    };

    if (
        coreCounts.products > 0 ||
        coreCounts.customers > 0 ||
        coreCounts.employees > 0 ||
        coreCounts.orders > 0 ||
        coreCounts.transactions > 0
    ) {
        return;
    }

    const products: Array<[string, string, string, number, number]> = [
        ["Industrial Sensor", "Automation", "IS-1001", 18500, 72],
        ["Hydraulic Service Kit", "Hydraulics", "HSK-1002", 12500, 58],
        ["Control Module", "Electrical", "CM-1003", 22500, 46],
        ["Safety Relay", "Electrical", "SR-1004", 7800, 84],
        ["24V Power Supply", "Electrical", "PS-1005", 4200, 96],
        ["Pressure Transmitter", "Instrumentation", "PT-1006", 16200, 39],
        ["Temperature Sensor", "Instrumentation", "TS-1007", 6400, 65],
        ["VFD 2.2kW", "Drives", "VFD-1008", 18500, 28],
        ["VFD 5.5kW", "Drives", "VFD-1009", 32500, 24],
        ["Motor Contactor", "Electrical", "MC-1010", 2950, 110],
        ["Overload Relay", "Electrical", "OR-1011", 1850, 92],
        ["Circuit Breaker 32A", "Electrical", "CB-1012", 1250, 140],
        ["Circuit Breaker 63A", "Electrical", "CB-1013", 2450, 105],
        ["Terminal Block", "Electrical", "TB-1014", 180, 420],
        ["Control Transformer", "Electrical", "CT-1015", 3600, 76],
        ["MCCB 100A", "Electrical", "MB-1016", 8900, 54],
        ["MCCB 250A", "Electrical", "MB-1017", 18500, 31],
        ["Digital Multimeter", "Test Equipment", "DM-1018", 5200, 43],
        ["Clamp Meter", "Test Equipment", "CM-1019", 6900, 37],
        ["Insulation Tester", "Test Equipment", "IT-1020", 14500, 22],
        ["Pressure Gauge", "Instrumentation", "PG-1021", 2800, 68],
        ["Flow Meter", "Instrumentation", "FM-1022", 21500, 19],
        ["Solenoid Valve", "Pneumatics", "SV-1023", 4800, 51],
        ["Pneumatic Cylinder", "Pneumatics", "PC-1024", 7600, 44],
        ["Air Regulator", "Pneumatics", "AR-1025", 3200, 73],
        ["Hydraulic Hose 1/2in", "Hydraulics", "HH-1026", 1450, 120],
        ["Hydraulic Hose 3/4in", "Hydraulics", "HH-1027", 2100, 98],
        ["Hydraulic Filter", "Hydraulics", "HF-1028", 1850, 87],
        ["Hydraulic Pump", "Hydraulics", "HP-1029", 38500, 16],
        ["Gear Motor", "Mechanical", "GM-1030", 28500, 18],
        ["AC Motor 2HP", "Motors", "AM-1031", 14500, 32],
        ["AC Motor 5HP", "Motors", "AM-1032", 26500, 21],
        ["Bearing 6204", "Mechanical", "BR-1033", 650, 210],
        ["Bearing 6206", "Mechanical", "BR-1034", 850, 180],
        ["Bearing 6308", "Mechanical", "BR-1035", 1450, 120],
        ["Coupling 25mm", "Mechanical", "CP-1036", 2450, 64],
        ["Timing Belt", "Mechanical", "BT-1037", 1850, 78],
        ["Limit Switch", "Automation", "LS-1038", 1450, 88],
        ["Proximity Sensor", "Automation", "PS-1039", 2850, 67],
        ["Photoelectric Sensor", "Automation", "PE-1040", 4100, 52],
        ["PLC CPU", "Automation", "PLC-1041", 42500, 14],
        ["PLC I/O Module", "Automation", "PLC-1042", 9800, 26],
        ["HMI 7 inch", "Automation", "HMI-1043", 28500, 17],
        ["Ethernet Switch", "Networking", "ES-1044", 6200, 33],
        ["Industrial Router", "Networking", "IR-1045", 11800, 24],
        ["Cable Lug Set", "Electrical", "CL-1046", 950, 160],
        ["Control Cable 1.5mm", "Cables", "CC-1047", 125, 520],
        ["Power Cable 4mm", "Cables", "PC-1048", 285, 410],
        ["Emergency Stop Button", "Safety", "ES-1049", 1350, 75],
        ["Safety Light Curtain", "Safety", "LC-1050", 31500, 9]
    ];

    const customers: Array<[string, string, string, string]> = [
        ["Delta Engineering Ltd.", "+8801711001001", "procurement@deltaeng.example", "Dhaka"],
        ["Prime Industrial Solutions", "+8801711001002", "buy@primeindustrial.example", "Chattogram"],
        ["Northstar Manufacturing", "+8801711001003", "purchase@northstar.example", "Narayanganj"],
        ["Vertex Automation", "+8801711001004", "sales@vertexauto.example", "Dhaka"],
        ["Eastern Power Systems", "+8801711001005", "procurement@easternpower.example", "Gazipur"],
        ["Metro Mechanical Works", "+8801711001006", "accounts@metromech.example", "Dhaka"],
        ["BlueWave Technologies", "+8801711001007", "operations@bluewave.example", "Sylhet"],
        ["Summit Process Industries", "+8801711001008", "purchase@summitprocess.example", "Chattogram"],
        ["Apex Energy Services", "+8801711001009", "procurement@apexenergy.example", "Cumilla"],
        ["Greenfield Packaging", "+8801711001010", "accounts@greenfield.example", "Dhaka"]
    ];

    const employees: Array<[string, string, string, string, string, number]> = [
        ["Arif", "Rahman", "Male", "Administration", "Chief Executive Officer", 185000],
        ["Nusrat", "Jahan", "Female", "Administration", "Managing Director", 165000],
        ["Tanvir", "Hossain", "Male", "Operations", "General Manager", 120000],
        ["Farhana", "Akter", "Female", "Finance & Accounting", "Manager", 95000],
        ["Mahmud", "Hasan", "Male", "Sales", "Manager", 90000],
        ["Sadia", "Khan", "Female", "Human Resources", "Assistant Manager", 72000],
        ["Imran", "Kabir", "Male", "IT / Technical", "Team Lead", 78000],
        ["Rafi", "Islam", "Male", "Finance & Accounting", "Accountant", 62000],
        ["Mim", "Sultana", "Female", "Sales", "Senior Executive", 58000],
        ["Shakil", "Ahmed", "Male", "Warehouse & Inventory", "Supervisor", 52000],
        ["Jannat", "Ara", "Female", "Customer Support", "Customer Support Representative", 48000],
        ["Sabbir", "Haque", "Male", "Production", "Technician", 45000],
        ["Tania", "Rahman", "Female", "Quality Assurance", "Specialist", 51000],
        ["Rakib", "Chowdhury", "Male", "Procurement", "Officer", 47000],
        ["Priya", "Das", "Female", "Marketing", "Executive", 43000],
        ["Fahim", "Alam", "Male", "Logistics", "Coordinator", 42000],
        ["Sumaiya", "Nahar", "Female", "Operations", "Junior Executive", 36000],
        ["Nayeem", "Uddin", "Male", "IT / Technical", "Technician", 40000]
    ];

    const categories = ["Sales Revenue", "Service Income", "Consulting Income", "Maintenance Income"];
    const expenseCategories = ["Rent", "Utilities", "Transport", "Office Supplies", "Maintenance", "Marketing", "Internet", "Staff Welfare"];

    const seed = db.transaction(() => {
        const insertProduct = db.prepare(`
            INSERT INTO products (product_id,name,category,sku,price,stock,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?)
        `);
        const insertCustomer = db.prepare(`
            INSERT INTO customers (customer_id,name,phone,email,address,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?)
        `);
        const insertEmployee = db.prepare(`
            INSERT INTO employees
            (employee_number,first_name,last_name,gender,phone,email,address,department,designation,
             joining_date,employment_status,salary,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        const insertOrder = db.prepare(`
            INSERT INTO orders
            (order_id,customer_id,customer_name,product_id,product_name,quantity,price,total,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `);
        const insertInventory = db.prepare(`
            INSERT INTO inventory_transactions (product_id,type,quantity,note,created_at)
            VALUES (?,?,?,?,?)
        `);
        const insertTransaction = db.prepare(`
            INSERT INTO transactions
            (transaction_id,type,category,description,amount,payment_method,reference_no,transaction_date,notes,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `);
        const insertInvoice = db.prepare(`
            INSERT INTO invoices
            (invoice_id,order_id,customer_id,customer_name,items,subtotal,discount,tax,total,paid,due,
             payment_method,status,invoice_date,due_date,notes,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);

        const now = new Date();
        const isoDaysAgo = (days: number, hour = 10) => {
            const d = new Date(now);
            d.setDate(d.getDate() - days);
            d.setHours(hour, 0, 0, 0);
            return d.toISOString();
        };

        products.forEach((p, i) => {
            const date = isoDaysAgo(75 - (i % 50));
            insertProduct.run(`PRD-${String(i + 1).padStart(6, "0")}`, p[0], p[1], p[2], p[3], p[4], date, date);
            insertInventory.run(p[2], "IN", p[4], "Demo opening stock", date);
        });

        customers.forEach((c, i) => {
            const date = isoDaysAgo(70 - i);
            insertCustomer.run(`CUS-${String(i + 1).padStart(6, "0")}`, c[0], c[1], c[2], c[3], date, date);
        });

        employees.forEach((e, i) => {
            const date = isoDaysAgo(360 - (i * 11));
            insertEmployee.run(
                `EMP-${String(i + 1).padStart(4, "0")}`,
                e[0], e[1], e[2], `+8801712${String(300000 + i).slice(-6)}`,
                `${String(e[0]).toLowerCase()}.${String(e[1]).toLowerCase()}@mooral-demo.example`,
                "Dhaka, Bangladesh", e[3], e[4], date, "Active", e[5], date, date
            );
        });

        const orderRows: Array<[number, number, number, number, string]> = [
            [0,0,0,3,"Completed"],[1,1,1,4,"Completed"],[2,2,2,2,"Completed"],[3,3,3,5,"Pending"],[4,4,4,6,"Completed"],
            [5,5,5,3,"Completed"],[6,6,6,7,"Processing"],[7,7,7,4,"Completed"],[8,8,8,2,"Pending"],[9,9,9,5,"Completed"],
            [10,0,10,8,"Completed"],[11,1,11,6,"Completed"],[12,2,12,3,"Pending"],[13,3,13,10,"Completed"],[14,4,14,4,"Completed"]
        ];

        orderRows.forEach((r, i) => {
            const customerIndex = r[1];
            const productIndex = r[2];
            const quantity = r[3];
            const status = r[4];
            const p = products[productIndex];
            const c = customers[customerIndex];
            const price = Number(p[3]);
            const total = price * quantity;
            const date = isoDaysAgo(60 - i * 3, 9 + (i % 7));
            const orderId = `ORD-${String(i + 1).padStart(6, "0")}`;

            insertOrder.run(orderId, `CUS-${String(customerIndex + 1).padStart(6, "0")}`, c[0],
                `PRD-${String(productIndex + 1).padStart(6, "0")}`, p[0], quantity, price, total, status, date, date);

            // Mirror the application's stock allocation behavior for seeded orders.
            db.prepare(`UPDATE products SET stock = stock - ?, updated_at = ? WHERE product_id = ?`)
                .run(quantity, date, `PRD-${String(productIndex + 1).padStart(6, "0")}`);
            insertInventory.run(`PRD-${String(productIndex + 1).padStart(6, "0")}`, "OUT", quantity, `Demo order ${orderId}`, date);

            // Completed orders automatically produce realistic invoice data.
            if (status === "Completed") {
                const paid = i % 3 === 0 ? Math.round(total * 0.5) : total;
                const due = total - paid;
                const invoiceStatus = due === 0 ? "Paid" : "Partially Paid";
                const invoiceId = `INV-${String(i + 1).padStart(6, "0")}`;
                const item = JSON.stringify([{ product_id: `PRD-${String(productIndex + 1).padStart(6, "0")}`, product_name: p[0], quantity, price, total }]);
                const dueDate = new Date(date); dueDate.setDate(dueDate.getDate() + 30);
                insertInvoice.run(invoiceId, orderId, `CUS-${String(customerIndex + 1).padStart(6, "0")}`, c[0], item,
                    total, 0, 0, total, paid, due, "Cash", invoiceStatus, date, dueDate.toISOString(), "Demo invoice data", date, date);
            }
        });

        for (let i = 0; i < 20; i++) {
            const isIncome = i % 2 === 0;
            const category = isIncome ? categories[i / 2 % categories.length] : expenseCategories[Math.floor(i / 2) % expenseCategories.length];
            const amount = isIncome ? 18000 + i * 4250 : 6500 + i * 1850;
            const date = isoDaysAgo(55 - i * 2, 11 + (i % 6));
            insertTransaction.run(
                `TXN-${String(i + 1).padStart(6, "0")}`,
                isIncome ? "Income" : "Expense",
                category,
                isIncome ? `${category} - demo receipt` : `${category} - demo payment`,
                amount,
                i % 3 === 0 ? "Bank Transfer" : "Cash",
                `DEMO-${String(i + 1).padStart(4, "0")}`,
                date,
                "Demo simulation data",
                date,
                date
            );
        }
    });

    seed();
    console.log("Mooral Business Suite demo data seeded: 50 products, 10 customers, 18 employees, 15 orders, invoices and 20 accounting transactions.");
}

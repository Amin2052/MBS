import { getDatabase } from "../database/database";


// ===============================
// TYPES
// ===============================

export type AccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

export interface Account {
    id: number;
    code: string;
    name: string;
    type: AccountType;
    is_system: number;
    created_at?: string;
}

export interface JournalEntry {
    id: number;
    journal_id: string;
    entry_date: string;
    debit_account_id: number;
    debit_account_name: string;
    credit_account_id: number;
    credit_account_name: string;
    amount: number;
    reference: string | null;
    reference_type: string | null;
    description: string | null;
    created_at?: string;
}

export interface LedgerEntry {
    id: number;
    journal_id: string | null;
    account_id: number;
    account_name: string;
    customer_id: string | null;
    customer_name: string | null;
    entry_date: string;
    debit: number;
    credit: number;
    running_balance: number;
    reference_id: string | null;
    reference_type: string | null;
    description: string | null;
    notes: string | null;
    created_at?: string;
}


// The fixed system accounts every automatic posting rule (Section 4)
// targets. Seeded in database.ts's initializeDatabase(); looked up by
// code here rather than hard-coding ids since ids depend on insert
// order.
export const SYSTEM_ACCOUNT_CODES = {
    CASH_BANK: "1000",
    ACCOUNTS_RECEIVABLE: "1100",
    SALES_REVENUE: "4000",
    GENERAL_EXPENSE: "5000"
} as const;



// ===============================
// CHART OF ACCOUNTS
// ===============================

export function getAccounts(): Account[] {

    const db = getDatabase();

    return db.prepare(`

        SELECT *

        FROM accounts

        ORDER BY code ASC

    `).all() as Account[];

}



export function getSystemAccount(
    db: ReturnType<typeof getDatabase>,
    code: string
): Account {

    const account = db.prepare(`

        SELECT *

        FROM accounts

        WHERE code = ?

    `).get(code) as Account | undefined;

    if (!account) {
        throw new Error(
            `System account ${code} is missing. The database may not have run its migrations.`
        );
    }

    return account;

}



// Finds an account by name (case-insensitive) + type, creating it if
// it doesn't exist yet. Used for manual Income/Expense transactions so
// that, e.g., every distinct expense category the user has already
// been typing into the existing Accounting form (Rent, Utilities, ...)
// becomes its own general-ledger account automatically, without any
// new UI for managing the Chart of Accounts.
export function getOrCreateAccount(
    db: ReturnType<typeof getDatabase>,
    name: string,
    type: AccountType
): Account {

    const trimmedName = name.trim();

    const existing = db.prepare(`

        SELECT *

        FROM accounts

        WHERE LOWER(name) = LOWER(?)
        AND type = ?

    `).get(trimmedName, type) as Account | undefined;

    if (existing) {
        return existing;
    }

    const code = generateAccountCode(db, type);

    db.prepare(`

        INSERT INTO accounts (code, name, type, is_system)
        VALUES (@code, @name, @type, 0)

    `).run({
        code,
        name: trimmedName,
        type
    });

    return db.prepare(`

        SELECT *

        FROM accounts

        WHERE code = ?

    `).get(code) as Account;

}



const ACCOUNT_TYPE_PREFIX: Record<AccountType, string> = {
    Asset: "1",
    Liability: "2",
    Equity: "3",
    Income: "4",
    Expense: "5"
};



function generateAccountCode(
    db: ReturnType<typeof getDatabase>,
    type: AccountType
): string {

    const prefix = ACCOUNT_TYPE_PREFIX[type];

    const rows = db.prepare(`

        SELECT code

        FROM accounts

        WHERE type = ?

    `).all(type) as { code: string }[];

    const maxCode = rows.reduce((max, row) => {
        const parsed = parseInt(row.code, 10);
        return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, parseInt(`${prefix}000`, 10));

    return String(maxCode + 1);

}



// ===============================
// JOURNAL ID GENERATOR
// ===============================
// Same "highest number used so far, plus one" pattern as
// generateTransactionId() in accounting-repository.ts.

export function generateJournalId(
    db: ReturnType<typeof getDatabase>
): string {

    const rows = db.prepare(`

        SELECT journal_id

        FROM journal_entries

        WHERE journal_id LIKE 'JRN-%'

    `).all() as { journal_id: string }[];

    const maxNumber = rows.reduce((max, row) => {
        const parsed = parseInt(row.journal_id.replace("JRN-", ""), 10);
        return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    return `JRN-${String(maxNumber + 1).padStart(6, "0")}`;

}



// ===============================
// POSTING ENGINE
// ===============================

export interface PostJournalParams {

    entry_date: string;

    debitAccount: Account;
    debitCustomerId?: string | null;
    debitCustomerName?: string | null;

    creditAccount: Account;
    creditCustomerId?: string | null;
    creditCustomerName?: string | null;

    amount: number;

    // Business reference (invoice id, transaction id, ...) shown to
    // the user. Combined with reference_type, also used as the
    // idempotency key that prevents duplicate automatic postings.
    reference: string;
    reference_type: string;

    description: string;

    notes?: string;

}


/**
 * Posts a balanced journal entry (one debit line + one credit line,
 * same amount) and expands it into the ledger. Returns the new
 * journal_id, or null if a posting already exists for this
 * (reference_type, reference) pair -- callers rely on this to satisfy
 * "duplicate posting must be prevented" for automatic postings.
 */
export function postJournalEntry(
    params: PostJournalParams
): string | null {

    const db = getDatabase();

    if (
        typeof params.amount !== "number" ||
        !Number.isFinite(params.amount) ||
        params.amount <= 0
    ) {
        throw new Error("Journal amount must be a positive number.");
    }

    if (params.debitAccount.id === params.creditAccount.id) {
        throw new Error("Debit and credit accounts must be different.");
    }

    const existing = db.prepare(`

        SELECT id

        FROM journal_entries

        WHERE reference_type = ?
        AND reference = ?

    `).get(params.reference_type, params.reference);

    if (existing) {
        // Already posted for this business event -- no-op, not an error.
        return null;
    }

    const journal_id = generateJournalId(db);

    // This function is also called while an Order -> Invoice operation
    // is already inside a database transaction. better-sqlite3 does not
    // allow starting a second transaction on the same connection, so
    // reuse the caller's transaction when one is already active.
    const postBody = () => {

        db.prepare(`

            INSERT INTO journal_entries
            (
                journal_id, entry_date,
                debit_account_id, debit_account_name,
                credit_account_id, credit_account_name,
                amount, reference, reference_type, description
            )
            VALUES
            (
                @journal_id, @entry_date,
                @debit_account_id, @debit_account_name,
                @credit_account_id, @credit_account_name,
                @amount, @reference, @reference_type, @description
            )

        `).run({
            journal_id,
            entry_date: params.entry_date,
            debit_account_id: params.debitAccount.id,
            debit_account_name: params.debitAccount.name,
            credit_account_id: params.creditAccount.id,
            credit_account_name: params.creditAccount.name,
            amount: params.amount,
            reference: params.reference,
            reference_type: params.reference_type,
            description: params.description
        });

        insertLedgerLine(db, {
            journal_id,
            account: params.debitAccount,
            entry_date: params.entry_date,
            debit: params.amount,
            credit: 0,
            customer_id: params.debitCustomerId ?? null,
            customer_name: params.debitCustomerName ?? null,
            reference_id: params.reference,
            reference_type: params.reference_type,
            description: params.description,
            notes: params.notes ?? ""
        });

        insertLedgerLine(db, {
            journal_id,
            account: params.creditAccount,
            entry_date: params.entry_date,
            debit: 0,
            credit: params.amount,
            customer_id: params.creditCustomerId ?? null,
            customer_name: params.creditCustomerName ?? null,
            reference_id: params.reference,
            reference_type: params.reference_type,
            description: params.description,
            notes: params.notes ?? ""
        });

    };

    if (db.inTransaction) {
        postBody();
    } else {
        db.transaction(postBody)();
    }

    recalcAccountBalance(db, params.debitAccount.id, params.debitCustomerId ?? null);
    recalcAccountBalance(db, params.creditAccount.id, params.creditCustomerId ?? null);

    return journal_id;

}


/**
 * Reverses whatever was posted for a business event: deletes its
 * journal entry and both ledger lines, then recalculates running
 * balances for the affected accounts. A no-op if nothing was ever
 * posted for that reference.
 */
export function voidJournalEntry(
    reference_type: string,
    reference: string
): void {

    const db = getDatabase();

    const journal = db.prepare(`

        SELECT *

        FROM journal_entries

        WHERE reference_type = ?
        AND reference = ?

    `).get(reference_type, reference) as JournalEntry | undefined;

    if (!journal) {
        return;
    }

    const affected = db.prepare(`

        SELECT DISTINCT account_id, customer_id

        FROM ledger_entries

        WHERE journal_id = ?

    `).all(journal.journal_id) as { account_id: number; customer_id: string | null }[];

    const remove = db.transaction(() => {

        db.prepare(`
            DELETE FROM ledger_entries
            WHERE journal_id = ?
        `).run(journal.journal_id);

        db.prepare(`
            DELETE FROM journal_entries
            WHERE journal_id = ?
        `).run(journal.journal_id);

    });

    remove();

    affected.forEach(line =>
        recalcAccountBalance(db, line.account_id, line.customer_id)
    );

}


/**
 * Create-or-replace for automatic postings whose amount can change
 * after the fact (invoice payments being edited, manual transactions
 * being edited). Voids whatever was previously posted for this
 * reference, then posts fresh -- avoiding any duplicate/stale entries
 * without needing per-field diffing.
 */
export function upsertJournalEntry(
    params: PostJournalParams
): string | null {

    voidJournalEntry(params.reference_type, params.reference);

    if (params.amount <= 0) {
        return null;
    }

    return postJournalEntry(params);

}



function insertLedgerLine(
    db: ReturnType<typeof getDatabase>,
    line: {
        journal_id: string;
        account: Account;
        entry_date: string;
        debit: number;
        credit: number;
        customer_id: string | null;
        customer_name: string | null;
        reference_id: string;
        reference_type: string;
        description: string;
        notes: string;
    }
) {

    db.prepare(`

        INSERT INTO ledger_entries
        (
            journal_id, account_id, account_name,
            customer_id, customer_name, entry_date,
            debit, credit, running_balance,
            reference_id, reference_type, description, notes
        )
        VALUES
        (
            @journal_id, @account_id, @account_name,
            @customer_id, @customer_name, @entry_date,
            @debit, @credit, 0,
            @reference_id, @reference_type, @description, @notes
        )

    `).run({
        journal_id: line.journal_id,
        account_id: line.account.id,
        account_name: line.account.name,
        customer_id: line.customer_id,
        customer_name: line.customer_name,
        entry_date: line.entry_date,
        debit: line.debit,
        credit: line.credit,
        reference_id: line.reference_id,
        reference_type: line.reference_type,
        description: line.description,
        notes: line.notes
    });

}


// Recomputes running_balance for every ledger line of one (account,
// customer) pair, in chronological order. Scoped to a single account's
// lines only (never the whole ledger table), so this stays cheap even
// though it's called on every post/void -- the alternative of trying
// to patch a single row's running balance in place breaks the moment
// entries are voided or backdated.
function recalcAccountBalance(
    db: ReturnType<typeof getDatabase>,
    accountId: number,
    customerId: string | null
): void {

    const rows = customerId
        ? db.prepare(`
            SELECT id, debit, credit
            FROM ledger_entries
            WHERE account_id = ?
            AND customer_id = ?
            ORDER BY entry_date ASC, id ASC
        `).all(accountId, customerId) as { id: number; debit: number; credit: number }[]
        : db.prepare(`
            SELECT id, debit, credit
            FROM ledger_entries
            WHERE account_id = ?
            AND customer_id IS NULL
            ORDER BY entry_date ASC, id ASC
        `).all(accountId) as { id: number; debit: number; credit: number }[];

    const update = db.prepare(`
        UPDATE ledger_entries
        SET running_balance = ?
        WHERE id = ?
    `);

    let running = 0;

    for (const row of rows) {
        running += Number(row.debit || 0) - Number(row.credit || 0);
        update.run(running, row.id);
    }

}



// ===============================
// MANUAL JOURNAL ENTRY (UI)
// ===============================

export interface ManualJournalInput {
    entry_date: string;
    debit_account_id: number;
    credit_account_id: number;
    amount: number;
    reference?: string;
    description: string;
}


export function createManualJournalEntry(
    input: ManualJournalInput
): JournalEntry {

    const db = getDatabase();

    if (
        typeof input.amount !== "number" ||
        !Number.isFinite(input.amount) ||
        input.amount <= 0
    ) {
        throw new Error("Amount must be a positive number.");
    }

    if (input.debit_account_id === input.credit_account_id) {
        throw new Error("Debit and credit accounts must be different.");
    }

    if (!input.description || !input.description.trim()) {
        throw new Error("Description is required.");
    }

    const debitAccount = db.prepare(`
        SELECT * FROM accounts WHERE id = ?
    `).get(input.debit_account_id) as Account | undefined;

    const creditAccount = db.prepare(`
        SELECT * FROM accounts WHERE id = ?
    `).get(input.credit_account_id) as Account | undefined;

    if (!debitAccount || !creditAccount) {
        throw new Error("Invalid debit or credit account.");
    }

    // Manual entries have no natural external business id to key
    // duplicate-detection off, and each one is intentionally a new,
    // distinct posting -- so the journal_id itself (generated up
    // front) is used as the reference when the user leaves it blank.
    // This keeps postJournalEntry's duplicate check meaningful without
    // ever accidentally rejecting a legitimate manual entry.
    const journal_id = generateJournalId(db);
    const reference = input.reference?.trim() || journal_id;

    postJournalEntryWithId(db, journal_id, {
        entry_date: input.entry_date,
        debitAccount,
        creditAccount,
        amount: input.amount,
        reference,
        reference_type: "manual",
        description: input.description
    });

    return db.prepare(`
        SELECT * FROM journal_entries WHERE journal_id = ?
    `).get(journal_id) as JournalEntry;

}


// Internal variant of postJournalEntry that takes an already-generated
// journal_id, used by createManualJournalEntry so the id it returns to
// the caller and the id actually written to the database always match.
function postJournalEntryWithId(
    db: ReturnType<typeof getDatabase>,
    journal_id: string,
    params: Omit<PostJournalParams, "notes">
): void {

    const post = db.transaction(() => {

        db.prepare(`

            INSERT INTO journal_entries
            (
                journal_id, entry_date,
                debit_account_id, debit_account_name,
                credit_account_id, credit_account_name,
                amount, reference, reference_type, description
            )
            VALUES
            (
                @journal_id, @entry_date,
                @debit_account_id, @debit_account_name,
                @credit_account_id, @credit_account_name,
                @amount, @reference, @reference_type, @description
            )

        `).run({
            journal_id,
            entry_date: params.entry_date,
            debit_account_id: params.debitAccount.id,
            debit_account_name: params.debitAccount.name,
            credit_account_id: params.creditAccount.id,
            credit_account_name: params.creditAccount.name,
            amount: params.amount,
            reference: params.reference,
            reference_type: params.reference_type,
            description: params.description
        });

        insertLedgerLine(db, {
            journal_id,
            account: params.debitAccount,
            entry_date: params.entry_date,
            debit: params.amount,
            credit: 0,
            customer_id: params.debitCustomerId ?? null,
            customer_name: params.debitCustomerName ?? null,
            reference_id: params.reference,
            reference_type: params.reference_type,
            description: params.description,
            notes: ""
        });

        insertLedgerLine(db, {
            journal_id,
            account: params.creditAccount,
            entry_date: params.entry_date,
            debit: 0,
            credit: params.amount,
            customer_id: params.creditCustomerId ?? null,
            customer_name: params.creditCustomerName ?? null,
            reference_id: params.reference,
            reference_type: params.reference_type,
            description: params.description,
            notes: ""
        });

    });

    post();

    recalcAccountBalance(db, params.debitAccount.id, params.debitCustomerId ?? null);
    recalcAccountBalance(db, params.creditAccount.id, params.creditCustomerId ?? null);

}



// ===============================
// QUERIES
// ===============================

export function getJournalEntries(filters?: {
    fromDate?: string;
    toDate?: string;
}): JournalEntry[] {

    const db = getDatabase();

    let query = `

        SELECT *

        FROM journal_entries

        WHERE 1=1

    `;

    const params: any = {};

    if (filters?.fromDate) {
        query += ` AND date(entry_date) >= date(@fromDate) `;
        params.fromDate = filters.fromDate;
    }

    if (filters?.toDate) {
        query += ` AND date(entry_date) <= date(@toDate) `;
        params.toDate = filters.toDate;
    }

    query += ` ORDER BY id DESC `;

    return db.prepare(query).all(params) as JournalEntry[];

}



export function getCustomerLedger(
    customerId: string,
    fromDate?: string,
    toDate?: string
): LedgerEntry[] {

    const db = getDatabase();

    let query = `

        SELECT *

        FROM ledger_entries

        WHERE customer_id = @customerId

    `;

    const params: any = { customerId };

    if (fromDate) {
        query += ` AND date(entry_date) >= date(@fromDate) `;
        params.fromDate = fromDate;
    }

    if (toDate) {
        query += ` AND date(entry_date) <= date(@toDate) `;
        params.toDate = toDate;
    }

    query += ` ORDER BY entry_date ASC, id ASC `;

    return db.prepare(query).all(params) as LedgerEntry[];

}



// Distinct customers that have at least one ledger line, for the
// Customer Ledger view's selector -- avoids joining the customers
// table (this codebase's repositories don't use SQL joins anywhere).
export function getCustomersWithLedgerActivity(): { customer_id: string; customer_name: string }[] {

    const db = getDatabase();

    return db.prepare(`

        SELECT customer_id, MAX(customer_name) AS customer_name

        FROM ledger_entries

        WHERE customer_id IS NOT NULL
        AND customer_id != ''

        GROUP BY customer_id

        ORDER BY customer_name ASC

    `).all() as { customer_id: string; customer_name: string }[];

}



export function getGeneralLedger(filters?: {
    accountId?: number;
    fromDate?: string;
    toDate?: string;
}): LedgerEntry[] {

    const db = getDatabase();

    let query = `

        SELECT *

        FROM ledger_entries

        WHERE customer_id IS NULL

    `;

    const params: any = {};

    if (filters?.accountId) {
        query += ` AND account_id = @accountId `;
        params.accountId = filters.accountId;
    }

    if (filters?.fromDate) {
        query += ` AND date(entry_date) >= date(@fromDate) `;
        params.fromDate = filters.fromDate;
    }

    if (filters?.toDate) {
        query += ` AND date(entry_date) <= date(@toDate) `;
        params.toDate = filters.toDate;
    }

    query += ` ORDER BY entry_date ASC, id ASC `;

    return db.prepare(query).all(params) as LedgerEntry[];

}



export interface AccountSummaryRow extends Account {
    balance: number;
    totalDebit: number;
    totalCredit: number;
}


// One row per Chart-of-Accounts account: its current balance (general
// ledger only -- customer sub-ledgers are what the Customer Ledger
// view is for) plus lifetime debit/credit turnover.
export function getAccountSummary(): AccountSummaryRow[] {

    const db = getDatabase();

    const accounts = getAccounts();

    const latestBalanceStmt = db.prepare(`

        SELECT running_balance

        FROM ledger_entries

        WHERE account_id = ?
        AND customer_id IS NULL

        ORDER BY entry_date DESC, id DESC

        LIMIT 1

    `);

    const totalsStmt = db.prepare(`

        SELECT

            COALESCE(SUM(debit), 0) AS totalDebit,
            COALESCE(SUM(credit), 0) AS totalCredit

        FROM ledger_entries

        WHERE account_id = ?

    `);

    return accounts.map(account => {

        const latest = latestBalanceStmt.get(account.id) as { running_balance: number } | undefined;
        const totals = totalsStmt.get(account.id) as { totalDebit: number; totalCredit: number };

        return {
            ...account,
            balance: latest?.running_balance ?? 0,
            totalDebit: totals.totalDebit,
            totalCredit: totals.totalCredit
        };

    });

}

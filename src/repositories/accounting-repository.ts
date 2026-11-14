import { getDatabase } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";
import {
    getOrCreateAccount,
    getSystemAccount,
    upsertJournalEntry,
    voidJournalEntry,
    SYSTEM_ACCOUNT_CODES
} from "./ledger-repository";


// ===============================
// TYPES
// ===============================

export interface AccountingTransaction {

    type: string;

    category: string;

    description: string;

    amount: number;

    payment_method: string;

    reference_no?: string;

    transaction_date: string;

    notes?: string;

    // Set only for transactions auto-generated from an invoice payment.
    // NULL/undefined for manually entered transactions. Replaces the old
    // soft match on reference_no + type + category.
    source_invoice_id?: string | null;

}



// ===============================
// GET ALL TRANSACTIONS
// ===============================

export function getTransactions() {

    const db = getDatabase();

    return db.prepare(`

        SELECT *

        FROM transactions

        ORDER BY id DESC

    `).all();

}



// ===============================
// GET TRANSACTION BY ID
// ===============================

export function getTransactionById(id: number) {

    const db = getDatabase();

    return db.prepare(`

        SELECT *

        FROM transactions

        WHERE id = ?

    `).get(id);

}



// ===============================
// SUMMARY
// ===============================

export function getTransactionSummary(

    fromDate?: string,

    toDate?: string

) {

    const db = getDatabase();

    let query = `

        SELECT

            COUNT(*) AS totalTransactions,


            COALESCE(
                SUM(
                    CASE
                        WHEN type='Income'
                        THEN amount
                        ELSE 0
                    END
                ),
                0
            ) AS totalIncome,


            COALESCE(
                SUM(
                    CASE
                        WHEN type='Expense'
                        THEN amount
                        ELSE 0
                    END
                ),
                0
            ) AS totalExpense,


            COALESCE(
                SUM(
                    CASE
                        WHEN type='Income'
                        THEN amount
                        WHEN type='Expense'
                        THEN -amount
                        ELSE 0
                    END
                ),
                0
            ) AS balance


        FROM transactions

        WHERE 1=1

    `;

    const params: any = {};

    if (fromDate) {

        query += `

            AND date(transaction_date)
            >= date(@fromDate)

        `;

        params.fromDate = fromDate;

    }

    if (toDate) {

        query += `

            AND date(transaction_date)
            <= date(@toDate)

        `;

        params.toDate = toDate;

    }

    return db.prepare(query).get(params);

}



// ===============================
// LEDGER: AUTOMATIC POSTING (Expense / manual Income)
// ===============================
// Section 4 of Task 10's "Expense" rule (Debit Expense Account, Credit
// Cash/Bank) plus the symmetric case for a manually entered Income row
// (Debit Cash/Bank, Credit Sales/Other Income). Invoice-generated rows
// (source_invoice_id set) are skipped here -- those are posted by
// invoice-repository.ts's own invoice_creation/invoice_payment rules
// instead, so this never double-posts the same sale.
//
// The category the user typed becomes its own general-ledger account
// (e.g. "Rent", "Utilities") via getOrCreateAccount, so the Chart of
// Accounts grows to match how the business already categorizes its
// transactions, without any new UI for managing accounts.

function postManualTransactionEntry(
    db: ReturnType<typeof getDatabase>,
    transaction_id: string,
    transaction: AccountingTransaction
) {

    if (transaction.source_invoice_id) {
        return;
    }

    const amount = Number(transaction.amount ?? 0);

    if (!amount || amount <= 0) {
        return;
    }

    const cash = getSystemAccount(db, SYSTEM_ACCOUNT_CODES.CASH_BANK);

    if (transaction.type === "Expense") {

        const expenseAccount = getOrCreateAccount(db, transaction.category, "Expense");

        upsertJournalEntry({
            entry_date: transaction.transaction_date,
            debitAccount: expenseAccount,
            creditAccount: cash,
            amount,
            reference: transaction_id,
            reference_type: "manual_expense",
            description: transaction.description
        });

    }
    else if (transaction.type === "Income") {

        const incomeAccount = getOrCreateAccount(db, transaction.category, "Income");

        upsertJournalEntry({
            entry_date: transaction.transaction_date,
            debitAccount: cash,
            creditAccount: incomeAccount,
            amount,
            reference: transaction_id,
            reference_type: "manual_income",
            description: transaction.description
        });

    }

}


// A manual transaction being edited can switch between Income and
// Expense, which means its posting can move from one reference_type
// to the other. Voiding both before reposting keeps this simple and
// correct without needing to track the transaction's previous type.
function voidManualTransactionEntry(transaction_id: string) {
    voidJournalEntry("manual_expense", transaction_id);
    voidJournalEntry("manual_income", transaction_id);
}



// ===============================
// CREATE
// ===============================

export function createTransaction(

    transaction: AccountingTransaction

) {

    const db = getDatabase();

    const { count: existingTransactionCount } = db.prepare(`SELECT COUNT(*) as count FROM transactions`).get() as { count: number };
    assertWithinQuota("accountingRecords", existingTransactionCount);

    const transaction_id = generateTransactionId();

    const result = db.prepare(`

        INSERT INTO transactions

        (

            transaction_id,

            type,

            category,

            description,

            amount,

            payment_method,

            reference_no,

            transaction_date,

            notes,

            source_invoice_id

        )

        VALUES

        (

            @transaction_id,

            @type,

            @category,

            @description,

            @amount,

            @payment_method,

            @reference_no,

            @transaction_date,

            @notes,

            @source_invoice_id

        )

    `).run({

        transaction_id,

        type: transaction.type,

        category: transaction.category,

        description: transaction.description,

        amount: Number(transaction.amount ?? 0),

        payment_method: transaction.payment_method,

        reference_no: transaction.reference_no ?? "",

        transaction_date: transaction.transaction_date,

        notes: transaction.notes ?? "",

        source_invoice_id: transaction.source_invoice_id ?? null

    });

    postManualTransactionEntry(db, transaction_id, transaction);

    return result;

}



// ===============================
// UPDATE
// ===============================

export function updateTransaction(

    id: number,

    transaction: AccountingTransaction

) {

    const db = getDatabase();

    const existing = db.prepare(`
        SELECT transaction_id, source_invoice_id
        FROM transactions
        WHERE id = ?
    `).get(id) as { transaction_id: string; source_invoice_id: string | null } | undefined;

    const result = db.prepare(`

        UPDATE transactions

        SET

            type=@type,

            category=@category,

            description=@description,

            amount=@amount,

            payment_method=@payment_method,

            reference_no=@reference_no,

            transaction_date=@transaction_date,

            notes=@notes,

            updated_at=CURRENT_TIMESTAMP

        WHERE id=@id

    `).run({

        id,

        type: transaction.type,

        category: transaction.category,

        description: transaction.description,

        amount: Number(transaction.amount ?? 0),

        payment_method: transaction.payment_method,

        reference_no: transaction.reference_no ?? "",

        transaction_date: transaction.transaction_date,

        notes: transaction.notes ?? ""

    });

    // LEDGER: re-post to match the edited amount/category/type. The
    // type can flip between Income and Expense on an edit, so void
    // both possible reference_types first (see
    // voidManualTransactionEntry) rather than trying to track what it
    // used to be.
    if (existing && !existing.source_invoice_id) {
        voidManualTransactionEntry(existing.transaction_id);
        postManualTransactionEntry(db, existing.transaction_id, transaction);
    }

    return result;

}



// ===============================
// DELETE
// ===============================

export function deleteTransaction(id: number) {

    const db = getDatabase();

    const existing = db.prepare(`
        SELECT transaction_id, source_invoice_id
        FROM transactions
        WHERE id = ?
    `).get(id) as { transaction_id: string; source_invoice_id: string | null } | undefined;

    const result = db.prepare(`

        DELETE FROM transactions

        WHERE id = ?

    `).run(id);

    // LEDGER: invoice-generated rows are reversed by
    // invoice-repository.ts's own voidJournalEntry calls (deleteInvoice
    // / payment updates) -- this only cleans up manual entries.
    if (existing && !existing.source_invoice_id) {
        voidManualTransactionEntry(existing.transaction_id);
    }

    return result;

}



// ===============================
// ID GENERATOR
// ===============================
//
// The numeric sequence is GLOBAL across both manually entered
// transactions (TXN-000001) and invoice-generated transactions
// (TXN/INV-000001). There is no separate counter per type -- the
// next number is always "highest number used so far, regardless of
// prefix, plus one". Pass isInvoice=true when generating the id for
// an accounting entry auto-created from an invoice.

export function generateTransactionId(isInvoice: boolean = false) {

    const db = getDatabase();

    const rows = db.prepare(`

        SELECT transaction_id

        FROM transactions

        WHERE transaction_id LIKE 'TXN-%'
        OR transaction_id LIKE 'TXN/INV-%'

    `).all() as { transaction_id: string }[];

    const maxNumber = rows.reduce((max, r) => {
        const numericPart = r.transaction_id.includes("TXN/INV-")
            ? r.transaction_id.replace("TXN/INV-", "")
            : r.transaction_id.replace("TXN-", "");
        const parsed = parseInt(numericPart, 10);
        return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    const nextNumber = String(maxNumber + 1).padStart(6, "0");

    return isInvoice
        ? `TXN/INV-${nextNumber}`
        : `TXN-${nextNumber}`;

}
// ===============================
// GET TRANSACTIONS BY DATE
// ===============================

export function getTransactionsByDate(

    fromDate?: string,

    toDate?: string

) {

    const db = getDatabase();

    let query = `

        SELECT *

        FROM transactions

        WHERE 1=1

    `;

    const params: any = {};

    if (fromDate) {

        query += `

            AND date(transaction_date)
            >= date(@fromDate)

        `;

        params.fromDate = fromDate;

    }

    if (toDate) {

        query += `

            AND date(transaction_date)
            <= date(@toDate)

        `;

        params.toDate = toDate;

    }

    query += `

        ORDER BY transaction_date DESC

    `;

    return db.prepare(query).all(params);

}
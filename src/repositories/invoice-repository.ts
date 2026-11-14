import { getDatabase, getNextSequenceValue } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";
import { generateTransactionId } from "./accounting-repository";
import {
    postJournalEntry,
    upsertJournalEntry,
    voidJournalEntry,
    getSystemAccount,
    SYSTEM_ACCOUNT_CODES
} from "./ledger-repository";


// ===============================
// LEDGER: AUTOMATIC POSTING RULES
// ===============================
// Section 4 of Task 10 -- Invoice Creation and Payment Receive each
// post a balanced journal entry automatically. Both are keyed by
// invoice_id via ledger-repository's reference_type + reference
// idempotency check, so re-running either call (e.g. the same invoice
// update handler firing twice) can never double-post.

function normalizeCustomerId(customer_id?: string | null): string | null {
    return customer_id && customer_id.trim() ? customer_id.trim() : null;
}


// Invoice Creation: Debit Customer (Accounts Receivable), Credit Sales
// Revenue. Posted once, at the moment the invoice is created -- this
// recognizes the sale regardless of whether/when it gets paid, which
// is what the existing paid-only single-entry `transactions` logic
// below does not do.
function postInvoiceCreationEntry(
    db: ReturnType<typeof getDatabase>,
    invoice_id: string,
    customer_id: string | null | undefined,
    customer_name: string,
    total: number,
    invoice_date: string
) {

    if (!total || total <= 0) {
        return;
    }

    const receivable = getSystemAccount(db, SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE);
    const sales = getSystemAccount(db, SYSTEM_ACCOUNT_CODES.SALES_REVENUE);

    const normalizedCustomerId = normalizeCustomerId(customer_id);

    postJournalEntry({
        entry_date: invoice_date,
        debitAccount: receivable,
        debitCustomerId: normalizedCustomerId,
        debitCustomerName: normalizedCustomerId ? customer_name : null,
        creditAccount: sales,
        amount: total,
        reference: invoice_id,
        reference_type: "invoice_creation",
        description: `Invoice ${invoice_id} - ${customer_name}`
    });

}


// Payment Receive: Debit Cash/Bank, Credit Customer (Accounts
// Receivable). `paid` is the invoice's current cumulative paid amount
// (not a per-payment delta -- same convention the existing
// transactions-table logic already uses), so upsertJournalEntry
// replaces the previous posting for this invoice each time it's
// called rather than accumulating separate lines.
function postInvoicePaymentEntry(
    db: ReturnType<typeof getDatabase>,
    invoice_id: string,
    customer_id: string | null | undefined,
    customer_name: string,
    paid: number,
    payment_method: string,
    invoice_date: string
) {

    const cash = getSystemAccount(db, SYSTEM_ACCOUNT_CODES.CASH_BANK);
    const receivable = getSystemAccount(db, SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE);

    const normalizedCustomerId = normalizeCustomerId(customer_id);

    upsertJournalEntry({
        entry_date: invoice_date,
        debitAccount: cash,
        creditAccount: receivable,
        creditCustomerId: normalizedCustomerId,
        creditCustomerName: normalizedCustomerId ? customer_name : null,
        amount: paid,
        reference: invoice_id,
        reference_type: "invoice_payment",
        description: `Payment received - Invoice ${invoice_id} (${payment_method || "Cash"})`
    });

}



// ===============================
// ACCOUNTING AUTO INCOME HELPER
// ===============================

function createInvoiceIncomeTransaction(
    invoice_id: string,
    customer_name: string,
    paid: number,
    payment_method: string,
    invoice_date: string
) {

    if (paid <= 0) {
        return;
    }


    const db = getDatabase();


    const existing = db.prepare(`

        SELECT id

        FROM transactions

        WHERE source_invoice_id = ?

    `).get(invoice_id);


    if (existing) {

        return;

    }



    // Invoice-generated entries use the TXN/INV prefix but share the
    // same global numeric sequence as manually entered transactions.
    const transaction_id = generateTransactionId(true);



    db.prepare(`

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

            'Income',

            'Sales',

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

        description:
            `Invoice Payment - ${customer_name}`,

        amount: paid,

        payment_method:
            payment_method || "Cash",

        reference_no:
            invoice_id,

        transaction_date:
            invoice_date,

        notes:
            "Auto generated from invoice payment",

        source_invoice_id:
            invoice_id

    });


}





function updateInvoiceIncomeTransaction(

    invoice_id:string,

    customer_id:string,

    customer_name:string,

    paid:number,

    payment_method:string,

    invoice_date:string

){


    const db = getDatabase();


    // ===============================
    // LEDGER: PAYMENT RECEIVE POSTING
    // ===============================
    // Debit Cash/Bank, Credit Customer (Accounts Receivable). Runs
    // independently of the legacy single-entry `transactions` logic
    // below -- upsertJournalEntry itself handles every case (no
    // payment yet -> nothing to void; amount changed -> void old,
    // post new; paid dropped to 0 -> void only), keyed off the
    // invoice_id so it can never double-post for the same invoice.
    postInvoicePaymentEntry(
        db,
        invoice_id,
        customer_id,
        customer_name,
        paid,
        payment_method,
        invoice_date
    );


    const existing = db.prepare(`

        SELECT id

        FROM transactions

        WHERE source_invoice_id = ?

    `).get(invoice_id) as {id:number} | undefined;



    if(paid <= 0){

        // The invoice no longer has a paid amount to record as income.
        // If a transaction was previously auto-created for it, it must
        // be removed too, or Accounting keeps overstating revenue for
        // an invoice that's no longer (fully or partially) paid.
        if(existing){

            db.prepare(`
                DELETE FROM transactions
                WHERE id = ?
            `).run(existing.id);

        }

        return;

    }



    if(existing){


        db.prepare(`

            UPDATE transactions

            SET

            amount=?,

            payment_method=?,

            transaction_date=?,

            updated_at=CURRENT_TIMESTAMP

            WHERE id=?

        `).run(

            paid,

            payment_method || "Cash",

            invoice_date,

            existing.id

        );


    }
    else{


        createInvoiceIncomeTransaction(

            invoice_id,

            customer_name,

            paid,

            payment_method,

            invoice_date

        );


    }


}






export type InvoiceItem = {

    product_id?: string;

    product_name: string;

    quantity: number;

    price: number;

    total: number;

};



export type Invoice = {

    id?: number;

    invoice_id:string;

    /**
     * The order this invoice was automatically created from. Always
     * set for invoices created via createInvoiceFromCompletedOrder();
     * null/undefined only for invoices that predate this link (legacy
     * data). Manual invoice creation has been removed -- see
     * order-repository.ts's createOrder()/updateOrder() for the only
     * place invoices are now created.
     */
    order_id?:string;

    customer_id?:string;

    customer_name:string;

    items?:InvoiceItem[];

    subtotal:number;

    discount:number;

    tax:number;

    total:number;

    paid:number;

    due:number;

    payment_method:string;

    status:string;

    invoice_date:string;

    due_date?:string;

    notes?:string;

    created_at?:string;

    updated_at?:string;

};



type InvoiceRow =
Omit<Invoice,"items">
& {

    items:string|null;

};




function parseInvoiceItems(value:string|null|undefined): Invoice["items"] {

    if(!value){
        return [];
    }

    try{
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }catch{
        // Older/local invoice rows may contain JavaScript-style object text
        // (for example [{product_id: "...", ...}]) instead of strict JSON.
        // Recover the common safe subset without using eval/Function.
        try{
            const normalized = value
                .trim()
                .replace(/([{,])\s*([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
                .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, content:string) =>
                    `"${content.replace(/"/g, '\\"')}"`
                );

            const parsed = JSON.parse(normalized);
            return Array.isArray(parsed) ? parsed : [];
        }catch{
            // A malformed legacy row must not make the entire Invoice page fail.
            return [];
        }
    }

}


function mapInvoiceRow(row:InvoiceRow):Invoice{

    return {

        ...row,

        items: parseInvoiceItems(row.items)

    };

}
// ===============================
// GET ALL INVOICES
// ===============================

export function getInvoices(filters?: {

    search?: string;

    status?: string;

    fromDate?: string;

    toDate?: string;

}):Invoice[]{


    const db = getDatabase();


    let query = `

        SELECT *

        FROM invoices

        WHERE 1=1

    `;


    const params:any = {};



    if(filters?.search){

        query += `

        AND (

            invoice_id LIKE @search

            OR customer_name LIKE @search

        )

        `;


        params.search =
            `%${filters.search}%`;

    }




    if(
        filters?.status &&
        filters.status !== "All"
    ){

        query += `

        AND status=@status

        `;


        params.status =
            filters.status;

    }




    if(filters?.fromDate){

        query += `

        AND date(invoice_date)
        >=
        date(@fromDate)

        `;


        params.fromDate =
            filters.fromDate;

    }




    if(filters?.toDate){

        query += `

        AND date(invoice_date)
        <=
        date(@toDate)

        `;


        params.toDate =
            filters.toDate;

    }




    query += `

        ORDER BY id DESC

    `;




    const rows =
        db.prepare(query)
        .all(params) as InvoiceRow[];



    return rows.map(mapInvoiceRow);


}






// ===============================
// GET SINGLE INVOICE
// ===============================


export function getInvoiceById(
    id:number
):Invoice|undefined{


    const db=getDatabase();


    const row =
        db.prepare(`

            SELECT *

            FROM invoices

            WHERE id=?

        `)
        .get(id) as InvoiceRow|undefined;



    return row
        ?
        mapInvoiceRow(row)
        :
        undefined;


}






// ===============================
// SUMMARY
// ===============================


export function getInvoiceSummary(){


    const db=getDatabase();


    return db.prepare(`


        SELECT


        COUNT(*) AS totalInvoices,


        COALESCE(
            SUM(total),
            0
        )
        AS totalAmount,


        COALESCE(
            SUM(paid),
            0
        )
        AS totalPaid,


        COALESCE(
            SUM(due),
            0
        )
        AS totalDue,


        COALESCE(

            SUM(
                CASE
                WHEN status='Paid'
                THEN 1
                ELSE 0
                END
            ),

            0

        )
        AS paidCount,


        COALESCE(

            SUM(
                CASE
                WHEN status='Unpaid'
                THEN 1
                ELSE 0
                END
            ),

            0

        )
        AS unpaidCount,


        COALESCE(

            SUM(
                CASE
                WHEN status='Partial'
                THEN 1
                ELSE 0
                END
            ),

            0

        )
        AS partialCount,


        COALESCE(

            SUM(
                CASE
                WHEN status='Overdue'
                THEN 1
                ELSE 0
                END
            ),

            0

        )
        AS overdueCount


        FROM invoices


    `).get();


}






// ===============================
// GENERATE INVOICE ID
// ===============================


// Backed by the id_counters table (see database.ts's
// getNextSequenceValue()): a monotonic counter, not a MAX(invoice_id)
// scheme, so a deleted invoice's number is NEVER reused. The counter is
// lazily seeded from the current MAX(invoice_id)+1 the first time it's
// used, so upgrading an existing installation is seamless. Must be
// called inside the same db.transaction() as the INSERT that consumes
// it (see createInvoiceFromCompletedOrder() below) for the
// read-increment to be atomic.
function generateInvoiceId(
    db:ReturnType<typeof getDatabase>
){

    const next = getNextSequenceValue(db, "invoice_id", () => {
        const rows =
            db.prepare(`
                SELECT invoice_id
                FROM invoices
                WHERE invoice_id LIKE 'INV-%'
            `)
            .all() as { invoice_id: string }[];

        return rows.reduce((max, r) => {
            const parsed = parseInt(r.invoice_id.replace("INV-", ""), 10);
            return Number.isNaN(parsed) ? max : Math.max(max, parsed);
        }, 0) + 1;
    });

    return `INV-${String(next).padStart(6,"0")}`;

}


/**
 * Applies a stock change to a product and records it in the same
 * inventory_transactions ledger used across Inventory/Products/Orders,
 * so Invoices never drifts out of sync with Inventory. Mirrors the
 * applyStockDelta() helper in order-repository.ts exactly.
 *
 * delta > 0 restores stock (invoice edited down / deleted).
 * delta < 0 deducts stock (invoice created / quantity increased).
 *
 * A missing/blank product_id (a free-text line item not tied to
 * inventory) or a since-deleted product is a safe no-op, matching how
 * the rest of the app already tolerates invoices/orders referencing a
 * customer or product that no longer exists.
 */
function applyInvoiceStockDelta(
    db: ReturnType<typeof getDatabase>,
    product_id: string | undefined | null,
    delta: number,
    note: string
) {

    if (!product_id || delta === 0) return;

    const product = db.prepare(`
        SELECT id, stock
        FROM products
        WHERE product_id = ?
    `).get(product_id) as { id: number; stock: number } | undefined;

    if (!product) return;

    if (delta < 0 && product.stock + delta < 0) {

        throw new Error(
            `Not enough stock available (have ${product.stock}, need ${Math.abs(delta)}).`
        );

    }

    db.prepare(`
        UPDATE products
        SET stock = stock + ?
        WHERE id = ?
    `).run(delta, product.id);

    db.prepare(`
        INSERT INTO inventory_transactions
        (product_id, type, quantity, note)
        VALUES (?, ?, ?, ?)
    `).run(
        product_id,
        delta > 0 ? "IN" : "OUT",
        Math.abs(delta),
        note
    );

}


/**
 * Reduces an invoice's items down to total quantity per product_id,
 * ignoring items with no linked product (free-text line items).
 */
function itemQuantitiesByProduct(
    items: { product_id?: string; quantity: number }[] | undefined
): Record<string, number> {

    const totals: Record<string, number> = {};

    for (const item of items ?? []) {

        if (!item.product_id) continue;

        totals[item.product_id] =
            (totals[item.product_id] ?? 0) + Number(item.quantity ?? 0);

    }

    return totals;

}


/**
 * Applies the net stock change between an invoice's old item list and
 * its new one, product by product. Used by both createInvoice (old = {})
 * and updateInvoice/deleteInvoice (new = {}).
 */
function reconcileInvoiceStock(
    db: ReturnType<typeof getDatabase>,
    oldItems: { product_id?: string; quantity: number }[] | undefined,
    newItems: { product_id?: string; quantity: number }[] | undefined,
    invoiceLabel: string
) {

    const oldTotals = itemQuantitiesByProduct(oldItems);
    const newTotals = itemQuantitiesByProduct(newItems);

    const productIds = new Set([
        ...Object.keys(oldTotals),
        ...Object.keys(newTotals)
    ]);

    for (const product_id of productIds) {

        const before = oldTotals[product_id] ?? 0;
        const after = newTotals[product_id] ?? 0;
        const delta = before - after;

        if (delta !== 0) {

            applyInvoiceStockDelta(
                db,
                product_id,
                delta,
                invoiceLabel
            );

        }

    }

}




// ===============================
// CREATE INVOICE FROM COMPLETED ORDER
// ===============================
//
// The ONLY way an invoice is created (manual invoice creation has
// been removed per the Invoice System Redesign). Called from
// order-repository.ts's createOrder()/updateOrder() whenever an
// order's status becomes "Completed". Product, customer, and
// quantity/price data always come from the linked order -- never
// entered manually.

export function createInvoiceFromCompletedOrder(
    db: ReturnType<typeof getDatabase>,
    order: {
        order_id: string;
        customer_id?: string | null;
        customer_name: string;
        status?: string;
    }
): { invoice_id: string } | null {

    const existing = db.prepare(`
        SELECT invoice_id
        FROM invoices
        WHERE order_id = ?
    `).get(order.order_id) as { invoice_id: string } | undefined;

    const rows = db.prepare(`
        SELECT product_id, product_name, quantity, price, total
        FROM orders
        WHERE order_id = ?
        ORDER BY id ASC
    `).all(order.order_id) as Array<{
        product_id?: string | null;
        product_name: string;
        quantity: number;
        price: number;
        total: number;
    }>;

    if (!rows.length) return null;

    const items = rows.map(row => ({
        product_id: row.product_id ?? "",
        product_name: row.product_name,
        quantity: Number(row.quantity ?? 0),
        price: Number(row.price ?? 0),
        total: Number(row.total ?? 0)
    }));

    if (existing) {
        // Keep the existing invoice/payment data intact; only refresh its
        // line items and calculated subtotal/total so one order can contain
        // multiple products.
        const current = db.prepare(`
            SELECT discount, tax, paid
            FROM invoices
            WHERE invoice_id = ?
        `).get(existing.invoice_id) as { discount: number; tax: number; paid: number };

        const subtotal = items.reduce((sum, item) => sum + item.total, 0);
        const discount = Number(current?.discount ?? 0);
        const tax = Number(current?.tax ?? 0);
        const total = Math.max(0, subtotal - discount + tax);
        const paid = Number(current?.paid ?? 0);
        const due = Math.max(0, total - paid);

        db.prepare(`
            UPDATE invoices
            SET items = ?, subtotal = ?, total = ?, due = ?, tax = ?, discount = ?, updated_at = CURRENT_TIMESTAMP
            WHERE invoice_id = ?
        `).run(
            JSON.stringify(items), subtotal, total, due, tax, discount, existing.invoice_id
        );

        return { invoice_id: existing.invoice_id };
    }

    // Same atomicity fix as createOrder()'s order_id: id generation and
    // the INSERT that consumes it now happen inside one db.transaction()
    // (better-sqlite3 nests this as a SAVEPOINT when already inside the
    // caller's transaction, e.g. from createOrder()), so an invoice_id
    // can never be handed out twice.
    let invoice_id = "";

    const insertInvoice = db.transaction(() => {

        invoice_id = generateInvoiceId(db);
        const { count: existingInvoiceCount } = db.prepare(`SELECT COUNT(*) as count FROM invoices`).get() as { count: number };
        assertWithinQuota("invoices", existingInvoiceCount);
        const subtotal = items.reduce((sum, item) => sum + item.total, 0);
        const discount = 0;
        const tax = 0;
        const total = subtotal;
        const paid = 0;
        const due = total;
        const status = "Unpaid";
        const invoice_date = new Date().toISOString();

        db.prepare(`
            INSERT INTO invoices
            (invoice_id, order_id, customer_id, customer_name, items,
             subtotal, discount, tax, total, paid, due, payment_method,
             status, invoice_date, due_date, notes)
            VALUES
            (@invoice_id, @order_id, @customer_id, @customer_name, @items,
             @subtotal, @discount, @tax, @total, @paid, @due, @payment_method,
             @status, @invoice_date, @due_date, @notes)
        `).run({
            invoice_id,
            order_id: order.order_id,
            customer_id: order.customer_id ?? "",
            customer_name: order.customer_name,
            items: JSON.stringify(items),
            subtotal,
            discount,
            tax,
            total,
            paid,
            due,
            payment_method: "Cash",
            status,
            invoice_date,
            due_date: null,
            notes: ""
        });

        postInvoiceCreationEntry(
            db,
            invoice_id,
            order.customer_id,
            order.customer_name,
            total,
            invoice_date
        );

    });

    insertInvoice();

    return { invoice_id };

}
// ===============================
// UPDATE INVOICE
// ===============================


export function updateInvoice(

    id:number,

    invoice:any

){


    const db=getDatabase();



    const subtotal =
        Number(invoice.subtotal ?? 0);



    const discount =
        Number(invoice.discount ?? 0);



    const tax =
        Number(invoice.tax ?? 0);



    const total =
        Number(
            invoice.total ??
            (
                subtotal -
                discount +
                tax
            )
        );



    const paid =
        Number(invoice.paid ?? 0);



    const due =
        Number(
            invoice.due ??
            (
                total -
                paid
            )
        );



    let status =
        invoice.status;



    if(!status){


        if(paid<=0){

            status="Unpaid";

        }
        else if(due<=0){

            status="Paid";

        }
        else{

            status="Partial";

        }

    }



    const invoice_date =
        invoice.invoice_date ??
        new Date().toISOString();



    const existingInvoice =
        db.prepare(`

            SELECT invoice_id, items

            FROM invoices

            WHERE id=?

        `)
        .get(id) as
        {
            invoice_id:string;
            items: string | null;
        }
        |
        undefined;


    const oldItems = parseInvoiceItems(existingInvoice?.items);


    const applyUpdate = db.transaction(() => {

    const result =
    db.prepare(`


        UPDATE invoices


        SET


        customer_id=@customer_id,


        customer_name=@customer_name,


        items=@items,


        subtotal=@subtotal,


        discount=@discount,


        tax=@tax,


        total=@total,


        paid=@paid,


        due=@due,


        payment_method=@payment_method,


        status=@status,


        invoice_date=@invoice_date,


        due_date=@due_date,


        notes=@notes,


        updated_at=CURRENT_TIMESTAMP


        WHERE id=@id


    `).run({


        id,


        customer_id:
            invoice.customer_id ?? "",


        customer_name:
            invoice.customer_name,


        items:
            JSON.stringify(
                invoice.items ?? []
            ),


        subtotal,


        discount,


        tax,


        total,


        paid,


        due,


        payment_method:
            invoice.payment_method ?? "Cash",


        status,


        invoice_date,


        due_date:
            invoice.due_date ?? null,


        notes:
            invoice.notes ?? ""


    });


    // Keep Inventory in sync: reconcile whatever changed between the
    // invoice's old item list and its new one, product by product. If
    // the new items need more stock than is available, this throws and
    // the whole transaction (including the update above) rolls back.
    if (existingInvoice) {

        reconcileInvoiceStock(
            db,
            oldItems,
            invoice.items,
            `Invoice ${existingInvoice.invoice_id} updated`
        );

    }


    // UPDATE ACCOUNTING ENTRY

    if(existingInvoice){


        updateInvoiceIncomeTransaction(

            existingInvoice.invoice_id,

            invoice.customer_id ?? "",

            invoice.customer_name,

            paid,

            invoice.payment_method ?? "Cash",

            invoice_date

        );


    }


    return result;

    });


    return applyUpdate();


}







// ===============================
// DELETE INVOICE
// ===============================


export function deleteInvoice(
    id:number
){


    const db=getDatabase();



    const invoice =
        db.prepare(`

            SELECT invoice_id, items

            FROM invoices

            WHERE id=?

        `)
        .get(id) as
        {
            invoice_id:string;
            items: string | null;
        }
        |
        undefined;


    const applyDelete = db.transaction(() => {

        if(invoice){


            db.prepare(`

                DELETE FROM transactions

                WHERE source_invoice_id=?


            `)
            .run(invoice.invoice_id);


            // LEDGER: reverse both automatic postings for this invoice
            // (creation and, if any, payment) so a deleted invoice
            // never leaves stale ledger/journal rows behind.
            voidJournalEntry("invoice_creation", invoice.invoice_id);
            voidJournalEntry("invoice_payment", invoice.invoice_id);


        }


        const result = db.prepare(`

            DELETE FROM invoices

            WHERE id=?


        `)
        .run(id);


        // Deleting an invoice releases whatever stock its items had
        // allocated, same as deleteOrder() -- otherwise deleted invoices
        // would leave products permanently short.
        if (invoice) {

            const items = parseInvoiceItems(invoice.items);

            reconcileInvoiceStock(
                db,
                items,
                [],
                `Invoice ${invoice.invoice_id} deleted - stock restored`
            );

        }


        return result;

    });


    return applyDelete();


}
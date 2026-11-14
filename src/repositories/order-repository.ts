import { getDatabase, getNextSequenceValue } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";
import { createInvoiceFromCompletedOrder } from "./invoice-repository";


/**
 * A single product line belonging to an order.
 */
export type OrderItem = {

    product_id: string;

    product_name: string;

    quantity: number;

    price: number;

    total: number;

};


/**
 * Raw per-line-item row as it is actually stored in the `orders` table.
 * One logical order with several products is several rows that all share
 * the same `order_id` (see database.ts's ORDERS TABLE MIGRATION note and
 * createOrder() below). This shape should never leak outside this file --
 * every other module (IPC handlers, the Orders page, invoices) must only
 * ever see the grouped `Order` shape defined below.
 */
type OrderRow = {

    id: number;

    order_id: string;

    customer_id?: string | null;

    customer_name: string;

    product_id?: string | null;

    product_name: string;

    quantity: number;

    price: number;

    total: number;

    status: string;

    created_at?: string | null;

    updated_at?: string | null;

};


/**
 * One order = one customer = one order number = one status = many
 * products. This is the shape every caller outside this file works with.
 *
 * `id` is a representative row id (the most recently written line item's
 * row id) kept only so the Orders page can target update()/delete() the
 * same way it already does for every other module -- it is resolved back
 * to the order's `order_id` internally before touching the database.
 */
export type Order = {

    id?: number;

    order_id: string;

    customer_id?: string;

    customer_name: string;

    status: string;

    items: OrderItem[];

    products_count: number;

    total: number;

    created_at?: string;

    updated_at?: string;

};


/**
 * Applies a stock change to a product and records it in the same
 * inventory_transactions ledger used by stockIn()/stockOut() (inventory
 * repository) and by Products' manual stock edits, so Orders never
 * drifts out of sync with Inventory.
 *
 * delta > 0 restores stock (order edited down / deleted / cancelled).
 * delta < 0 deducts stock (order created / quantity increased).
 *
 * If the order isn't linked to a real product (product_id empty) or the
 * product has since been deleted, this is a safe no-op rather than a
 * crash — matches how the rest of the app already tolerates orders
 * referencing a since-deleted customer/product via their stored
 * name snapshot.
 */
function applyStockDelta(
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
 * Groups raw one-row-per-line-item DB rows (sharing an `order_id`) into
 * one grouped Order per order_id, with all of its products under `items`.
 * This is what makes "one order = one row" true for every caller outside
 * this file, regardless of how many products the order has.
 *
 * `rows` must already be sorted by (order_id, id ASC) so that items land
 * in the order they were added and the representative `id`/`updated_at`/
 * `created_at` bookkeeping below (which just tracks running min/max) stays
 * correct in a single pass.
 */
function groupOrderRows(rows: OrderRow[]): Order[] {

    const groups = new Map<string, Order>();

    for (const row of rows) {

        let group = groups.get(row.order_id);

        if (!group) {
            group = {
                id: row.id,
                order_id: row.order_id,
                customer_id: row.customer_id ?? "",
                customer_name: row.customer_name,
                status: row.status,
                items: [],
                products_count: 0,
                total: 0,
                created_at: row.created_at ?? undefined,
                updated_at: row.updated_at ?? undefined
            };
            groups.set(row.order_id, group);
        }

        group.items.push({
            product_id: row.product_id ?? "",
            product_name: row.product_name,
            quantity: Number(row.quantity ?? 0),
            price: Number(row.price ?? 0),
            total: Number(row.total ?? 0)
        });

        group.total += Number(row.total ?? 0);
        group.products_count = group.items.length;

        // The representative `id` exposed to every caller outside this
        // file is the order's FIRST (lowest, permanent) row id, not the
        // most-recently-touched one. updateOrder() below preserves each
        // surviving line item's row id across edits (UPDATE in place,
        // not delete+reinsert), so as long as that original first line
        // item is never itself removed from the order, this id is
        // stable for the order's entire lifetime -- callers (the Orders
        // page, orders:edit/orders:delete IPC handlers) can hold onto
        // it across a save without it going stale.
        if (group.id === undefined || row.id < group.id) {
            group.id = row.id;
        }

        if (row.created_at && (!group.created_at || row.created_at < group.created_at)) {
            group.created_at = row.created_at;
        }

        if (row.updated_at && (!group.updated_at || row.updated_at > group.updated_at)) {
            group.updated_at = row.updated_at;
        }

    }

    return Array.from(groups.values())
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));

}



// GET ALL ORDERS
// Returns one grouped Order per order_id (one row per order, many
// products under `items`), not one row per line item.

export function getOrders(
    fromDate?: string,
    toDate?: string
): Order[] {


    const db = getDatabase();


    let query = `

        SELECT *

        FROM orders

    `;


    const params:any[] = [];



    if(fromDate || toDate){


        query += `

            WHERE 1 = 1

        `;



        if(fromDate){


            query += `

                AND date(created_at) >= date(?)

            `;


            params.push(fromDate);


        }



        if(toDate){


            query += `

                AND date(created_at) <= date(?)

            `;


            params.push(toDate);


        }


    }




    // Rows must come out grouped by order_id first (line items in the
    // order they were added within each order) so groupOrderRows() can
    // build each order's `items` list, and the running-max `id` tracking
    // it does, in a single pass.
    query += `

        ORDER BY order_id ASC, id ASC

    `;


    const rows = db
        .prepare(query)
        .all(...params) as OrderRow[];

    return groupOrderRows(rows);


}




// CREATE ORDER

export function createOrder(order: any) {

    const db = getDatabase();

    // Backed by the id_counters table (see database.ts's
    // getNextSequenceValue()): a monotonic counter, not a MAX(order_id)
    // or row-count/array-length scheme, so a deleted order's number is
    // NEVER reused -- MAX-based generation could hand out ORD-000005
    // again after the original ORD-000005 was deleted; a persisted,
    // always-incrementing counter cannot. The counter is lazily seeded
    // from the current MAX(order_id)+1 the first time it's used, so
    // upgrading an existing installation is seamless: no renumbering,
    // no collision with orders created before this counter existed.
    // Must be called inside the same db.transaction() as the INSERT
    // that consumes it (see below) for the read-increment to be atomic.
    function generateOrderId() {
        const next = getNextSequenceValue(db, "order_id", () => {
            const rows = db.prepare(`
                SELECT order_id
                FROM orders
                WHERE order_id LIKE 'ORD-%'
            `).all() as { order_id: string }[];

            return rows.reduce((max, r) => {
                const parsed = parseInt(r.order_id.replace("ORD-", ""), 10);
                return Number.isNaN(parsed) ? max : Math.max(max, parsed);
            }, 0) + 1;
        });

        return `ORD-${String(next).padStart(6, "0")}`;
    }

    const { count: existingOrderCount } = db.prepare(`SELECT COUNT(*) as count FROM orders`).get() as { count: number };
    assertWithinQuota("orders", existingOrderCount);
    const status: string = order.status ?? "Pending";
    const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [order];

    if (!items.length) {
        throw new Error("At least one product is required.");
    }

    let order_id = "";

    try {
        const insert = db.transaction(() => {
            order_id = generateOrderId();
            const results = [];

            for (const item of items) {
                const quantity = Number(item.quantity ?? 0);
                const price = Number(item.price ?? item.unit_price ?? 0);
                const total = Number(item.total ?? quantity * price);

                if (!item.product_id || !item.product_name) {
                    throw new Error("Product is required.");
                }
                if (!Number.isFinite(quantity) || quantity <= 0) {
                    throw new Error("Quantity must be a positive number.");
                }

                const result = db.prepare(`
                    INSERT INTO orders
                    (order_id, customer_id, customer_name, product_id, product_name,
                     quantity, price, total, status)
                    VALUES
                    (@order_id, @customer_id, @customer_name, @product_id, @product_name,
                     @quantity, @price, @total, @status)
                `).run({
                    order_id,
                    customer_id: order.customer_id ?? "",
                    customer_name: order.customer_name,
                    product_id: item.product_id,
                    product_name: item.product_name,
                    quantity,
                    price,
                    total,
                    status
                });

                applyStockDelta(
                    db,
                    item.product_id,
                    -quantity,
                    `Order ${order_id} created`
                );

                results.push(result);
            }

            return results;
        });

        insert();

        if (status === "Completed") {
            createInvoiceFromCompletedOrder(db, {
                order_id,
                customer_id: order.customer_id,
                customer_name: order.customer_name,
                status
            });
        }

        // Electron IPC uses structured cloning. Do not return better-sqlite3
        // RunResult objects because they are not safely cloneable.
        return {
            order_id,
            status,
            item_count: items.length
        };
    } catch (error) {
        console.error("ORDER INSERT FAILED", error);
        throw error;
    }
}



// UPDATE ORDER
//
// `id` targets a representative row id (as returned by getOrders(), see
// the Order type above) which is resolved to its order_id here. The
// order's entire product list is then rewritten from `order.items` in one
// transaction: every existing line item's stock is restored, all of the
// order's rows are synced in place with the submitted item list: rows for
// products still present are UPDATEd (keeping their row `id` stable),
// rows for products no longer present are deleted, and only genuinely
// new products get a new row/id. Stock is re-allocated for the submitted
// items the same way it always was. This keeps one order = one order_id
// = many rows in sync however many products were added/removed/changed
// in the edit, WITHOUT reassigning the `id` of any line item that
// survives the edit -- editingOrder.id (and any other id a caller is
// holding onto) stays valid across a save.

export function updateOrder(
    id: number,
    order: any
) {

    const db = getDatabase();

    const target = db.prepare(`
        SELECT order_id
        FROM orders
        WHERE id = ?
    `).get(id) as { order_id: string } | undefined;

    if (!target) {
        throw new Error("Order not found.");
    }

    const order_id = target.order_id;

    // Snapshot every line item this order currently has (not just the
    // one row `id` points at), sorted by id ASC so that when several
    // existing rows share the same product_id (a pre-existing duplicate
    // -- not created by normal use, but not impossible), the lowest/
    // oldest row id is always the one preferentially preserved.
    const existingRows = db.prepare(`
        SELECT id, product_id, quantity
        FROM orders
        WHERE order_id = ?
        ORDER BY id ASC
    `).all(order_id) as { id: number; product_id: string | null; quantity: number }[];

    const createdAtRow = db.prepare(`
        SELECT MIN(created_at) as created_at
        FROM orders
        WHERE order_id = ?
    `).get(order_id) as { created_at: string | null } | undefined;

    const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [order];

    if (!items.length) {
        throw new Error("At least one product is required.");
    }

    const newStatus: string = order.status ?? "Pending";

    const applyUpdate = db.transaction(() => {

        // Restore stock for every line item currently on the order --
        // the re-allocation below (for updated rows and new rows alike)
        // then re-applies whatever the submitted quantities actually
        // are. Net effect on stock is identical to the old delete+
        // reinsert approach; only row identity handling changes.
        for (const row of existingRows) {

            if (row.product_id) {

                applyStockDelta(
                    db,
                    row.product_id,
                    row.quantity,
                    `Order ${order_id} updated - stock restored`
                );

            }

        }

        // Match submitted items against existing rows by product_id so
        // a still-present product UPDATEs its existing row (same `id`)
        // instead of being deleted and reinserted. Each existing row is
        // consumed at most once, even if the submitted list somehow
        // repeats a product_id.
        const availableRowsByProduct = new Map<string, number[]>();
        for (const row of existingRows) {
            if (!row.product_id) continue;
            const list = availableRowsByProduct.get(row.product_id) ?? [];
            list.push(row.id);
            availableRowsByProduct.set(row.product_id, list);
        }

        const consumedRowIds = new Set<number>();

        for (const item of items) {

            const quantity = Number(item.quantity ?? 0);
            const price = Number(item.price ?? item.unit_price ?? 0);
            const total = Number(item.total ?? quantity * price);

            if (!item.product_id || !item.product_name) {
                throw new Error("Product is required.");
            }
            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error("Quantity must be a positive number.");
            }

            const candidateRowIds = availableRowsByProduct.get(item.product_id);
            const reuseRowId = candidateRowIds && candidateRowIds.length
                ? candidateRowIds.shift()
                : undefined;

            if (reuseRowId !== undefined) {

                // Product still present -- UPDATE the existing row in
                // place. Its `id` and `created_at` are never touched.
                db.prepare(`
                    UPDATE orders
                    SET customer_id = @customer_id,
                        customer_name = @customer_name,
                        product_name = @product_name,
                        quantity = @quantity,
                        price = @price,
                        total = @total,
                        status = @status
                    WHERE id = @id
                `).run({
                    id: reuseRowId,
                    customer_id: order.customer_id ?? "",
                    customer_name: order.customer_name,
                    product_name: item.product_name,
                    quantity,
                    price,
                    total,
                    status: newStatus
                });

                consumedRowIds.add(reuseRowId);

            } else {

                // Genuinely new product on this order -- a new row (and
                // therefore a new id) is unavoidable here, same as it
                // always was for a brand-new line item.
                db.prepare(`
                    INSERT INTO orders
                    (order_id, customer_id, customer_name, product_id, product_name,
                     quantity, price, total, status, created_at)
                    VALUES
                    (@order_id, @customer_id, @customer_name, @product_id, @product_name,
                     @quantity, @price, @total, @status, @created_at)
                `).run({
                    order_id,
                    customer_id: order.customer_id ?? "",
                    customer_name: order.customer_name,
                    product_id: item.product_id,
                    product_name: item.product_name,
                    quantity,
                    price,
                    total,
                    status: newStatus,
                    created_at: createdAtRow?.created_at ?? null
                });

            }

            applyStockDelta(
                db,
                item.product_id,
                -quantity,
                `Order ${order_id} updated - stock allocated`
            );

        }

        // Any existing row not matched by a submitted item is a product
        // that was removed from the order on this edit -- delete it.
        // Its stock was already restored above and is not re-allocated.
        for (const row of existingRows) {
            if (!consumedRowIds.has(row.id)) {
                db.prepare(`DELETE FROM orders WHERE id = ?`).run(row.id);
            }
        }

    });

    try {
        applyUpdate();
    } catch (error) {
        console.error("ORDER UPDATE FAILED", error);
        throw error;
    }

    // Keep invoice creation outside the order transaction. This makes
    // Pending -> Completed reliable even when invoice accounting uses its
    // own transaction. Calling this for every Completed save is safe
    // because createInvoiceFromCompletedOrder() checks order_id and
    // refreshes (rather than duplicating) an invoice that already exists,
    // picking up every product currently on the order.
    if (newStatus === "Completed") {
        createInvoiceFromCompletedOrder(db, {
            order_id,
            customer_id: order.customer_id,
            customer_name: order.customer_name,
            status: newStatus
        });
    }

    return {
        order_id,
        status: newStatus,
        item_count: items.length
    };

}




// DELETE ORDER
//
// `id` targets a representative row id, resolved to its order_id here so
// every product line belonging to the order is deleted (and its stock
// restored), not just the single row `id` points at.

export function deleteOrder(id: number) {


    const db = getDatabase();


    const target = db.prepare(`
        SELECT order_id
        FROM orders
        WHERE id = ?
    `).get(id) as { order_id: string } | undefined;

    if (!target) {
        throw new Error("Order not found.");
    }

    const order_id = target.order_id;

    // Deleting an order releases whatever stock every one of its line
    // items had allocated, same as cancelling a stockOut() -- otherwise
    // deleted orders would leave products permanently short.
    const existingRows = db.prepare(`
        SELECT product_id, quantity
        FROM orders
        WHERE order_id = ?
    `).all(order_id) as { product_id: string | null; quantity: number }[];


    const applyDelete = db.transaction(() => {

        const result = db.prepare(`

            DELETE FROM orders

            WHERE order_id = ?

        `).run(order_id);

        for (const row of existingRows) {

            if (row.product_id) {

                applyStockDelta(
                    db,
                    row.product_id,
                    row.quantity,
                    `Order ${order_id} deleted - stock restored`
                );

            }

        }

        return result;

    });


    return applyDelete();


}

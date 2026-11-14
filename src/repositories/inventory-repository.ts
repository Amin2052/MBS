import { getDatabase } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";

export type InventoryTransaction = {
    id?: number;
    product_id: string;
    type: "IN" | "OUT";
    quantity: number;
    note?: string;
    created_at?: string;
};

export function getInventoryTransactions(
    fromDate?: string,
    toDate?: string
) {

    const db = getDatabase();

    let query = `
        SELECT *
        FROM inventory_transactions
    `;

    const params: any[] = [];

    if (fromDate || toDate) {

        query += `
            WHERE 1 = 1
        `;

        if (fromDate) {

            query += `
                AND date(created_at) >= date(?)
            `;

            params.push(fromDate);

        }

        if (toDate) {

            query += `
                AND date(created_at) <= date(?)
            `;

            params.push(toDate);

        }

    }

    query += `
        ORDER BY id DESC
    `;

    return db
        .prepare(query)
        .all(...params) as InventoryTransaction[];

}

function assertValidQuantity(quantity: number) {

    if (
        typeof quantity !== "number" ||
        !Number.isFinite(quantity) ||
        quantity <= 0
    ) {

        throw new Error(
            "Quantity must be a positive number."
        );

    }

}

export function stockIn(
    product_id: string,
    quantity: number,
    note: string = ""
) {

    assertValidQuantity(quantity);

    const db = getDatabase();

    const product = db
        .prepare(`
            SELECT stock
            FROM products
            WHERE product_id = ?
        `)
        .get(product_id) as any;

    if (!product) {

        throw new Error(
            "Product not found"
        );

    }

    {
        const { count: existingInventoryTxnCount } = db.prepare(`SELECT COUNT(*) as count FROM inventory_transactions`).get() as { count: number };
        assertWithinQuota("inventoryTransactions", existingInventoryTxnCount);
    }

    db.transaction(() => {

        db
            .prepare(`
                UPDATE products
                SET stock = stock + ?
                WHERE product_id = ?
            `)
            .run(
                quantity,
                product_id
            );

        db
            .prepare(`
                INSERT INTO inventory_transactions
                (
                    product_id,
                    type,
                    quantity,
                    note
                )
                VALUES (?,?,?,?)
            `)
            .run(
                product_id,
                "IN",
                quantity,
                note
            );

    })();

}

export function stockOut(
    product_id: string,
    quantity: number,
    note: string = ""
) {

    assertValidQuantity(quantity);

    const db = getDatabase();

    const product = db
        .prepare(`
            SELECT stock
            FROM products
            WHERE product_id = ?
        `)
        .get(product_id) as any;

    if (!product) {

        throw new Error(
            "Product not found"
        );

    }

    if (product.stock < quantity) {

        throw new Error(
            "Not enough stock"
        );

    }

    {
        const { count: existingInventoryTxnCount } = db.prepare(`SELECT COUNT(*) as count FROM inventory_transactions`).get() as { count: number };
        assertWithinQuota("inventoryTransactions", existingInventoryTxnCount);
    }

    db.transaction(() => {

        db
            .prepare(`
                UPDATE products
                SET stock = stock - ?
                WHERE product_id = ?
            `)
            .run(
                quantity,
                product_id
            );

        db
            .prepare(`
                INSERT INTO inventory_transactions
                (
                    product_id,
                    type,
                    quantity,
                    note
                )
                VALUES (?,?,?,?)
            `)
            .run(
                product_id,
                "OUT",
                quantity,
                note
            );

    })();

}
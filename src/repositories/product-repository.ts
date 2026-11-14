import { getDatabase } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";

export type Product = {
    id?: number;
    product_id: string;
    name: string;
    category: string;
    sku: string;
    price: number;
    stock: number;
    created_at?: string;
    updated_at?: string;
};

export function getProducts(): Product[] {

    const db = getDatabase();

    return db
        .prepare(`
            SELECT *
            FROM products
            ORDER BY id DESC
        `)
        .all() as Product[];

}

/**
 * Generates the next PRD-###### id from the highest existing numeric
 * suffix already stored in the table, mirroring the same fix applied
 * to customer_id generation (customers.length-based ids collide with
 * the UNIQUE constraint after any deletion).
 */
function generateProductId(db: ReturnType<typeof getDatabase>): string {

    const rows = db.prepare(`
        SELECT product_id
        FROM products
        WHERE product_id LIKE 'PRD-%'
    `).all() as { product_id: string }[];

    const maxNumber = rows.reduce((max, r) => {
        const parsed = parseInt(r.product_id.replace("PRD-", ""), 10);
        return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    return `PRD-${String(maxNumber + 1).padStart(6, "0")}`;

}

export function createProduct(product: Omit<Product, "product_id"> & { product_id?: string }) {

    const db = getDatabase();

    const { count } = db.prepare(`SELECT COUNT(*) as count FROM products`).get() as { count: number };
    assertWithinQuota("products", count);

    const product_id = product.product_id || generateProductId(db);

    return db.prepare(`
        INSERT INTO products
        (
            product_id,
            name,
            category,
            sku,
            price,
            stock
        )
        VALUES
        (
            @product_id,
            @name,
            @category,
            @sku,
            @price,
            @stock
        )
    `).run({
        product_id,
        name: product.name,
        category: product.category,
        sku: product.sku,
        price: product.price,
        stock: product.stock
    });

}

export function updateProduct(
    id: number,
    product: Omit<Product, "product_id">
) {

    const db = getDatabase();

    // Editing stock here bypasses stockIn()/stockOut() in inventory-repository.ts,
    // which are the source of truth for the inventory_transactions ledger. To keep
    // the ledger consistent with whatever the Products page saves, we record the
    // same kind of IN/OUT transaction here when the stock value actually changes,
    // instead of silently letting it drift from stockIn/stockOut's bookkeeping.
    const existing = db.prepare(`
        SELECT stock, product_id
        FROM products
        WHERE id = ?
    `).get(id) as { stock: number; product_id: string } | undefined;

    const applyUpdate = db.transaction(() => {

        const result = db.prepare(`
            UPDATE products

            SET

                name = @name,
                category = @category,
                sku = @sku,
                price = @price,
                stock = @stock,
                updated_at = CURRENT_TIMESTAMP

            WHERE id = @id
        `).run({

            id,

            name: product.name,
            category: product.category,
            sku: product.sku,
            price: product.price,
            stock: product.stock

        });

        if (existing) {

            const delta = Number(product.stock) - Number(existing.stock);

            if (delta !== 0) {

                db.prepare(`
                    INSERT INTO inventory_transactions
                    (
                        product_id,
                        type,
                        quantity,
                        note
                    )
                    VALUES (?,?,?,?)
                `).run(
                    existing.product_id,
                    delta > 0 ? "IN" : "OUT",
                    Math.abs(delta),
                    "Manual stock adjustment (Products page)"
                );

            }

        }

        return result;

    });

    return applyUpdate();

}

export function deleteProduct(id: number) {

    const db = getDatabase();

    return db.prepare(`
        DELETE FROM products
        WHERE id = ?
    `).run(id);

}
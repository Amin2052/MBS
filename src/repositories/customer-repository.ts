import { getDatabase } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";

export type Customer = {
    id?: number;
    customer_id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    created_at?: string;
    updated_at?: string;
};

export function getCustomers(): Customer[] {

    const db = getDatabase();

    return db.prepare(`
        SELECT *
        FROM customers
        ORDER BY id DESC
    `).all() as Customer[];

}

/**
 * Generates the next CUS-###### id from the highest existing numeric
 * suffix already stored in the table. Using MAX() on the actual data
 * (instead of customers.length in the renderer) means a deleted
 * customer's id is never reissued, so it can't collide with the
 * UNIQUE constraint on customer_id.
 */
function generateCustomerId(db: ReturnType<typeof getDatabase>): string {

    const row = db.prepare(`
        SELECT customer_id
        FROM customers
        WHERE customer_id LIKE 'CUS-%'
    `).all() as { customer_id: string }[];

    const maxNumber = row.reduce((max, r) => {
        const parsed = parseInt(r.customer_id.replace("CUS-", ""), 10);
        return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    return `CUS-${String(maxNumber + 1).padStart(6, "0")}`;

}

export function createCustomer(customer: Omit<Customer, "customer_id"> & { customer_id?: string }) {

    const db = getDatabase();

    const { count } = db.prepare(`SELECT COUNT(*) as count FROM customers`).get() as { count: number };
    assertWithinQuota("customers", count);

    const customer_id = customer.customer_id || generateCustomerId(db);

    return db.prepare(`
        INSERT INTO customers
        (
            customer_id,
            name,
            phone,
            email,
            address
        )
        VALUES
        (
            @customer_id,
            @name,
            @phone,
            @email,
            @address
        )
    `).run({
        customer_id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address
    });

}

export function updateCustomer(
    id: number,
    customer: Customer
) {

    const db = getDatabase();

    return db.prepare(`
        UPDATE customers

        SET

            name = @name,
            phone = @phone,
            email = @email,
            address = @address,
            updated_at = CURRENT_TIMESTAMP

        WHERE id = @id
    `).run({

        id,

        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address

    });

}

export function deleteCustomer(id: number) {

    const db = getDatabase();

    return db.prepare(`
        DELETE FROM customers
        WHERE id = ?
    `).run(id);

}
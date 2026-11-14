import { getDatabase } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";

export type CertificateCategory = "Employee" | "Product";

export type Certificate = {

    id?: number;

    certificate_id: string;

    certificate_category: CertificateCategory;

    certificate_type: string;

    customer_id?: string;

    customer_name?: string;

    employee_name?: string;

    product_id?: string;

    product_name?: string;

    serial_number?: string;

    // Task 9 snapshot fields -- copied from the selected Employee/Product
    // record at save time so certificates never depend on a live join.
    // employee_id / product_id (above) hold the natural external key
    // (employee_number / product_id string) purely as an optional
    // reference; they are not enforced foreign keys, so deleting the
    // underlying employee/product record cannot break or cascade into
    // existing certificates.
    employee_id?: string;

    employee_number_snapshot?: string;

    employee_name_snapshot?: string;

    department_snapshot?: string;

    designation_snapshot?: string;

    // Certificate Automation snapshot fields -- captured at save time
    // alongside the Task 9 fields above so the automatic certificate
    // type/title/description (computed in certificates-page.tsx) stay
    // correct forever, even if the employee's live employment_type/
    // joining_date/employment_status changes afterward.
    employment_type_snapshot?: string;

    joining_date_snapshot?: string | null;

    employment_status_snapshot?: string;

    product_name_snapshot?: string;

    category_snapshot?: string;

    sku_snapshot?: string;

    title: string;

    description?: string;

    issue_date?: string;

    expiry_date?: string | null;

    status: string;

    // Set exactly once, the moment this Employee Certificate is first
    // successfully printed/exported. See markCertificatePrinted below --
    // never overwritten after that, and deliberately separate from
    // updated_at (which changes on every edit).
    printed_at?: string | null;

    created_at?: string;

    updated_at?: string;

};

/**
 * Reads the category-specific certificate prefix configured in
 * Settings > Certificate. Falls back to sensible defaults if the
 * row/columns aren't there yet for any reason (fresh install edge
 * case, matches the DEFAULT_COMPANY_SETTINGS fallback used on the
 * renderer side).
 */
function getConfiguredPrefix(
    db: ReturnType<typeof getDatabase>,
    category: CertificateCategory
): string {

    const row = db.prepare(`
        SELECT certificate_employee_prefix, certificate_product_prefix
        FROM company_settings
        WHERE id = 1
    `).get() as { certificate_employee_prefix?: string; certificate_product_prefix?: string } | undefined;

    if (category === "Employee") {
        const prefix = row?.certificate_employee_prefix?.trim();
        return prefix && prefix.length > 0 ? prefix : "EMP-";
    }

    const prefix = row?.certificate_product_prefix?.trim();
    return prefix && prefix.length > 0 ? prefix : "PRD-";

}

/**
 * Generates the next certificate number from the highest existing
 * numeric suffix already stored for the *configured* prefix -- same
 * collision-proof strategy already used for customer_id, product_id,
 * order_id, invoice_id and transaction_id (derived from the actual
 * data, not from row count or MAX(id), so a deleted certificate's
 * number is never reissued). Employee and Product certificates use
 * entirely separate prefixes (EMP-/PRD- by default), so their number
 * sequences never collide with each other even though they share the
 * same table.
 */
function generateCertificateId(
    db: ReturnType<typeof getDatabase>,
    prefix: string
): string {

    const rows = db.prepare(`
        SELECT certificate_id
        FROM certificates
        WHERE certificate_id LIKE ?
    `).all(`${prefix}%`) as { certificate_id: string }[];

    const maxNumber = rows.reduce((max, r) => {
        const parsed = parseInt(r.certificate_id.slice(prefix.length), 10);
        return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    return `${prefix}${String(maxNumber + 1).padStart(6, "0")}`;

}

export function getCertificates(filters?: {

    search?: string;

    category?: CertificateCategory | "All";

    status?: string;

    fromDate?: string;

    toDate?: string;

}): Certificate[] {

    const db = getDatabase();

    let query = `

        SELECT *

        FROM certificates

        WHERE 1=1

    `;

    const params: any = {};

    if (filters?.search) {

        query += `

        AND (

            certificate_id LIKE @search

            OR customer_name LIKE @search

            OR employee_name LIKE @search

            OR title LIKE @search

            OR serial_number LIKE @search

        )

        `;

        params.search = `%${filters.search}%`;

    }

    if (filters?.category && filters.category !== "All") {

        query += `

        AND certificate_category = @category

        `;

        params.category = filters.category;

    }

    if (filters?.status && filters.status !== "All") {

        query += `

        AND status = @status

        `;

        params.status = filters.status;

    }

    if (filters?.fromDate) {

        query += `

        AND date(issue_date) >= date(@fromDate)

        `;

        params.fromDate = filters.fromDate;

    }

    if (filters?.toDate) {

        query += `

        AND date(issue_date) <= date(@toDate)

        `;

        params.toDate = filters.toDate;

    }

    query += `

        ORDER BY id DESC

    `;

    return db.prepare(query).all(params) as Certificate[];

}

export function getCertificateById(id: number): Certificate | undefined {

    const db = getDatabase();

    return db.prepare(`
        SELECT *
        FROM certificates
        WHERE id = ?
    `).get(id) as Certificate | undefined;

}

export function createCertificate(
    certificate: Omit<Certificate, "certificate_id">
): { certificate_id: string } {

    const db = getDatabase();

    const category: CertificateCategory =
        certificate.certificate_category === "Product" ? "Product" : "Employee";

    const prefix = getConfiguredPrefix(db, category);
    const certificate_id = generateCertificateId(db, prefix);

    const { count: existingCertificateCount } = db.prepare(`SELECT COUNT(*) as count FROM certificates`).get() as { count: number };
    assertWithinQuota("certificates", existingCertificateCount);

    db.prepare(`

        INSERT INTO certificates

        (

            certificate_id,
            certificate_category,
            certificate_type,
            customer_id,
            customer_name,
            employee_name,
            product_id,
            product_name,
            serial_number,
            title,
            description,
            issue_date,
            expiry_date,
            status,
            employee_id,
            employee_number_snapshot,
            employee_name_snapshot,
            department_snapshot,
            designation_snapshot,
            employment_type_snapshot,
            joining_date_snapshot,
            employment_status_snapshot,
            product_name_snapshot,
            category_snapshot,
            sku_snapshot

        )

        VALUES

        (

            @certificate_id,
            @certificate_category,
            @certificate_type,
            @customer_id,
            @customer_name,
            @employee_name,
            @product_id,
            @product_name,
            @serial_number,
            @title,
            @description,
            @issue_date,
            @expiry_date,
            @status,
            @employee_id,
            @employee_number_snapshot,
            @employee_name_snapshot,
            @department_snapshot,
            @designation_snapshot,
            @employment_type_snapshot,
            @joining_date_snapshot,
            @employment_status_snapshot,
            @product_name_snapshot,
            @category_snapshot,
            @sku_snapshot

        )

    `).run({

        certificate_id,

        certificate_category: category,

        certificate_type: certificate.certificate_type ?? "",

        customer_id: certificate.customer_id ?? "",

        customer_name: certificate.customer_name ?? "",

        employee_name: certificate.employee_name ?? "",

        product_id: certificate.product_id ?? "",

        product_name: certificate.product_name ?? "",

        serial_number: certificate.serial_number ?? "",

        title: certificate.title,

        description: certificate.description ?? "",

        issue_date: certificate.issue_date ?? new Date().toISOString(),

        expiry_date: certificate.expiry_date ?? null,

        status: certificate.status ?? "Active",

        employee_id: certificate.employee_id ?? "",

        employee_number_snapshot: certificate.employee_number_snapshot ?? "",

        employee_name_snapshot: certificate.employee_name_snapshot ?? "",

        department_snapshot: certificate.department_snapshot ?? "",

        designation_snapshot: certificate.designation_snapshot ?? "",

        employment_type_snapshot: certificate.employment_type_snapshot ?? "",

        joining_date_snapshot: certificate.joining_date_snapshot ?? null,

        employment_status_snapshot: certificate.employment_status_snapshot ?? "",

        product_name_snapshot: certificate.product_name_snapshot ?? "",

        category_snapshot: certificate.category_snapshot ?? "",

        sku_snapshot: certificate.sku_snapshot ?? ""

    });

    return { certificate_id };

}

export function updateCertificate(
    id: number,
    certificate: Omit<Certificate, "certificate_id" | "certificate_category">
) {

    const db = getDatabase();

    // certificate_category is intentionally not editable after creation --
    // it determines which prefix/number sequence was used to generate
    // certificate_id, so changing it after the fact would make the
    // existing number misleading. Create a new certificate instead.
    return db.prepare(`

        UPDATE certificates

        SET

            certificate_type = @certificate_type,
            customer_id = @customer_id,
            customer_name = @customer_name,
            employee_name = @employee_name,
            product_id = @product_id,
            product_name = @product_name,
            serial_number = @serial_number,
            title = @title,
            description = @description,
            issue_date = @issue_date,
            expiry_date = @expiry_date,
            status = @status,
            employee_id = @employee_id,
            employee_number_snapshot = @employee_number_snapshot,
            employee_name_snapshot = @employee_name_snapshot,
            department_snapshot = @department_snapshot,
            designation_snapshot = @designation_snapshot,
            employment_type_snapshot = @employment_type_snapshot,
            joining_date_snapshot = @joining_date_snapshot,
            employment_status_snapshot = @employment_status_snapshot,
            product_name_snapshot = @product_name_snapshot,
            category_snapshot = @category_snapshot,
            sku_snapshot = @sku_snapshot,
            updated_at = CURRENT_TIMESTAMP

        WHERE id = @id

    `).run({

        id,

        certificate_type: certificate.certificate_type ?? "",

        customer_id: certificate.customer_id ?? "",

        customer_name: certificate.customer_name ?? "",

        employee_name: certificate.employee_name ?? "",

        product_id: certificate.product_id ?? "",

        product_name: certificate.product_name ?? "",

        serial_number: certificate.serial_number ?? "",

        title: certificate.title,

        description: certificate.description ?? "",

        issue_date: certificate.issue_date ?? new Date().toISOString(),

        expiry_date: certificate.expiry_date ?? null,

        status: certificate.status ?? "Active",

        employee_id: certificate.employee_id ?? "",

        employee_number_snapshot: certificate.employee_number_snapshot ?? "",

        employee_name_snapshot: certificate.employee_name_snapshot ?? "",

        department_snapshot: certificate.department_snapshot ?? "",

        designation_snapshot: certificate.designation_snapshot ?? "",

        employment_type_snapshot: certificate.employment_type_snapshot ?? "",

        joining_date_snapshot: certificate.joining_date_snapshot ?? null,

        employment_status_snapshot: certificate.employment_status_snapshot ?? "",

        product_name_snapshot: certificate.product_name_snapshot ?? "",

        category_snapshot: certificate.category_snapshot ?? "",

        sku_snapshot: certificate.sku_snapshot ?? ""

    });

}

/**
 * Employee Certificate status automation: Pending -> Printed. Called on
 * the first successful print/export only (see certificates-page.tsx).
 * COALESCE keeps this safe to call more than once -- printed_at is set
 * on the first call and left untouched on every later one, so the
 * original timestamp can never be overwritten even if this were ever
 * invoked twice for the same certificate.
 */
export function markCertificatePrinted(id: number) {

    const db = getDatabase();

    return db.prepare(`

        UPDATE certificates

        SET
            status = 'Printed',
            printed_at = COALESCE(printed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP

        WHERE id = @id

    `).run({ id });

}

export function deleteCertificate(id: number) {

    const db = getDatabase();

    return db.prepare(`
        DELETE FROM certificates
        WHERE id = ?
    `).run(id);

}

export function getCertificateSummary() {

    const db = getDatabase();

    return db.prepare(`

        SELECT

        COUNT(*) AS totalCertificates,

        COALESCE(SUM(CASE WHEN certificate_category = 'Employee' THEN 1 ELSE 0 END), 0) AS employeeCount,

        COALESCE(SUM(CASE WHEN certificate_category = 'Product' THEN 1 ELSE 0 END), 0) AS productCount,

        COALESCE(SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END), 0) AS activeCount,

        COALESCE(SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END), 0) AS expiredCount,

        COALESCE(SUM(CASE WHEN status = 'Revoked' THEN 1 ELSE 0 END), 0) AS revokedCount,

        COALESCE(SUM(
            CASE
                WHEN expiry_date IS NOT NULL
                     AND date(expiry_date) < date('now')
                     AND status = 'Active'
                THEN 1
                ELSE 0
            END
        ), 0) AS overdueExpiredCount,

        COALESCE(SUM(
            CASE
                WHEN expiry_date IS NOT NULL
                     AND date(expiry_date) >= date('now')
                     AND date(expiry_date) <= date('now', '+30 days')
                     AND status = 'Active'
                THEN 1
                ELSE 0
            END
        ), 0) AS nearExpiryCount

        FROM certificates

    `).get();

}
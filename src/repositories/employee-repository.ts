import { getDatabase } from "../database/database";
import { assertWithinQuota } from "../../electron/main/license-v2/business-mode-quota";
import { DEFAULT_EMPLOYEE_NUMBER_PREFIX } from "../constants/employee";

export type Employee = {

    id?: number;

    employee_number: string;

    has_photo?: boolean;

    first_name: string;

    last_name: string;

    gender?: string;

    date_of_birth?: string | null;

    phone: string;

    email?: string;

    address?: string;

    department: string;

    designation: string;

    joining_date?: string | null;

    employment_status: string;

    employment_type?: string;

    resignation_date?: string | null;

    contract_start_date?: string | null;

    contract_end_date?: string | null;

    salary?: number;

    emergency_contact_name?: string;

    emergency_contact_phone?: string;

    // Deprecated: superseded by identity_type/identity_number.
    nid_passport?: string;

    identity_type?: string;

    identity_number?: string;

    notes?: string;

    created_at?: string;

    updated_at?: string;

};

// The row shape actually selected for list/detail reads -- deliberately
// excludes photo_blob (large binary, unnecessary for table/edit-form
// payloads). The photo itself is fetched separately via
// getEmployeePhotoDataUrl(id), the same lazy pattern already used for
// the Company Logo (settings:getLogoPreview).
const EMPLOYEE_SELECT_COLUMNS = `
    id,
    employee_number,
    CASE WHEN photo_blob IS NOT NULL THEN 1 ELSE 0 END AS has_photo,
    first_name,
    last_name,
    gender,
    date_of_birth,
    phone,
    email,
    address,
    department,
    designation,
    joining_date,
    employment_status,
    employment_type,
    resignation_date,
    contract_start_date,
    contract_end_date,
    salary,
    emergency_contact_name,
    emergency_contact_phone,
    nid_passport,
    identity_type,
    identity_number,
    notes,
    created_at,
    updated_at
`;

/**
 * Returns the configured Employee Number prefix. Currently just the
 * fixed DEFAULT_EMPLOYEE_NUMBER_PREFIX constant, but kept as its own
 * function (rather than inlining the constant into
 * generateEmployeeNumber) -- mirrors getConfiguredPrefix() in
 * certificate-repository.ts, so a future "Employee Number Prefix"
 * setting (a new company_settings column, same as
 * certificate_employee_prefix / certificate_product_prefix) can be
 * wired in here later without touching generateEmployeeNumber or any
 * of its callers.
 */
function getEmployeeNumberPrefix(
    _db: ReturnType<typeof getDatabase>
): string {

    return DEFAULT_EMPLOYEE_NUMBER_PREFIX;

}

/**
 * Generates the next EMP-###### number from the highest existing
 * numeric suffix already stored for the configured prefix -- same
 * collision-proof strategy already used for customer_id, product_id,
 * order_id, invoice_id, transaction_id and certificate_id (derived
 * from the actual data, not from row count or MAX(id), so a deleted
 * employee's number is never reissued).
 */
function generateEmployeeNumber(
    db: ReturnType<typeof getDatabase>
): string {

    const prefix = getEmployeeNumberPrefix(db);

    const rows = db.prepare(`
        SELECT employee_number
        FROM employees
        WHERE employee_number LIKE ?
    `).all(`${prefix}%`) as { employee_number: string }[];

    const maxNumber = rows.reduce((max, r) => {
        const parsed = parseInt(r.employee_number.slice(prefix.length), 10);
        return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    return `${prefix}${String(maxNumber + 1).padStart(6, "0")}`;

}

export function getEmployees(filters?: {

    search?: string;

    department?: string;

    status?: string;

}): Employee[] {

    const db = getDatabase();

    let query = `
        SELECT ${EMPLOYEE_SELECT_COLUMNS}
        FROM employees
        WHERE 1=1
    `;

    const params: any = {};

    if (filters?.search) {

        query += `
        AND (
            employee_number LIKE @search
            OR first_name LIKE @search
            OR last_name LIKE @search
            OR phone LIKE @search
            OR email LIKE @search
            OR designation LIKE @search
        )
        `;

        params.search = `%${filters.search}%`;

    }

    if (filters?.department && filters.department !== "All") {

        query += `
        AND department = @department
        `;

        params.department = filters.department;

    }

    if (filters?.status && filters.status !== "All") {

        query += `
        AND employment_status = @status
        `;

        params.status = filters.status;

    }

    query += `
        ORDER BY id DESC
    `;

    return db.prepare(query).all(params) as Employee[];

}

export function getEmployeeById(id: number): Employee | undefined {

    const db = getDatabase();

    return db.prepare(`
        SELECT ${EMPLOYEE_SELECT_COLUMNS}
        FROM employees
        WHERE id = ?
    `).get(id) as Employee | undefined;

}

export function createEmployee(
    employee: Omit<Employee, "employee_number" | "id" | "has_photo">
): { id: number; employee_number: string } {

    const db = getDatabase();

    const { count: existingEmployeeCount } = db.prepare(`SELECT COUNT(*) as count FROM employees`).get() as { count: number };
    assertWithinQuota("employees", existingEmployeeCount);

    const employee_number = generateEmployeeNumber(db);

    const result = db.prepare(`

        INSERT INTO employees
        (
            employee_number,
            first_name,
            last_name,
            gender,
            date_of_birth,
            phone,
            email,
            address,
            department,
            designation,
            joining_date,
            employment_status,
            employment_type,
            resignation_date,
            contract_start_date,
            contract_end_date,
            salary,
            emergency_contact_name,
            emergency_contact_phone,
            nid_passport,
            identity_type,
            identity_number,
            notes
        )
        VALUES
        (
            @employee_number,
            @first_name,
            @last_name,
            @gender,
            @date_of_birth,
            @phone,
            @email,
            @address,
            @department,
            @designation,
            @joining_date,
            @employment_status,
            @employment_type,
            @resignation_date,
            @contract_start_date,
            @contract_end_date,
            @salary,
            @emergency_contact_name,
            @emergency_contact_phone,
            @nid_passport,
            @identity_type,
            @identity_number,
            @notes
        )

    `).run({

        employee_number,

        first_name: employee.first_name,
        last_name: employee.last_name,
        gender: employee.gender ?? "",
        date_of_birth: employee.date_of_birth ?? null,
        phone: employee.phone,
        email: employee.email ?? "",
        address: employee.address ?? "",
        department: employee.department,
        designation: employee.designation,
        joining_date: employee.joining_date ?? null,
        employment_status: employee.employment_status || "Active",
        employment_type: employee.employment_type ?? "",
        resignation_date: employee.resignation_date ?? null,
        contract_start_date: employee.contract_start_date ?? null,
        contract_end_date: employee.contract_end_date ?? null,
        salary: employee.salary ?? 0,
        emergency_contact_name: employee.emergency_contact_name ?? "",
        emergency_contact_phone: employee.emergency_contact_phone ?? "",
        nid_passport: employee.nid_passport ?? "",
        identity_type: employee.identity_type ?? "",
        identity_number: employee.identity_number ?? "",
        notes: employee.notes ?? ""

    });

    return {
        id: Number(result.lastInsertRowid),
        employee_number
    };

}

export function updateEmployee(
    id: number,
    employee: Omit<Employee, "employee_number" | "id" | "has_photo">
) {

    const db = getDatabase();

    return db.prepare(`

        UPDATE employees

        SET

            first_name = @first_name,
            last_name = @last_name,
            gender = @gender,
            date_of_birth = @date_of_birth,
            phone = @phone,
            email = @email,
            address = @address,
            department = @department,
            designation = @designation,
            joining_date = @joining_date,
            employment_status = @employment_status,
            employment_type = @employment_type,
            resignation_date = @resignation_date,
            contract_start_date = @contract_start_date,
            contract_end_date = @contract_end_date,
            salary = @salary,
            emergency_contact_name = @emergency_contact_name,
            emergency_contact_phone = @emergency_contact_phone,
            nid_passport = @nid_passport,
            identity_type = @identity_type,
            identity_number = @identity_number,
            notes = @notes,
            updated_at = CURRENT_TIMESTAMP

        WHERE id = @id

    `).run({

        id,

        first_name: employee.first_name,
        last_name: employee.last_name,
        gender: employee.gender ?? "",
        date_of_birth: employee.date_of_birth ?? null,
        phone: employee.phone,
        email: employee.email ?? "",
        address: employee.address ?? "",
        department: employee.department,
        designation: employee.designation,
        joining_date: employee.joining_date ?? null,
        employment_status: employee.employment_status || "Active",
        employment_type: employee.employment_type ?? "",
        resignation_date: employee.resignation_date ?? null,
        contract_start_date: employee.contract_start_date ?? null,
        contract_end_date: employee.contract_end_date ?? null,
        salary: employee.salary ?? 0,
        emergency_contact_name: employee.emergency_contact_name ?? "",
        emergency_contact_phone: employee.emergency_contact_phone ?? "",
        nid_passport: employee.nid_passport ?? "",
        identity_type: employee.identity_type ?? "",
        identity_number: employee.identity_number ?? "",
        notes: employee.notes ?? ""

    });

}

export function deleteEmployee(id: number) {

    const db = getDatabase();

    const transaction = db.transaction((employeeId: number) => {

        // Remove employee contracts first
        db.prepare(`
            DELETE FROM employee_contracts
            WHERE employee_id = ?
        `).run(employeeId);

        // Remove employee certificates (if any)
        db.prepare(`
            DELETE FROM certificates
            WHERE employee_id = ?
        `).run(employeeId);

        // Remove employee
        db.prepare(`
            DELETE FROM employees
            WHERE id = ?
        `).run(employeeId);

    });

    return transaction(id);

}

/**
 * Persists a resized photo buffer (already produced by
 * employee-photo-service.ts, same resize/compress path as the Company
 * Logo) as the given employee's photo. Split out from
 * create/updateEmployee for the same reason the Company Logo keeps
 * saveCompanyLogoFromBuffer separate from updateCompanySettings: the
 * photo is a distinct, independently-replaceable piece of state.
 */
export function saveEmployeePhoto(
    id: number,
    buffer: Buffer,
    mime: string
) {

    const db = getDatabase();

    return db.prepare(`
        UPDATE employees
        SET photo_blob = ?, photo_mime = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(buffer, mime, id);

}

export function removeEmployeePhoto(id: number) {

    const db = getDatabase();

    return db.prepare(`
        UPDATE employees
        SET photo_blob = NULL, photo_mime = '', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(id);

}

/**
 * Employees who don't yet have a login account (users.employee_id is
 * null for them) -- used by the User Management "Create User" flow's
 * employee picker (Phase 2: Employee <-> User linking). Only
 * active-status employees are eligible for a new login.
 */
export function getEmployeesWithoutLogin(): Employee[] {

    const db = getDatabase();

    return db.prepare(`
        SELECT e.*
        FROM employees e
        LEFT JOIN users u ON u.employee_id = e.id
        WHERE u.id IS NULL
          AND e.employment_status = 'Active'
        ORDER BY e.first_name, e.last_name
    `).all() as Employee[];

}

/**
 * Returns the given employee's photo as a data URL, or null if none is
 * stored. Mirrors getCompanyLogoDataUrl in
 * electron/main/company-settings-service.ts.
 */
export function getEmployeePhotoDataUrl(id: number): string | null {

    const db = getDatabase();

    const row = db
        .prepare("SELECT photo_blob, photo_mime FROM employees WHERE id = ?")
        .get(id) as { photo_blob: Buffer | null; photo_mime: string | null } | undefined;

    if (row?.photo_blob) {
        return `data:${row.photo_mime || "image/png"};base64,${row.photo_blob.toString("base64")}`;
    }

    return null;

}


import { getDatabase } from "../database/database";

// ===================================================================
// EMPLOYEE CONTRACT REPOSITORY
// ===================================================================
//
// Backs the `employee_contracts` table (see database.ts). Rows are
// never overwritten or deleted here -- "extending" a contract closes
// the current row (is_current = 0) and inserts a brand new one linked
// via previous_contract_id, so the full lineage is always
// reconstructable, the same append-only convention documented on the
// table itself.
//
// employees.contract_start_date / employees.contract_end_date remain
// a read-optimized mirror of the *current* row here (so the Employees
// list/detail views can keep reading them without a join, same as
// before this module existed) -- every write path below keeps that
// mirror in sync via syncEmployeeContractDates().

export type EmployeeContractRow = {

    id?: number;

    employee_id: number;

    contract_start_date: string;

    contract_end_date?: string | null;

    extension_reason?: string;

    previous_contract_id?: number | null;

    is_current: boolean;

    contract_status?: "Active" | "Expiring Soon" | "Expired";

    created_at?: string;

    updated_at?: string;

};

// A contract within this many days of its end date (but not yet past
// it) reads as "Expiring Soon" rather than "Active" -- mirrors the
// nearExpiryCount window already used for certificates in
// certificate-repository.ts / getCertificateSummary().
const EXPIRING_SOON_WINDOW_DAYS = 30;

/**
 * contract_status is deliberately NOT stored on the row -- it is
 * date-dependent, so it is computed at read time here rather than
 * persisted (same approach as the certificate expiry summary).
 */
export function computeContractStatus(
    contractEndDate?: string | null
): "Active" | "Expiring Soon" | "Expired" {

    if (!contractEndDate) return "Active";

    const end = new Date(contractEndDate).getTime();

    if (Number.isNaN(end)) return "Active";

    const daysRemaining = (end - Date.now()) / (1000 * 60 * 60 * 24);

    if (daysRemaining < 0) return "Expired";

    if (daysRemaining <= EXPIRING_SOON_WINDOW_DAYS) return "Expiring Soon";

    return "Active";

}

function attachStatus(row: any): EmployeeContractRow {

    return {
        ...row,
        is_current: !!row.is_current,
        contract_status: computeContractStatus(row.contract_end_date)
    };

}

/**
 * Keeps employees.contract_start_date/contract_end_date in sync with
 * the given contract row -- see the "denormalized copies" note on the
 * employees table migration in database.ts. Never called on its own;
 * only ever alongside an insert into employee_contracts.
 */
function syncEmployeeContractDates(
    db: ReturnType<typeof getDatabase>,
    employeeId: number,
    startDate: string,
    endDate: string | null
) {

    db.prepare(`
        UPDATE employees
        SET contract_start_date = ?, contract_end_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(startDate, endDate, employeeId);

}

export function getContractsByEmployee(employeeId: number): EmployeeContractRow[] {

    const db = getDatabase();

    const rows = db.prepare(`
        SELECT *
        FROM employee_contracts
        WHERE employee_id = ?
        ORDER BY contract_start_date DESC, id DESC
    `).all(employeeId) as any[];

    return rows.map(attachStatus);

}

export function getCurrentContract(employeeId: number): EmployeeContractRow | undefined {

    const db = getDatabase();

    const row = db.prepare(`
        SELECT *
        FROM employee_contracts
        WHERE employee_id = ? AND is_current = 1
        ORDER BY id DESC
        LIMIT 1
    `).get(employeeId) as any | undefined;

    return row ? attachStatus(row) : undefined;

}

/**
 * Opens the first (or a replacement) contract for an employee. Any
 * existing is_current row for the employee is closed out first, so
 * this stays safe to call defensively -- e.g. an edit-mode save for
 * an employee who somehow has no current contract on file yet -- and
 * never leaves more than one is_current row behind.
 */
export function createContract(data: {

    employee_id: number;

    contract_start_date: string;

    contract_end_date?: string | null;

}): EmployeeContractRow {

    const db = getDatabase();

    db.prepare(`
        UPDATE employee_contracts
        SET is_current = 0, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ? AND is_current = 1
    `).run(data.employee_id);

    db.prepare(`

        INSERT INTO employee_contracts
        (
            employee_id,
            contract_start_date,
            contract_end_date,
            is_current
        )
        VALUES
        (
            @employee_id,
            @contract_start_date,
            @contract_end_date,
            1
        )

    `).run({

        employee_id: data.employee_id,
        contract_start_date: data.contract_start_date,
        contract_end_date: data.contract_end_date ?? null

    });

    syncEmployeeContractDates(
        db,
        data.employee_id,
        data.contract_start_date,
        data.contract_end_date ?? null
    );

    return getCurrentContract(data.employee_id) as EmployeeContractRow;

}

/**
 * Extends an existing contract to a new end date. The current row is
 * closed out (is_current = 0) and never modified further -- a brand
 * new row is inserted carrying the same contract_start_date forward
 * (this is still the same contract, just extended), the new end date,
 * the extension reason, and previous_contract_id pointing back at the
 * row it replaces. History is never overwritten.
 */
export function extendContract(data: {

    contract_id: number;

    contract_end_date: string;

    extension_reason: string;

}): EmployeeContractRow {

    const db = getDatabase();

    const current = db
        .prepare("SELECT * FROM employee_contracts WHERE id = ?")
        .get(data.contract_id) as any | undefined;

    if (!current) {
        throw new Error("Contract not found.");
    }

    db.prepare(`
        UPDATE employee_contracts
        SET is_current = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(current.id);

    db.prepare(`

        INSERT INTO employee_contracts
        (
            employee_id,
            contract_start_date,
            contract_end_date,
            extension_reason,
            previous_contract_id,
            is_current
        )
        VALUES
        (
            @employee_id,
            @contract_start_date,
            @contract_end_date,
            @extension_reason,
            @previous_contract_id,
            1
        )

    `).run({

        employee_id: current.employee_id,
        contract_start_date: current.contract_start_date,
        contract_end_date: data.contract_end_date,
        extension_reason: data.extension_reason ?? "",
        previous_contract_id: current.id

    });

    syncEmployeeContractDates(
        db,
        current.employee_id,
        current.contract_start_date,
        data.contract_end_date
    );

    return getCurrentContract(current.employee_id) as EmployeeContractRow;

}

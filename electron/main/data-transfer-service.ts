import { getDatabase } from "../../src/database/database";

// ===================================================================
// Data Transfer (Export / Import Data)
//
// Distinct from the Backup System (backup-service.ts), which copies
// the entire raw SQLite file including accounts/sessions/license.
// Export/Import Data here moves core *business* records only --
// Products, Customers, Orders, Invoices, Employees, Certificates,
// Accounting Transactions -- as a portable JSON file. Deliberately
// excludes users/sessions/permission data (security-sensitive, not
// meaningful to move between installs) and license/company_settings
// (per-install configuration, not business data).
//
// Import is strictly additive: every table is keyed by its existing
// UNIQUE business identifier column (product_id, customer_id, etc.)
// and inserted with INSERT OR IGNORE, so importing can never overwrite
// or delete anything already in the database -- consistent with the
// spec's "never delete data" principle applied to Business Mode
// switching, extended here to data import as the safer default.
// ===================================================================

const EXPORTABLE_TABLES = [
  { table: "products", uniqueColumn: "product_id" },
  { table: "customers", uniqueColumn: "customer_id" },
  { table: "employees", uniqueColumn: "employee_number" },
  { table: "orders", uniqueColumn: "order_id" },
  { table: "invoices", uniqueColumn: "invoice_id" },
  { table: "certificates", uniqueColumn: "certificate_id" },
  { table: "transactions", uniqueColumn: "transaction_id" }
] as const;

export interface ExportedDataset {
  formatVersion: 1;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export function exportBusinessData(): ExportedDataset {

  const db = getDatabase();

  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const { table } of EXPORTABLE_TABLES) {

    // Never export the internal autoincrement id -- it's meaningless
    // (and potentially conflicting) on the importing database; each
    // table's own business identifier column is what Import matches
    // against.
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];

    tables[table] = rows.map(row => {
      const { id, ...rest } = row;
      void id;
      return rest;
    });

  }

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    tables
  };

}

export interface ImportSummary {
  success: boolean;
  error?: string;
  imported?: Record<string, number>;
  skipped?: Record<string, number>;
}

export function importBusinessData(dataset: ExportedDataset): ImportSummary {

  if (!dataset || dataset.formatVersion !== 1 || typeof dataset.tables !== "object") {
    return { success: false, error: "This file is not a valid Mooral Business Suite data export." };
  }

  const db = getDatabase();

  const imported: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  const transaction = db.transaction(() => {

    for (const { table, uniqueColumn } of EXPORTABLE_TABLES) {

      const rows = dataset.tables[table];

      if (!Array.isArray(rows)) {
        continue;
      }

      imported[table] = 0;
      skipped[table] = 0;

      for (const row of rows) {

        const columns = Object.keys(row).filter(
          column => column !== "id" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(column)
        );

        if (columns.length === 0) {
          continue;
        }

        const placeholders = columns.map(column => `@${column}`).join(", ");

        const result = db
          .prepare(`
            INSERT OR IGNORE INTO ${table} (${columns.join(", ")})
            VALUES (${placeholders})
          `)
          .run(row as Record<string, unknown>);

        if (result.changes > 0) {
          imported[table] += 1;
        }
        else {
          skipped[table] += 1;
        }

      }

      void uniqueColumn; // documents the dedup key; INSERT OR IGNORE relies on the table's own UNIQUE constraint.

    }

  });

  try {

    transaction();

    return { success: true, imported, skipped };

  }
  catch (error) {

    console.error("DATA IMPORT FAILED", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during import."
    };

  }

}

// Regression coverage for a database-integrity gap found this session:
// SQLite's `foreign_keys` pragma defaults to OFF per-connection unless
// explicitly enabled, and this app never enabled it anywhere -- so the
// real FOREIGN KEY constraints declared on employee_contracts
// (employee_id -> employees.id, previous_contract_id ->
// employee_contracts.id) were silently unenforced. Fixed with
// `db.pragma("foreign_keys = ON")` right after the (single, exclusive --
// confirmed by grep) connection is opened in src/database/database.ts.
//
// This test proves: (1) an invalid FK insert/update is now genuinely
// rejected by SQLite itself, not just "expected to be" from reading the
// code, (2) a valid parent/child insert still works, (3) the existing
// deleteEmployee() cascade (contracts -> certificates -> employee) still
// works correctly with enforcement ON, (4) checkDatabaseIntegrity()'s
// new PRAGMA foreign_key_check reporting correctly finds zero violations
// on a healthy database, (5) ERP reset still succeeds with enforcement
// ON (its own DELETE order must not violate FK ordering either).
//
// Must run under a real Electron process for the same reason as every
// other tests/main/entry-*.ts file: better-sqlite3's Electron-ABI binding.
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

async function main() {
  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) { failures++; console.error("FAIL:", label); }
    else { console.log("PASS:", label); }
  }
  function assertEqual(actual: unknown, expected: unknown, label: string) {
    assertTrue(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-fk-integrity-"));
  app.setPath("userData", tmpDir);

  const { getDatabase, closeDatabase } = await import("../../src/database/database");
  const { createEmployee, deleteEmployee } = await import("../../src/repositories/employee-repository");
  const { performErpReset, performFactoryReset } = await import("../../electron/main/reset-service");
  const { checkDatabaseIntegrity, createBackup, restoreFromBackup } = await import("../../electron/main/backup-service");

  const db = getDatabase();

  // 1. foreign_keys pragma is genuinely ON for this connection.
  const pragmaValue = db.pragma("foreign_keys", { simple: true });
  assertEqual(pragmaValue, 1, "PRAGMA foreign_keys reads back as ON (1) for the app's real database connection");

  // 2. An invalid FK insert is genuinely rejected by SQLite itself.
  let insertWithBadEmployeeIdThrew = false;
  try {
    db.prepare(`INSERT INTO employee_contracts(employee_id, contract_start_date) VALUES(?, ?)`).run(999999, "2026-01-01");
  } catch (error) {
    insertWithBadEmployeeIdThrew = /FOREIGN KEY constraint failed/i.test(error instanceof Error ? error.message : String(error));
  }
  assertTrue(insertWithBadEmployeeIdThrew, "SECURITY/INTEGRITY: inserting an employee_contracts row with a non-existent employee_id is genuinely rejected with a real FOREIGN KEY constraint error");

  // 3. A valid parent/child insert still works correctly.
  const employee = createEmployee({
    first_name: "Fatima", last_name: "Rahman", gender: "Female", phone: "", email: "", address: "",
    department: "Sales", designation: "Associate", employment_status: "Active", salary: 30000
  } as any);
  assertTrue(!!employee, "sanity: employee created successfully");
  const employeeId = (employee as any).id ?? (employee as any).lastInsertRowid;
  assertTrue(Number.isInteger(employeeId) && employeeId > 0, "sanity: got a real employee id back");

  let validInsertSucceeded = true;
  let firstContractId: number | null = null;
  try {
    const result = db.prepare(`INSERT INTO employee_contracts(employee_id, contract_start_date) VALUES(?, ?)`).run(employeeId, "2026-01-01");
    firstContractId = Number(result.lastInsertRowid);
  } catch {
    validInsertSucceeded = false;
  }
  assertTrue(validInsertSucceeded, "A valid employee_contracts insert (real employee_id) still succeeds with enforcement ON");

  let validSelfRefInsertSucceeded = true;
  try {
    db.prepare(`INSERT INTO employee_contracts(employee_id, contract_start_date, previous_contract_id, is_current) VALUES(?, ?, ?, ?)`).run(employeeId, "2026-06-01", firstContractId, 1);
  } catch {
    validSelfRefInsertSucceeded = false;
  }
  assertTrue(validSelfRefInsertSucceeded, "A valid self-referential previous_contract_id insert still succeeds with enforcement ON");

  let invalidSelfRefThrew = false;
  try {
    db.prepare(`INSERT INTO employee_contracts(employee_id, contract_start_date, previous_contract_id) VALUES(?, ?, ?)`).run(employeeId, "2026-07-01", 999999);
  } catch (error) {
    invalidSelfRefThrew = /FOREIGN KEY constraint failed/i.test(error instanceof Error ? error.message : String(error));
  }
  assertTrue(invalidSelfRefThrew, "SECURITY/INTEGRITY: a self-referential previous_contract_id pointing at a non-existent contract is also genuinely rejected");

  // 4. deleteEmployee() cascade still works with enforcement ON.
  let deleteSucceeded = true;
  try {
    deleteEmployee(employeeId);
  } catch {
    deleteSucceeded = false;
  }
  assertTrue(deleteSucceeded, "deleteEmployee()'s existing manual cascade (contracts -> certificates -> employee) still succeeds with FK enforcement ON");

  const remainingContracts = db.prepare(`SELECT COUNT(*) AS n FROM employee_contracts WHERE employee_id=?`).get(employeeId) as { n: number };
  assertEqual(remainingContracts.n, 0, "the employee's contracts were genuinely removed by the cascade, not left as orphans");

  // 5. checkDatabaseIntegrity()'s new PRAGMA foreign_key_check reporting.
  const integrityResult = checkDatabaseIntegrity();
  assertTrue(integrityResult.success === true, "checkDatabaseIntegrity() runs successfully");
  assertTrue(Array.isArray(integrityResult.foreignKeyViolations), "checkDatabaseIntegrity() returns a foreignKeyViolations array");
  assertEqual(integrityResult.foreignKeyViolations?.length, 0, "zero FK violations reported on a healthy, correctly-cascaded database");
  assertTrue(integrityResult.ok === true, "overall integrity result is ok (both PRAGMA integrity_check and foreign_key_check clean)");

  // 6. ERP reset and factory reset still succeed with FK enforcement ON.
  createEmployee({
    first_name: "Second", last_name: "Employee", gender: "Male", phone: "", email: "", address: "",
    department: "Ops", designation: "Clerk", employment_status: "Active", salary: 25000
  } as any);

  const resetResult = performErpReset();
  assertTrue(resetResult.success === true, "ERP reset still succeeds with FK enforcement ON (correct delete ordering already in place)");

  const factoryResetResult = performFactoryReset();
  assertTrue(factoryResetResult.success === true, "Factory reset still succeeds with FK enforcement ON");

  // 7. Backup/restore still works with FK enforcement ON.
  closeDatabase();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-fk-integrity-backup-"));
  app.setPath("userData", tmpDir);
  getDatabase();
  const backupResult = await createBackup(path.join(backupDir, "backup.mbsbak"));
  assertTrue(backupResult.success === true, "Database backup still succeeds with FK enforcement ON");

  if (backupResult.success && backupResult.filePath) {
    const restoreResult = await restoreFromBackup(backupResult.filePath);
    assertTrue(restoreResult.success === true, "Database restore still succeeds with FK enforcement ON");
    const dbAfterRestore = getDatabase();
    const pragmaAfterRestore = dbAfterRestore.pragma("foreign_keys", { simple: true });
    assertEqual(pragmaAfterRestore, 1, "PRAGMA foreign_keys is still ON on the connection reopened after a restore");
  }

  closeDatabase();

  if (failures > 0) {
    console.error(`\n${failures} DATABASE FK INTEGRITY TEST(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nALL DATABASE FK INTEGRITY TESTS PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error in entry-database-fk-integrity.ts:", error);
  process.exit(1);
});

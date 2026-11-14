// Real-code regression coverage for the backup/restore pipeline
// (electron/main/backup-service.ts), run against an actual temp SQLite
// database. Same runtime constraints as entry-order-invoice.ts (needs a
// real Electron app instance for app.getPath()/better-sqlite3's
// Electron-ABI native binding).
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

async function main() {

  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) {
      failures++;
      console.error("FAIL:", label);
    } else {
      console.log("PASS:", label);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-backup-test-"));
  app.setPath("userData", tmpDir);

  const { getDatabase, getDatabaseFilePath, closeDatabase } = await import("../../src/database/database");
  const { createCustomer, getCustomers } = await import("../../src/repositories/customer-repository");
  const {
    createBackup,
    restoreFromBackup,
    checkDatabaseIntegrity
  } = await import("../../electron/main/backup-service");

  getDatabase(); // opens + initializes schema (also seeds demo data)

  createCustomer({
    name: "Backup Marker Customer",
    email: "backup-marker@example.com",
    phone: "0170000001",
    address: "Marker Address"
  });
  const beforeCount = (getCustomers() as any[]).length;
  assertTrue(beforeCount > 0, "fixture data exists before backup");

  // ---- 1. Valid backup succeeds and produces a real SQLite file ----
  const backupPath = path.join(tmpDir, "test-backup.db");
  const backupResult = await createBackup(backupPath);
  assertTrue(backupResult.success === true, "createBackup() succeeds for a valid destination");
  assertTrue(fs.existsSync(backupPath), "backup file exists on disk after createBackup()");

  const header = Buffer.alloc(16);
  const fd = fs.openSync(backupPath, "r");
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  assertTrue(header.toString("utf-8") === "SQLite format 3\0", "backup file has a genuine SQLite header");

  // ---- 2. Backup destination cannot be the live DB file ----
  const dbPath = getDatabaseFilePath();
  const selfBackup = await createBackup(dbPath);
  assertTrue(selfBackup.success === false, "createBackup() rejects the live database file as its own destination");

  // ---- 3. Invalid file is rejected by restore, live DB untouched ----
  const garbagePath = path.join(tmpDir, "not-a-database.db");
  fs.writeFileSync(garbagePath, "this is not a sqlite file");
  const invalidRestore = await restoreFromBackup(garbagePath);
  assertTrue(invalidRestore.success === false, "restoreFromBackup() rejects a non-SQLite file");
  assertTrue(
    (getCustomers() as any[]).length === beforeCount,
    "live database is untouched after a rejected (invalid-file) restore attempt"
  );

  // ---- 4. Add more data, then restore from the earlier backup;
  // confirm the later data is gone (i.e. the restore actually took
  // effect) and a safety backup of the pre-restore state was made. ----
  createCustomer({
    name: "Post-Backup Customer",
    email: "post-backup@example.com",
    phone: "0170000002",
    address: "Post-backup Address"
  });
  const afterExtraInsert = (getCustomers() as any[]).length;
  assertTrue(afterExtraInsert === beforeCount + 1, "second customer was actually inserted before restore");

  const restoreResult = await restoreFromBackup(backupPath);
  assertTrue(restoreResult.success === true, "restoreFromBackup() succeeds for a valid backup file");
  assertTrue(!!restoreResult.safetyBackupPath, "restore produced a safety-backup path");
  assertTrue(
    !!restoreResult.safetyBackupPath && fs.existsSync(restoreResult.safetyBackupPath),
    "the pre-restore safety backup file actually exists on disk"
  );

  // getDatabase() must re-open the now-restored file on next access
  // (restoreFromBackup() closes the live handle as part of the swap).
  const afterRestore = (getCustomers() as any[]).length;
  assertTrue(
    afterRestore === beforeCount,
    `restored database reflects the backed-up state (expected ${beforeCount} customers, found ${afterRestore})`
  );
  assertTrue(
    !(getCustomers() as any[]).some(c => c.email === "post-backup@example.com"),
    "the post-backup customer (added after the backup was taken) is gone after restore"
  );

  // ---- 5. Integrity check on the restored, live database ----
  const integrity = checkDatabaseIntegrity();
  assertTrue(integrity.success === true && integrity.ok === true, "PRAGMA integrity_check reports ok on the restored database");

  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(failures === 0 ? "\nALL BACKUP/RESTORE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("TEST HARNESS ERROR", err);
  process.exit(1);
});

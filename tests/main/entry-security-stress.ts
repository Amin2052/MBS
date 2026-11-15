// Security and load coverage at the data layer.
//
//   A. SQL injection: every value below is hostile text. Queries in this app
//      are parameterised, so the assertions are that the hostile text is
//      stored/returned literally, that the tables still exist afterwards, and
//      that a hostile *search* string cannot widen a result set.
//   B. Password storage: salted hashes, no plaintext, wrong password rejected.
//   C. Session boundary: requirePermission() rejects after logout, and an
//      Employee with no profile is denied rather than defaulting to allowed.
//   D. Load: bulk insert/read timings on a real on-disk SQLite database, with
//      generosity-wide ceilings that only catch pathological regressions
//      (n+1 queries, repeated full scans), plus integrity checks afterwards.
//
// Runs inside a real Electron process for the better-sqlite3 ABI, like every
// tests/main/entry-*.ts file.
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

  function assertEqual<T>(actual: T, expected: T, label: string) {
    assertTrue(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-security-stress-"));
  app.setPath("userData", tmpDir);

  const { getDatabase, closeDatabase } = await import("../../src/database/database");
  const { createCustomer, getCustomers } = await import("../../src/repositories/customer-repository");
  const { createProduct, getProducts } = await import("../../src/repositories/product-repository");
  const { createOrder, getOrders } = await import("../../src/repositories/order-repository");
  const { getCertificates } = await import("../../src/repositories/certificate-repository");
  const { setupOwnerAccount, login, logout } = await import("../../electron/main/auth/auth-manager");
  const { requirePermission } = await import("../../electron/main/auth/authorization");
  const { createUser } = await import("../../src/repositories/user-repository");
  const { hashPassword, verifyPassword } = await import("../../electron/main/auth/security/password");
  const { licenseManagerV2 } = await import("../../electron/main/license-v2/license-manager");

  // Pin the licence so quotas and the permission boundary are the same on every
  // machine (see entry-ipc-security.ts for the full reasoning).
  licenseManagerV2.getStatus = () => ({ activated: true, status: "trial" });

  const db = getDatabase();

  // ---------------------------------------------------------------------
  // A. SQL injection
  // ---------------------------------------------------------------------
  console.log("\n--- A. injection attempts ---");

  const hostileName = "Robert'); DROP TABLE customers;--";
  const hostileSku = "X' OR '1'='1";

  createCustomer({
    name: hostileName,
    email: "injection@example.com",
    phone: "+8801700000009",
    address: "1'); DELETE FROM users;--"
  });

  const storedCustomer = (getCustomers() as any[]).find(c => c.email === "injection@example.com");
  assertEqual(storedCustomer?.name, hostileName, "a hostile customer name is stored literally, not executed");
  assertEqual(storedCustomer?.address, "1'); DELETE FROM users;--", "a hostile address is stored literally");

  const customersTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'")
    .get() as { name?: string } | undefined;
  assertTrue(!!customersTable, "the customers table still exists after the injection attempt");

  const usersTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { name?: string } | undefined;
  assertTrue(!!usersTable, "the users table still exists after the injection attempt");

  createProduct({ name: "Injection Product", category: "QA", sku: hostileSku, price: 10, stock: 1 });
  const products = getProducts() as any[];
  assertEqual(products.filter(p => p.sku === hostileSku).length, 1, "a hostile SKU is stored literally");

  const hostileSearch = "%' OR 1=1 --";
  const certificates = getCertificates({ search: hostileSearch });
  assertEqual(certificates.length, 0, "a hostile certificate search string cannot widen the result set");

  const wiped = db.prepare("SELECT COUNT(*) as count FROM customers").get() as { count: number };
  assertTrue(wiped.count > 0, `customers still contain rows after all injection attempts (${wiped.count})`);

  // ---------------------------------------------------------------------
  // B. Password storage
  // ---------------------------------------------------------------------
  console.log("\n--- B. password storage ---");

  const password = "CorrectHorse1!";
  const hashA = await hashPassword(password);
  const hashB = await hashPassword(password);

  assertTrue(hashA !== hashB, "the same password hashes to different values (per-password salt)");
  assertTrue(!hashA.includes(password), "the stored hash does not contain the plaintext password");
  assertTrue(await verifyPassword(password, hashA), "the correct password verifies");
  assertTrue(!(await verifyPassword("CorrectHorse2!", hashA)), "a wrong password is rejected");

  // ---------------------------------------------------------------------
  // C. Session boundary
  // ---------------------------------------------------------------------
  console.log("\n--- C. session and permission boundary ---");

  const ownerSetup = await setupOwnerAccount("stress.owner", "StressOwner1!");
  assertTrue(ownerSetup.success === true && !!ownerSetup.user, "owner account created for the permission checks");
  await login("stress.owner", "StressOwner1!", false);

  let ownerAllowed = true;
  try { requirePermission("customers.delete"); } catch { ownerAllowed = false; }
  assertTrue(ownerAllowed, "an Owner session passes requirePermission('customers.delete')");

  const employeeHash = await hashPassword("StressEmp1!");
  const employee = createUser({
    user_type: "employee",
    username: "stress.employee",
    password_hash: employeeHash,
    employee_id: null,
    permission_profile_id: null,
    created_by: ownerSetup.user!.id
  });
  assertTrue(!!employee, "employee account created with no permission profile");

  logout();
  await login("stress.employee", "StressEmp1!", false);

  let employeeDenied = false;
  try { requirePermission("products.create"); } catch { employeeDenied = true; }
  assertTrue(employeeDenied, "an Employee with no profile is denied products.create (default deny, not default allow)");

  logout();

  let noSessionDenied = false;
  try { requirePermission("products.view"); } catch { noSessionDenied = true; }
  assertTrue(noSessionDenied, "requirePermission() rejects after logout");

  await login("stress.owner", "StressOwner1!", false);
  logout();

  // ---------------------------------------------------------------------
  // D. Load
  // ---------------------------------------------------------------------
  console.log("\n--- D. load ---");

  function time(label: string, run: () => void): number {
    const startedAt = Date.now();
    run();
    const ms = Date.now() - startedAt;
    console.log(`  ${label}: ${ms} ms`);
    return ms;
  }

  const PRODUCT_COUNT = 300;
  const CUSTOMER_COUNT = 300;
  const ORDER_COUNT = 150;

  const productsMs = time(`insert ${PRODUCT_COUNT} products`, () => {
    for (let i = 0; i < PRODUCT_COUNT; i++) {
      // Stock must cover every order below: createOrder() decrements it and
      // refuses to oversell, which is the behaviour under test elsewhere.
      createProduct({ name: `Stress Product ${i}`, category: "Stress", sku: `STRESS-P-${i}`, price: 10 + i, stock: 1000 });
    }
  });

  const customersMs = time(`insert ${CUSTOMER_COUNT} customers`, () => {
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
      createCustomer({ name: `Stress Customer ${i}`, email: `stress${i}@example.com`, phone: "+8801700000123", address: "Stress Rd" });
    }
  });

  const firstCustomer = (getCustomers() as any[]).find(c => c.email === "stress0@example.com");
  const firstProduct = (getProducts() as any[]).find(p => p.sku === "STRESS-P-0");

  const ordersMs = time(`insert ${ORDER_COUNT} orders`, () => {
    for (let i = 0; i < ORDER_COUNT; i++) {
      createOrder({
        customer_id: firstCustomer.customer_id,
        customer_name: firstCustomer.name,
        order_type: "Sale",
        payment_method: "Cash",
        order_date: new Date().toISOString().slice(0, 10),
        status: "Pending",
        items: [{
          product_id: firstProduct.product_id,
          product_name: firstProduct.name,
          quantity: 1,
          price: 10,
          total: 10
        }]
      });
    }
  });

  const readProductsMs = time("read all products", () => { getProducts(); });
  const readCustomersMs = time("read all customers", () => { getCustomers(); });
  const readOrdersMs = time("read all orders", () => { getOrders(); });

  // Ceilings are deliberately loose: they exist to catch a regression to
  // per-row queries or repeated table scans, not to police normal variance
  // between machines.
  assertTrue(productsMs < 15000, `bulk product insert stays under 15 s (${productsMs} ms)`);
  assertTrue(customersMs < 15000, `bulk customer insert stays under 15 s (${customersMs} ms)`);
  assertTrue(ordersMs < 30000, `bulk order insert stays under 30 s (${ordersMs} ms)`);
  assertTrue(readProductsMs < 3000, `reading all products stays under 3 s (${readProductsMs} ms)`);
  assertTrue(readCustomersMs < 3000, `reading all customers stays under 3 s (${readCustomersMs} ms)`);
  assertTrue(readOrdersMs < 3000, `reading all orders stays under 3 s (${readOrdersMs} ms)`);

  const allProducts = getProducts() as any[];
  const uniqueProductIds = new Set(allProducts.map(p => p.product_id));
  assertEqual(uniqueProductIds.size, allProducts.length, "every product has a unique product_id after the bulk insert");

  const allOrders = getOrders() as any[];
  const uniqueOrderIds = new Set(allOrders.map(o => o.order_id));
  assertEqual(uniqueOrderIds.size, allOrders.length, "every order has a unique order_id after the bulk insert");

  const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  assertEqual(integrity.integrity_check, "ok", "PRAGMA integrity_check reports ok after the load");

  const dbFile = path.join(tmpDir, "mooral.db");
  const sizeMb = fs.existsSync(dbFile) ? (fs.statSync(dbFile).size / 1024 / 1024).toFixed(1) : "?";
  console.log(`  database file: ${sizeMb} MB after the load`);

  closeDatabase();

  if (failures > 0) {
    console.error(`\n${failures} SECURITY/STRESS TEST(S) FAILED`);
    process.exit(1);
  }

  console.log("\nALL SECURITY/STRESS TESTS PASSED");
  process.exit(0);

}

main().catch(error => {
  console.error("Unhandled error in entry-security-stress.ts:", error);
  process.exit(1);
});

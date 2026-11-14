// Real-code regression coverage for:
//   1. order row `id` stability across updateOrder() (no delete+reinsert)
//   2. order_id / invoice_id NEVER being reused after a delete
//   3. no duplicate order_id/invoice_id under rapid sequential creation
//   4. Order -> Invoice automation (create-once, refresh-not-duplicate)
//
// Run against an actual (temp, on-disk) SQLite database through the real
// repository modules -- not a reimplementation. This has to run under a
// real Electron app instance (not plain Node, not ELECTRON_RUN_AS_NODE)
// because getDatabase() uses app.getPath("userData"), and better-sqlite3's
// native binding is only built for Electron's Node ABI (see package.json's
// postinstall).
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-test-"));
  // getDatabase() -> getDatabaseFilePath() reads app.getPath("userData"),
  // so point it at a scratch directory for this test run only.
  app.setPath("userData", tmpDir);

  const { getDatabase, closeDatabase } = await import("../../src/database/database");
  const { createOrder, updateOrder, deleteOrder, getOrders } = await import("../../src/repositories/order-repository");
  const { getInvoices, deleteInvoice } = await import("../../src/repositories/invoice-repository");
  const { createProduct, getProducts } = await import("../../src/repositories/product-repository");
  const { createCustomer, getCustomers } = await import("../../src/repositories/customer-repository");

  getDatabase(); // opens + initializes schema (also seeds demo data)

  createCustomer({
    name: "Regression Test Customer",
    email: "regression-test@example.com",
    phone: "0170000000",
    address: "123 Market Rd"
  });
  const customer = (getCustomers() as any[]).find(c => c.email === "regression-test@example.com");
  assertTrue(!!customer, "fixture customer was created and is queryable");

  createProduct({
    name: "Regression Test Widget",
    category: "General",
    sku: "REG-WID-1",
    price: 100,
    stock: 100000
  });
  const product = (getProducts() as any[]).find(p => p.sku === "REG-WID-1");
  assertTrue(!!product, "fixture product was created and is queryable");

  createProduct({
    name: "Regression Test Gadget",
    category: "General",
    sku: "REG-GAD-1",
    price: 50,
    stock: 100000
  });
  const product2 = (getProducts() as any[]).find(p => p.sku === "REG-GAD-1");
  assertTrue(!!product2, "second fixture product was created and is queryable");

  // ================================================================
  // 1. Rapid/sequential creation: no duplicate order_id.
  // ================================================================
  const N = 120;
  for (let i = 0; i < N; i++) {
    createOrder({
      customer_id: customer.customer_id,
      customer_name: customer.name,
      items: [{ product_id: product.product_id, product_name: product.name, quantity: 1, price: 100, total: 100 }],
      status: "Pending"
    });
  }

  const allOrders = getOrders() as any[];
  const testOrders = allOrders.filter(o => o.customer_name === customer.name);
  const orderIds = allOrders.map(o => o.order_id);
  const uniqueOrderIds = new Set(orderIds);
  assertTrue(testOrders.length === N, `created exactly ${N} test orders (found ${testOrders.length})`);
  assertTrue(uniqueOrderIds.size === orderIds.length, `all ${orderIds.length} order rows in the table have unique order_id (no duplicates under rapid sequential creation)`);
  assertTrue(orderIds.every(id => /^ORD-\d{6}$/.test(id)), "every order_id matches the ORD-###### format");

  // ================================================================
  // 2. Order row `id` stability across updateOrder(): quantity/price/
  // status edits, and adding a second line item, must never change the
  // id of a line item that survives the edit.
  // ================================================================
  const created = createOrder({
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [{ product_id: product.product_id, product_name: product.name, quantity: 2, price: 100, total: 200 }],
    status: "Pending"
  }) as any;

  const createdRow = (getOrders() as any[]).find(o => o.order_id === created.order_id);
  assertTrue(!!createdRow, "newly created order is findable via getOrders()");
  const originalOrderRowId: number = createdRow.id;

  // Edit #1: change quantity/status on the same single line item.
  updateOrder(originalOrderRowId, {
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [{ product_id: product.product_id, product_name: product.name, quantity: 5, price: 100, total: 500 }],
    status: "Pending"
  });

  const afterEdit1 = (getOrders() as any[]).find(o => o.order_id === created.order_id);
  assertTrue(!!afterEdit1, "order is still findable by order_id after edit #1");
  assertTrue(afterEdit1.id === originalOrderRowId, `order row id stayed ${originalOrderRowId} after a quantity/status edit (found ${afterEdit1?.id})`);
  assertTrue(afterEdit1.items?.[0]?.quantity === 5, "edit #1's new quantity was actually persisted");

  // Edit #2: add a second, brand-new line item. The ORIGINAL line item's
  // row (and therefore the order's representative id) must still be
  // stable; only the new line item gets a new row.
  updateOrder(originalOrderRowId, {
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [
      { product_id: product.product_id, product_name: product.name, quantity: 5, price: 100, total: 500 },
      { product_id: product2.product_id, product_name: product2.name, quantity: 1, price: 50, total: 50 }
    ],
    status: "Pending"
  });

  const afterEdit2 = (getOrders() as any[]).find(o => o.order_id === created.order_id);
  assertTrue(!!afterEdit2, "order is still findable by order_id after edit #2 (adding a line item)");
  assertTrue(afterEdit2.id === originalOrderRowId, `order row id stayed ${originalOrderRowId} after adding a second line item (found ${afterEdit2?.id})`);
  assertTrue(afterEdit2.items?.length === 2, "order now has both line items after edit #2");

  // Edit #3: complete the order (status change, same items). Still the
  // same id, and this is also the Order -> Invoice automation check.
  updateOrder(originalOrderRowId, {
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [
      { product_id: product.product_id, product_name: product.name, quantity: 5, price: 100, total: 500 },
      { product_id: product2.product_id, product_name: product2.name, quantity: 1, price: 50, total: 50 }
    ],
    status: "Completed"
  });

  const afterComplete = (getOrders() as any[]).find(o => o.order_id === created.order_id);
  assertTrue(afterComplete.id === originalOrderRowId, `order row id stayed ${originalOrderRowId} after completing the order (found ${afterComplete?.id})`);

  const afterFirstComplete = (getInvoices() as any[]).filter(inv => inv.order_id === created.order_id);
  assertTrue(afterFirstComplete.length === 1, "completing a Pending order creates exactly one invoice");

  const firstInvoiceId: string = afterFirstComplete[0].invoice_id;

  // Re-save as Completed again (e.g. editing line items after
  // completion) and confirm the SAME invoice is refreshed, not
  // duplicated, and the order row id is still unchanged.
  updateOrder(originalOrderRowId, {
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [{ product_id: product.product_id, product_name: product.name, quantity: 3, price: 100, total: 300 }],
    status: "Completed"
  });

  const afterSecondComplete = (getInvoices() as any[]).filter(inv => inv.order_id === created.order_id);
  const afterSecondCompleteOrder = (getOrders() as any[]).find(o => o.order_id === created.order_id);
  assertTrue(afterSecondCompleteOrder?.id === originalOrderRowId, `order row id stayed ${originalOrderRowId} after re-saving a Completed order (found ${afterSecondCompleteOrder?.id})`);
  assertTrue(afterSecondComplete.length === 1, "re-saving a Completed order refreshes, not duplicates, its invoice");
  assertTrue(afterSecondComplete[0]?.total === 300, "refreshed invoice reflects the updated line item total");
  assertTrue(afterSecondComplete[0]?.invoice_id === firstInvoiceId, "the refreshed invoice kept the same invoice_id (not a new one)");

  // Edit #4: remove the ORIGINAL line item, keeping a different one --
  // this is the one case where the representative id is expected to
  // move on, since the specific row it pointed to is genuinely gone.
  // (Reset back to Pending first so this doesn't touch invoice logic.)
  updateOrder(originalOrderRowId, {
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [{ product_id: product2.product_id, product_name: product2.name, quantity: 1, price: 50, total: 50 }],
    status: "Pending"
  });
  const afterRemovingOriginalLine = (getOrders() as any[]).find(o => o.order_id === created.order_id);
  assertTrue(!!afterRemovingOriginalLine, "order is still findable after removing its original line item");
  assertTrue(afterRemovingOriginalLine.items?.length === 1 && afterRemovingOriginalLine.items[0].product_id === product2.product_id, "surviving line item is the one that was kept");

  // ================================================================
  // 3. Deleted order_id is NEVER reused.
  // ================================================================
  const orderToDelete = createOrder({
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [{ product_id: product.product_id, product_name: product.name, quantity: 1, price: 100, total: 100 }],
    status: "Pending"
  }) as any;
  const deletedOrderId: string = orderToDelete.order_id;

  const orderToDeleteRow = (getOrders() as any[]).find(o => o.order_id === deletedOrderId);
  deleteOrder(orderToDeleteRow.id);

  assertTrue(
    !(getOrders() as any[]).some(o => o.order_id === deletedOrderId),
    "deleted order no longer appears in getOrders()"
  );

  const orderIdsAfterDeleteReuseCheck: string[] = [];
  for (let i = 0; i < 10; i++) {
    const o = createOrder({
      customer_id: customer.customer_id,
      customer_name: customer.name,
      items: [{ product_id: product.product_id, product_name: product.name, quantity: 1, price: 100, total: 100 }],
      status: "Pending"
    }) as any;
    orderIdsAfterDeleteReuseCheck.push(o.order_id);
  }
  assertTrue(
    !orderIdsAfterDeleteReuseCheck.includes(deletedOrderId),
    `deleted order_id ${deletedOrderId} was never reused by any of the next 10 created orders`
  );

  // ================================================================
  // 4. Deleted invoice_id is NEVER reused.
  // ================================================================
  const orderForInvoiceDelete = createOrder({
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [{ product_id: product.product_id, product_name: product.name, quantity: 1, price: 100, total: 100 }],
    status: "Pending"
  }) as any;
  const rowForInvoiceDelete = (getOrders() as any[]).find(o => o.order_id === orderForInvoiceDelete.order_id);
  updateOrder(rowForInvoiceDelete.id, {
    customer_id: customer.customer_id,
    customer_name: customer.name,
    items: [{ product_id: product.product_id, product_name: product.name, quantity: 1, price: 100, total: 100 }],
    status: "Completed"
  });
  const invoiceToDelete = (getInvoices() as any[]).find(inv => inv.order_id === orderForInvoiceDelete.order_id);
  assertTrue(!!invoiceToDelete, "fixture invoice for the delete/never-reuse check was created");
  const deletedInvoiceId: string = invoiceToDelete.invoice_id;

  deleteInvoice(invoiceToDelete.id);
  assertTrue(
    !(getInvoices() as any[]).some(inv => inv.invoice_id === deletedInvoiceId),
    "deleted invoice no longer appears in getInvoices()"
  );

  const invoiceIdsAfterDeleteReuseCheck: string[] = [];
  for (let i = 0; i < 10; i++) {
    const o = createOrder({
      customer_id: customer.customer_id,
      customer_name: customer.name,
      items: [{ product_id: product.product_id, product_name: product.name, quantity: 1, price: 100, total: 100 }],
      status: "Pending"
    }) as any;
    const row = (getOrders() as any[]).find(x => x.order_id === o.order_id);
    updateOrder(row.id, {
      customer_id: customer.customer_id,
      customer_name: customer.name,
      items: [{ product_id: product.product_id, product_name: product.name, quantity: 1, price: 100, total: 100 }],
      status: "Completed"
    });
    const inv = (getInvoices() as any[]).find(x => x.order_id === o.order_id);
    if (inv) invoiceIdsAfterDeleteReuseCheck.push(inv.invoice_id);
  }
  assertTrue(
    !invoiceIdsAfterDeleteReuseCheck.includes(deletedInvoiceId),
    `deleted invoice_id ${deletedInvoiceId} was never reused by any of the next 10 completed orders' invoices`
  );

  // ================================================================
  // 5. Final global collision check across everything created above.
  // ================================================================
  const finalOrderIds = (getOrders() as any[]).map(o => o.order_id);
  assertTrue(new Set(finalOrderIds).size === finalOrderIds.length, `all ${finalOrderIds.length} final order rows have unique order_id (no collisions)`);

  const finalInvoiceIds = (getInvoices() as any[]).map(inv => inv.invoice_id);
  assertTrue(new Set(finalInvoiceIds).size === finalInvoiceIds.length, `all ${finalInvoiceIds.length} final invoice rows have unique invoice_id (no collisions)`);

  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(failures === 0 ? "\nALL ORDER/INVOICE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("TEST HARNESS ERROR", err);
  process.exit(1);
});

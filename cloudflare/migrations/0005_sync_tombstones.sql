-- Mooral Business Suite — delete/tombstone support for real bidirectional sync.
--
-- Without this, a DELETE on the Worker hard-removed the D1 row, so a pull
-- using ?since=<cursor> (see 0004_sync_cursor_columns.sql) would never see
-- that the record was deleted -- it would simply vanish from future pull
-- pages with no signal, and any device that already had a local copy would
-- keep it forever, orphaned. Soft-deleting (stamping deleted_at instead of
-- removing the row) lets a delete show up as a normal "this changed"
-- event in the same incremental pull, carrying enough information for the
-- puller to apply a local delete instead of an insert/update.
--
-- SAFETY: purely additive (ALTER TABLE ... ADD COLUMN ... DEFAULT NULL),
-- same safety profile as 0002/0004. No existing row is affected --
-- deleted_at is NULL for everything until an actual delete happens.

ALTER TABLE products ADD COLUMN deleted_at DATETIME;
ALTER TABLE customers ADD COLUMN deleted_at DATETIME;
ALTER TABLE employees ADD COLUMN deleted_at DATETIME;
ALTER TABLE employee_contracts ADD COLUMN deleted_at DATETIME;
ALTER TABLE orders ADD COLUMN deleted_at DATETIME;
ALTER TABLE inventory_transactions ADD COLUMN deleted_at DATETIME;
ALTER TABLE transactions ADD COLUMN deleted_at DATETIME;
ALTER TABLE accounts ADD COLUMN deleted_at DATETIME;
ALTER TABLE journal_entries ADD COLUMN deleted_at DATETIME;
ALTER TABLE ledger_entries ADD COLUMN deleted_at DATETIME;
ALTER TABLE invoices ADD COLUMN deleted_at DATETIME;
ALTER TABLE certificates ADD COLUMN deleted_at DATETIME;
ALTER TABLE notifications ADD COLUMN deleted_at DATETIME;

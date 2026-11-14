import { getDatabase } from "../database/database";

// ===================================================================
// Audit Log Repository
//
// General-purpose audit trail covering Product / Customer / Order /
// Inventory / Certificate / Employee / User-Permission / Settings
// changes (Phase 7). Distinct from password-reset-repository.ts, which
// only covers the narrower password-reset-request approval flow.
//
// Follows the same thin repository pattern used elsewhere -- plain
// prepared statements, no business logic. Callers (electron/main/main.ts
// IPC handlers) are responsible for deciding *when* to record an entry;
// this file only persists/reads them.
// ===================================================================

export type AuditModule =
  | "products"
  | "customers"
  | "orders"
  | "inventory"
  | "certificates"
  | "employees"
  | "permissions"
  | "settings";

export type AuditAction = "create" | "edit" | "delete" | "adjust";

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  user_type: string | null;
  module: AuditModule;
  action: AuditAction;
  record_id: string | null;
  record_label: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface RecordAuditLogInput {
  userId: number | null;
  username: string | null;
  userType: string | null;
  module: AuditModule;
  action: AuditAction;
  recordId?: string | number | null;
  recordLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface AuditLogFilter {
  module?: AuditModule;
  userId?: number;
  action?: AuditAction;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

/** Records a single audit-log entry. Never throws on serialization --
 *  a bad `oldValue`/`newValue` (e.g. a circular structure) should not
 *  block the underlying create/edit/delete it's describing. */
export function recordAuditLog(entry: RecordAuditLogInput): void {

  const db = getDatabase();

  let oldValueJson: string | null = null;
  let newValueJson: string | null = null;

  try {
    oldValueJson = entry.oldValue === undefined || entry.oldValue === null
      ? null
      : JSON.stringify(entry.oldValue);
  } catch {
    oldValueJson = null;
  }

  try {
    newValueJson = entry.newValue === undefined || entry.newValue === null
      ? null
      : JSON.stringify(entry.newValue);
  } catch {
    newValueJson = null;
  }

  db.prepare(`
    INSERT INTO audit_log (
      user_id, username, user_type, module, action,
      record_id, record_label, old_value, new_value
    ) VALUES (
      @userId, @username, @userType, @module, @action,
      @recordId, @recordLabel, @oldValue, @newValue
    )
  `).run({
    userId: entry.userId,
    username: entry.username,
    userType: entry.userType,
    module: entry.module,
    action: entry.action,
    recordId: entry.recordId === undefined || entry.recordId === null ? null : String(entry.recordId),
    recordLabel: entry.recordLabel ?? null,
    oldValue: oldValueJson,
    newValue: newValueJson
  });

}

export function listAuditLogs(filter: AuditLogFilter = {}, limit = 500): AuditLogEntry[] {

  const db = getDatabase();

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.module) {
    clauses.push("module = @module");
    params.module = filter.module;
  }

  if (filter.userId !== undefined) {
    clauses.push("user_id = @userId");
    params.userId = filter.userId;
  }

  if (filter.action) {
    clauses.push("action = @action");
    params.action = filter.action;
  }

  if (filter.fromDate) {
    clauses.push("date(created_at) >= date(@fromDate)");
    params.fromDate = filter.fromDate;
  }

  if (filter.toDate) {
    clauses.push("date(created_at) <= date(@toDate)");
    params.toDate = filter.toDate;
  }

  if (filter.search) {
    clauses.push("(record_label LIKE @search OR record_id LIKE @search OR username LIKE @search)");
    params.search = `%${filter.search}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  params.limit = limit;

  return db.prepare(`
    SELECT * FROM audit_log
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `).all(params) as AuditLogEntry[];

}

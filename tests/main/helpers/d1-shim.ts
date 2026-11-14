// Adapts better-sqlite3 to the small subset of Cloudflare D1's
// env.DB.prepare(sql).bind(...args).first()/.all()/.run() API that
// cloudflare/worker/index.js actually uses. This lets tests run the REAL
// Worker source file directly (`import("../../../cloudflare/worker/index.js")`)
// against a REAL SQLite database (via the same better-sqlite3 dependency
// MBS's own local database already uses) instead of hand-reimplementing
// the Worker's contract in a mock HTTP server. Evidence produced by tests
// using this shim is evidence about the actual deployed code, modulo
// genuine Workers-runtime-only behavior (there isn't any here -- the
// Worker only uses standard Web APIs and node:crypto, both available in
// plain Node).
import Database from "better-sqlite3";

export function createD1Shim(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  function bindableArgs(args: unknown[]): unknown[] {
    // D1/Workers callers pass `undefined` for "no value"; better-sqlite3
    // throws on `undefined` bindings (it requires `null`). This mirrors
    // what a real D1 binding does in practice.
    return args.map(a => (a === undefined ? null : a));
  }

  function prepare(sql: string) {
    const stmt = db.prepare(sql);
    return {
      bind(...args: unknown[]) {
        const bound = bindableArgs(args);
        return {
          async first(): Promise<Record<string, unknown> | null> {
            const row = stmt.get(...bound);
            return row === undefined ? null : (row as Record<string, unknown>);
          },
          async all(): Promise<{ results: Record<string, unknown>[] }> {
            const rows = stmt.all(...bound);
            return { results: rows as Record<string, unknown>[] };
          },
          async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
            const info = stmt.run(...bound);
            return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
          }
        };
      }
    };
  }

  return {
    DB: { prepare },
    close: () => db.close(),
    raw: db
  };
}

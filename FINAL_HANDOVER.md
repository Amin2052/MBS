# MBS → Cloudflare Migration — FINAL_HANDOVER

Session date: 2026-08-29. Picks up exactly from `handover.txt` / `BACKUP_STATE.md`.

## Honesty note on execution environment (read this first)

This session ran in a sandboxed container, not on the Owner PC or against
live Cloudflare infrastructure. Outbound network in this container is
domain-allowlisted and does **not** include `api.cloudflare.com` or
`*.workers.dev` (verified: both returned `403` from the egress proxy before
any other work started). That means:

- Everything below marked **VERIFIED (local)** was actually run in this
  session, with real command output shown, against a real local
  reconstruction of the repo (installed deps, real `tsc`, real Electron
  binary, real `better-sqlite3` rebuild, real test run, real production
  build).
- Everything marked **NOT EXECUTED — needs your machine** genuinely could
  not be run here and still needs a real `wrangler`/wrangler-authenticated
  run on your machine, with the real output pasted back before it can be
  called verified. Nothing here is fabricated as if it had run.

## What was found and fixed

### 1. Root cause of the "358 synced / 0 conflicts / 65 errors" real migration run — FOUND, not previously known

Both `scripts/owner-pc-d1-migrate.mjs` and the app's own
`electron/main/cloud/cloud-sync-manager.ts` had `permission_profiles`,
`user_permissions`, and `profile_permissions` in their `CORE_TABLES` list.
`cloudflare/worker/index.js`'s `handleData()` (already correct, from an
earlier session) explicitly **refuses** those 3 collections on the generic
`/v1/data/:collection` path with `400`, because they already have a
dedicated path (`/v1/admin/permissions/sync`, called separately and
correctly by `syncUsersAndPermissions()`). So every row in those 3 tables
was pushed a **second** time through a path guaranteed to reject it.

This explains the numbers exactly: the dry run (`423/0/0`) never makes a
real network call, so it never hit the refusal — only the real run did.
`423 - 358 = 65`.

This is also a **live bug in the desktop app itself**, not just the
one-shot script: every 15-second background sync cycle has been hitting
this same guaranteed `400` for every row in those 3 tables, forever, since
the Worker's refusal was added. Fixing `cloud-sync-manager.ts` stops that
recurring error, not just the migration script's one-time run.

**Fix:** removed those 3 collections from `CORE_TABLES` in both files (kept
`permissions` — singular, the static catalog table — since it IS allowed on
the generic path and was not part of the problem). TypeScript typecheck and
the local test suite both pass after the change (see Verification below).

### 2. `company_settings` "D1_ERROR: too many SQL variables" — FOUND and FIXED

`handleCompanySettings`'s `POST` path bound all 81 `company_settings`
columns **twice**: once for the `INSERT` values list, again for a literal
`col=?` `ON CONFLICT ... UPDATE SET` clause — 162 bound parameters in one
query. Confirmed via web search: D1 caps bound parameters at **100 per
query** (https://developers.cloudflare.com/d1/platform/limits/), so this
always failed, on every single `company_settings` sync attempt.

**Fix:** the `UPDATE SET` clause now references `excluded.col` (the same
pattern every other table's upsert in this file already used), so the
values are bound once — 81 params, under the limit. No `company_settings`
field was dropped, truncated, or made optional to work around this.

### 3. `decrypt-key.mjs` — hardened, given to you separately (not in this ZIP)

Per handover §7, the previous version produced no output and no error, and
the cause was never diagnosed. Since it's explicitly not a repo file (a
throwaway one-shot helper, to be deleted after use), a new hardened version
was written and is provided **alongside** this ZIP, not inside it:

- Every step, including `app.whenReady()` itself, is wrapped in try/catch,
  with explicit console output on every path (success and failure alike).
- Top-level `uncaughtException`/`unhandledRejection` handlers are installed
  first, so a crash during Electron startup can't fail silently again.
- Clipboard copy now uses Electron's own `clipboard.writeText()` instead of
  shelling out to `clip.exe` — removes the PATH/`execFile` failure mode
  entirely.
- If `cloud-sync.json` doesn't exist, it prints the exact path it looked
  for instead of exiting quietly.

Run with `npx electron decrypt-key.mjs` from inside the project folder (so
Electron resolves the project's own installed version and `app.getPath
('userData')` matches the real app's own path), then delete the file.

### 4. `PRODUCTION_BATCH.md` — one stale/wrong verification query fixed

Step 6's verification query selected `COUNT(*) GROUP BY collection FROM
cloud_records` — that's the earlier/unused sync design (confirmed 0 rows,
always will be 0 rows; it was never the real write target). Following that
step as originally written would have shown "0 records synced" even after
a fully successful sync. Replaced with real per-table counts against the
actual relational tables `/v1/data/:collection` writes to. Also added
explicit verification sub-steps (4a/4b) for fixes #1 and #2 above, and
noted that step 3's Worker redeploy is now actually required (a real
source change was made, not just a stylistic one).

### 5. Migration script — added targeted-retry capability

Per the task's failed-record-recovery requirement: added `--tables
<comma-list>` (restrict a run to specific tables) and `--retry-from
<previous-result.json>` (restrict a run to only the specific rows recorded
as `errors` last time, recovered from their stored composite id — never
re-sends rows that already succeeded or hit a `409` conflict). Documented
in the script's own header. Since every write is upsert-safe by design,
a full re-run remains safe too; these flags are for surgical control when
you want it, not a requirement to use them.

## What was explicitly NOT changed (preserved as-is, per your instructions)

- `messages` / `erp_data` legacy tables and their existing rows — untouched
  by every change above; none of the modified code paths ever reference
  either table.
- `mbs_messages` schema, message handlers, and the messaging feature as a
  whole — no changes.
- `permission_profiles`/`user_permissions` D1 ID-assignment behavior in
  `handlePermissionSync` (client-supplied integer IDs written directly) —
  this is pre-existing design from an earlier session, not something the
  handover flagged as broken, and changing it would be an architecture
  redesign outside this task's scope. **Worth knowing for later:** this
  only stays fully correct as long as D1's `permission_profiles`/`users`
  tables were empty before the very first sync from this Owner PC (true
  today). If a second PC ever seeds cloud permission data independently
  before syncing, or the D1 tables are ever reset, local integer IDs from
  two machines could collide or drift from D1's assigned `users.id`. Not a
  bug to fix now — a note for whoever eventually looks at true multi-device
  permission sync.
- MBS RBAC, licensing, business logic, and UI — no changes anywhere outside
  the 4 files listed under "Files changed" below.
- Employee Portal — not started, per the explicit gate in your instructions.
- `scripts/verify-online-architecture.mjs` reports `Missing: server/index.js`
  — this is a **pre-existing, unrelated** stale check (references a
  `server/index.js` / `online-database-contract.ts` that predate the
  Cloudflare architecture and were never part of it). It is not part of
  `npm run typecheck`/`test`/`build` and was not touched, since "fixing" it
  would mean redesigning what it checks for — flagging it here rather than
  silently leaving it unexplained.

## Files changed this session

- `cloudflare/worker/index.js` — `handleCompanySettings` bound-parameter fix.
- `electron/main/cloud/cloud-sync-manager.ts` — `CORE_TABLES` fix (permission
  tables removed from the generic-sync loop).
- `scripts/owner-pc-d1-migrate.mjs` — same `CORE_TABLES` fix, plus
  `--tables`/`--retry-from` flags and updated header docs.
- `PRODUCTION_BATCH.md` — fixed stale step 6 query, added steps 4a/4b, noted
  step 3's redeploy is now required.
- `FINAL_HANDOVER.md` — this file (new).
- (separately, not in this ZIP) hardened `decrypt-key.mjs`.

## Verification actually performed this session

All of the following were **actually run in this sandbox**, with real
output (not fabricated), against a full `npm install` + rebuilt
`better-sqlite3` native module + real Electron binary:

- `node --check` on both modified `.js`/`.mjs` files — syntax OK.
- `npx tsc --noEmit -p tsconfig.json --composite false` — **0 errors**.
- `npx tsc --noEmit -p tsconfig.node.json` (covers the modified
  `cloud-sync-manager.ts`) — **0 errors**.
- `node scripts/run-main-tests.mjs` — **ALL BACKUP/RESTORE TESTS PASSED**,
  **ALL ORDER/INVOICE TESTS PASSED** (real Electron process, real
  `better-sqlite3`, real temp SQLite databases, 39 individual assertions).
- `node scripts/release-check.mjs` — **Release signing configuration OK.**
- `npm run build` (`electron-vite build`) — succeeded: `out/main/main.js`,
  `out/preload/preload.js`, `out/renderer/*` all built cleanly, 2586
  renderer modules transformed, no errors.

None of the above touch live Cloudflare/D1 at all, so they prove the code
changes are syntactically and behaviorally sound and don't break the
existing Electron app or its build — but they **cannot** prove the D1/Worker
fixes work against real production D1, because this environment has no
network path to Cloudflare's API. That verification is listed as
NOT EXECUTED below and needs to happen on your machine.

## Real Owner-PC `mooral.db` inspection — NEW this round, read-only, real output

The real `mooral.db` was uploaded this round and inspected read-only (never
written to). This confirms the fixes above against real data instead of
just code review:

**Root-cause math now confirmed exactly, not just plausible:** the old real
run's `65 errors` = 64 rows in the 3 wrongly-routed permission tables
(`permission_profiles`=5 + `user_permissions`=0 + `profile_permissions`=59)
+ exactly 1 row in `company_settings` (the "too many SQL variables" table,
which only has 1 row, the singleton settings row). `64 + 1 = 65`, matching
the real run precisely.

**Schema compatibility — verified column-by-column, no drift:** every
column the Worker's `TABLE_SCHEMAS` / `COMPANY_SETTINGS_COLUMNS` expects
was diffed against `PRAGMA table_info()` on the real local tables for all
15 generic-path tables. Zero mismatches — nothing the Worker expects is
missing locally, nothing present locally would be silently dropped.

**Data-quality checks — all clean:**
- `products.product_id` / `customers.customer_id` (the business keys the
  migration script uses as its per-row identity): 0 NULL/blank values.
- `company_settings`'s 16 `NOT NULL` D1 columns: all populated with real
  values in the local row (no constraint-violation risk).
- Largest text fields (`invoices.items`, `notifications.after_data`,
  `certificates.description`): all under 2KB — far below the Worker's 1MB
  request-body limit.

**Real row counts, real dry-run — actually executed against the real file:**

```text
products: 50   customers: 10   employees: 18   orders: 38
inventory_transactions: 110   transactions: 21   accounts: 4
journal_entries: 5   ledger_entries: 10   invoices: 4   certificates: 2
notifications: 9   employee_contracts: 0   permissions: 77
company_settings: 1
permission_profiles: 5   user_permissions: 0   profile_permissions: 59
  (last 3 correctly NOT touched by this script — dedicated-path only)
users: 1   messages: 0 (local; unrelated to production's separate `messages`)
license: 1 (correctly untouched — not a cloud/migration concern)
```

Ran `node scripts/owner-pc-d1-migrate.mjs --dry-run --db <real mooral.db>`
(via Electron's Node runtime in this sandbox, since only Electron's ABI
could be built here — see Verification section) against the **real file**:

```text
[DRY RUN] Owner-PC migration complete.
  Synced:    359
  Conflicts: 0
  Errors:    0
```

Per-table breakdown (every table synced 100% of its real row count, 0
errors anywhere):

```text
products 50/50  customers 10/10  employees 18/18  orders 38/38
inventory_transactions 110/110  transactions 21/21  accounts 4/4
journal_entries 5/5  ledger_entries 10/10  invoices 4/4  certificates 2/2
notifications 9/9  employee_contracts 0/0  permissions 77/77
company_settings 1/1
```

`359` also matches hand-math exactly: the old dry run's `423` total minus
the 64 permission-table rows that no longer belong in this script's list.

**This dry run used a freshly-generated random device id (not the real
Owner PC's `2c4c03d5-d732-4105-a166-839a237c6275`), because it ran in this
sandbox against a copy of the file, not on the real machine.** This is
fine for a dry run (nothing is written anywhere), but it means: **do not
copy this dry-run's device id anywhere. When you run this for real, always
pass `--device-id 2c4c03d5-d732-4105-a166-839a237c6275` explicitly** (per
handover §5) so records reconcile with what's already in D1 instead of
minting a second identity. The real `mooral.db` was deleted from this
sandbox after inspection; nothing from it is retained anywhere in the
delivered ZIP.

---

## What still needs to happen on your machine (NOT executed here — no fabricated output)

In `PRODUCTION_BATCH.md` order, starting from step 3 (the Worker source
changed, so it needs redeploying):

1. `npx wrangler deploy --config cloudflare/wrangler.toml` — ship the
   `company_settings` fix.
2. Re-run `owner-pc-d1-migrate.mjs` for real, with the fixed `CORE_TABLES`,
   pinned to the real device id:
   ```powershell
   node scripts/owner-pc-d1-migrate.mjs `
     --db "C:\Users\Amin\AppData\Roaming\mooral-business-suite\mooral.db" `
     --device-id "2c4c03d5-d732-4105-a166-839a237c6275" `
     --api-url https://mooral-mbs-api.alamin2052.workers.dev `
     --workspace-id mooral-main `
     --api-key <from clipboard, never typed in chat>
   ```
   Based on this session's real dry-run against your actual database
   (above), expect **`359 synced / 0 conflicts / 0 errors`** — every
   business-data row succeeding, nothing left in error state. If your real
   run's numbers differ from this, paste the output back before assuming
   anything — don't treat this prediction as a substitute for the real
   result.
3. Confirm `company_settings` now saves/syncs the full 73-field row (step
   4b's query) — real local data confirms none of those fields are NULL or
   oversized, so this should succeed cleanly once redeployed.
4. Steps 5–9 of `PRODUCTION_BATCH.md`: auth verification, sync verification
   (with the corrected step-6 query), RBAC verification, data-integrity
   verification (re-check `messages`/`erp_data` are still byte-identical),
   final health check.
5. Run `decrypt-key.mjs` (the hardened version, provided separately) if you
   still need to recover the `MBS_API_KEY` value for any of the above.

Please paste back the real output of each as you go — that's what turns
these into genuinely verified, not just code-fixed.

## FINAL STATUS

```text
CODE COMPLETE: YES — all identified Cloud/D1 bugs fixed, schema-verified
               column-by-column against your real database, real dry-run
               against your real data (359/0/0), typecheck/tests/build all
               pass in this sandbox.

LIVE CLOUD STATUS: NOT EXECUTED — requires your Owner-PC / real Wrangler
               auth, which this sandbox cannot reach (api.cloudflare.com
               and *.workers.dev both return 403 from this container's
               egress proxy — verified, not assumed). No live deploy,
               migration, or D1 write has been performed by any Claude
               session. Run the 3 numbered commands under "What still
               needs to happen on your machine" above, in order, and paste
               the real output back.

PROJECT STATUS: CODE COMPLETE / LIVE CLOUD ACTION PENDING (Owner-PC)
CLOUD MIGRATION: root cause of the 65 errors found, fixed, and confirmed
                 against real data (dry run: 359/0/0) — real execution
                 pending on your machine
D1: NOT VERIFIED (no network path from this sandbox to Cloudflare)
WORKER: NOT VERIFIED (company_settings fix not yet deployed to production)
OWNER-PC DATA: VERIFIED (read-only, real mooral.db inspected this round —
               row counts, schema compatibility, data-quality all checked
               and clean; file deleted from this sandbox after inspection)
AUTH: NOT VERIFIED (requires a live Worker + real owner credentials)
SYNC: NOT VERIFIED (requires a live Worker + real Owner-PC run)
RBAC: NOT VERIFIED (requires a live Worker + a real non-owner session)
BUILD: PASS (npm run build succeeded; typecheck clean; local test suite
             passed — all real, re-run in this session, shown above)
FINAL ZIP: /mnt/user-data/outputs/MBS-cloud-migration-fixed.zip
```

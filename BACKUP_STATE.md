# MBS → Cloudflare Migration — Backup State

Snapshot date: 2026-08-29. No secrets included in this backup (see item 7 below).

**Scope note:** this ZIP contains the source/scripts/docs side of the project as
last known here. It does NOT contain runtime artifacts that exist only on the
Owner PC and were never uploaded here: `cloud-sync.json`, `cloud-device-id.json`,
the `owner-pc-migration-result-*.json` files, or the throwaway `decrypt-key.mjs`
helper. Keep those from the real machine separately if you want a full picture.

## Completed

1. Production D1 (`mooral-db`, `92581899-43b1-4073-9622-5fed9e93b0c8`) inspected;
   confirmed sole existing rows in `messages` (id 1, Admin→All, "Hello Team!")
   and `erp_data` (id 1, inventory) preserved throughout.
2. `cloudflare/migrations/0001_mbs_core_schema.sql`: MBS relational schema,
   `IF NOT EXISTS` only, never touches `messages`/`erp_data`. Adds a
   **separately-named** `mbs_messages` table (production `messages` has an
   incompatible legacy shape) + its indexes.
3. `cloudflare/worker/index.js`: message handlers repointed to `mbs_messages`.
4. Migration applied to real production D1 (47 queries). `mbs_messages` was
   initially missing from the batch (root cause not yet diagnosed — see
   Pending); fixed by directly re-running its `CREATE TABLE IF NOT EXISTS` +
   2 indexes. Confirmed present afterward.
5. Worker deployed: `https://mooral-mbs-api.alamin2052.workers.dev`,
   `/health` → `ok:true`.
6. `scripts/owner-pc-d1-migrate.mjs`: Owner-PC SQLite → D1 tool. Dry-run
   against the real `mooral.db` → 423 synced, 0 conflicts, 0 errors.
7. Device identity: real run used `--device-id 2c4c03d5-d732-4105-a166-839a237c6275`,
   persisted into the app's own `%APPDATA%\mooral-business-suite\cloud-device-id.json`
   first, so future normal app syncs reconcile with it instead of minting a
   second identity.
8. Real migration executed once: **358 synced / 0 conflicts / 65 errors.**
   Root cause of the 65 errors was **not yet determined** — analysis was
   requested but the result JSON's grouped breakdown was never pasted back.
9. `MBS_API_KEY` confirmed to exist as a Cloudflare Worker secret
   (`wrangler secret list`). Safe recovery path documented (decrypt via the
   app's own Electron `safeStorage`, clipboard-only, never logged) — not yet
   confirmed executed.

## Currently stopped at

Diagnosing the 65 real-migration errors. Root cause unknown — could be
Worker/schema (e.g. a NOT NULL column some source rows lack), a source-data
issue (bad type, oversized field), or an auth issue on a subset of requests.
**Do not retry these 65 records until the cause is identified** — retrying
blind risks masking a real data or schema problem.

## Next pending step

1. Get the grouped error breakdown from
   `owner-pc-migration-result-1788014108675.json` (per table / status code /
   message — commands already provided in this conversation).
2. Read-only verify the 358 successful rows actually landed in D1
   (`SELECT COUNT(*) FROM <table> WHERE local_id LIKE '2c4c03d5-...:%'` per
   affected table).
3. Only then decide the safe remediation (schema fix vs. source-data fix vs.
   simple isolated retry of just the 65).
4. Steps 6–9 of `PRODUCTION_BATCH.md` (auth / sync / RBAC / integrity /
   final health check) remain undone.
5. Employee Portal work remains explicitly out of scope until all of the
   above is done.

## Key paths / commands

- Worker: `https://mooral-mbs-api.alamin2052.workers.dev`
- D1: `mooral-db` / `92581899-43b1-4073-9622-5fed9e93b0c8`
- Owner-PC source DB: `C:\Users\Amin\AppData\Roaming\mooral-business-suite\mooral.db`
- Device id file: `C:\Users\Amin\AppData\Roaming\mooral-business-suite\cloud-device-id.json`
- Migration script: `scripts/owner-pc-d1-migrate.mjs`
- Batch runbook: `PRODUCTION_BATCH.md`
- Verify secret exists (no value shown): `npx wrangler secret list --config cloudflare/wrangler.toml`

## Explicitly not included in this ZIP (never provided to this session)

- Real `MBS_API_KEY` value.
- `cloud-sync.json` / `cloud-device-id.json` from the real Owner PC.
- The real `owner-pc-migration-result-*.json` files.
- The real `mooral.db` SQLite file.

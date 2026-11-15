# MBS + MBS-user — implementation and verification report

Date: 2026-11-16
Baseline: `e5f8494` (clean tree, `master`)
Scope: factory/cloud reset investigation and rebuild; central reset endpoint with a stale-device
guard; a separate MBS-user employee application with its own installer; tests for both.

---

## 1. Factory Reset — what it actually did

Before this pass there were two owner-only operations in `electron/main/reset-service.ts`, both
reachable from **Settings → Database**:

| Operation | Deleted | Kept | Restarted app |
|---|---|---|---|
| ERP Reset (`erp:reset`) | notifications, inventory_transactions, transactions, certificates, invoices, orders, employee_contracts, employees, customers, products + the matching `cloud_sync_map` / `sync_cursor` / `sync_offline_queue` rows | users, permission profiles/grants, sessions, company_settings, licence, installation identity | yes |
| Factory Reset (`erp:factoryReset`) | the same business tables, plus all permissions, sessions, **users (Owner included)**, and company_settings reset to first-launch defaults | licence, installation identity | yes (First-Time Setup returns) |

Both ran in a single SQLite transaction, so an interrupted reset rolled back locally. Clearing the
sync bookkeeping was already correct for the single-device case — it stopped the sync engine from
misreading a wipe as thousands of real deletions.

**What was missing (F48/F49):** neither operation mentioned the cloud. On a cloud-connected
installation:

- the central rows still existed, so the next pull downloaded everything the owner just deleted;
- a second device that had been offline still held records and a queue, and could push them back;
- there was no backup step, no password re-authentication, no typed confirmation, and no record of
  the reset beyond the local audit log.

The old UI's 15-second countdown was the only confirmation, and it could not express "this will
also affect every other device".

---

## 2. Reset behaviour after this pass

Three separate operations, never merged behind one switch:

### Local — "Reset this device"
Deletes the business tables listed above on this computer only. Keeps logins, permissions,
company settings and licence. If cloud sync is on, the shared copy is **not** touched and will be
downloaded again on the next sync; the dialog says exactly that and points at the central reset.
Requires owner session + owner password + typing `RESET`. Creates a backup first.

### Central — "Reset central data"
1. Creates a real SQLite backup (`<userData>/backups/pre-cloud-reset-<timestamp>.mbsbackup`).
2. Calls `POST /v1/admin/reset` with the workspace API key and `confirm` = workspace id.
3. The Worker **bumps `workspaces.reset_epoch` first**, then deletes business tables for that
   workspace, then records the operation in `workspace_resets`.
4. This device adopts the new epoch and clears its local business copy + all sync bookkeeping.
5. The app relaunches.

Deleted centrally: notifications, inventory_transactions, transactions, journal_entries,
ledger_entries, certificates, invoices, orders, `mbs_messages`, customers, products, accounts.
Preserved centrally: users, permission profiles/grants, employees, company_settings, audit data.
Requires owner password + typing the workspace id. A failed central call leaves the local database
untouched.

### Complete — "Complete reset"
Central reset first (so a cloud failure aborts before local deletion), then the existing factory
reset: all business data, all accounts, first-run settings. Licence and installation identity are
untouched. Requires owner password + typing `RESET`.

### Stale-device guard (why deleted data stays deleted)
`x-reset-epoch` is sent by the desktop sync client on every request. Once a workspace has been
reset, any write from an older epoch is refused with `409 reset_epoch_mismatch`; a write with no
epoch at all is refused with `409 reset_epoch_required`. Reads are never blocked, so the stale
device can discover the new epoch, clear its pre-reset rows and queue, and re-baseline. The epoch
is persisted outside the database (`cloud-reset-epoch.json` in userData) precisely because the
reset deletes the database contents.

### Interrupted resets
- Local: single transaction, rolls back.
- Central: epoch is bumped before any delete. If the process dies mid-way, no device can write
  stale rows back, and the operation can simply be retried.
- Complete: local factory reset only starts after the central call has succeeded.

---

## 3. Centralised architecture (final)

```
MBS (owner PC)                         Cloudflare                          MBS-user (employee PCs)
─────────────────                      ──────────                          ───────────────────────
Electron + SQLite                      Worker /v1/*                        Electron, no database
licence + API key          ──HTTPS──▶  · login / logout / me              no API key, no licence
15s bidirectional sync                 · data CRUD (permission-checked)    person-based login
reset UI (3 modes)                     · users + permission sync           session token in memory
                                       · admin reset (API key only)        read modules + order status
                                       │                                   conflict detection
                                       ▼                                   offline banner, no queue
                                       D1 (workspace_id on every row)
```

- **D1 is the shared record.** The owner's PC is not a server and need not be switched on for
  employees to work.
- The owner's installation still syncs users/grants up so employee logins exist centrally.
- MBS-user holds no business database and no permanent copy of sensitive records.

---

## 4. MBS ↔ MBS-user communication

| Direction | Mechanism |
|---|---|
| Owner → cloud | API key (`x-api-key`) + workspace id, 15 s sync cycle |
| Cloud → owner | pull by `?since=` cursor, revision-based conflict detection |
| Employee → cloud | Bearer session token from `/v1/auth/login` |
| Cloud → employee | `GET /v1/data/...` (permission-checked), `GET /v1/me/permissions` |
| Employee write | `PATCH /v1/data/orders/:id` with `expected_revision` |
| Owner sees employee change | next sync pull (≤15 s) |
| Employee sees owner change | manual refresh / navigation / 45 s grant refresh |

---

## 5. Employee authentication

- Login fields: **Employee ID** (the MBS login username) + password, plus the server URL and
  workspace id configured on first launch.
- Credentials are the accounts the owner created in MBS; the Worker compares the password against
  the scrypt hash synced from MBS. There is no separate employee credential store.
- Success returns a random 32-byte session token; D1 stores only its SHA-256 hash, with an 8-hour
  expiry. MBS-user keeps the token **in main-process memory only** — never on disk, never in the
  renderer.
- The workspace API key is absent from MBS-user by design; an employee cannot impersonate the
  installation.
- Failed attempts lock the account for 15 minutes after five failures (existing Worker behaviour).

## 6. Permission enforcement

- `/v1/me/permissions` returns the effective grants (profile ∪ user grants − explicit denials);
  owner/administrator are returned as `unrestricted`.
- MBS-user's main process re-checks the required key before every IPC call and before every write,
  and the renderer only renders modules it was told about.
- **The Worker is the real boundary:** `can()` runs on every `/v1/data/*` request, and `/v1/users`
  and `/v1/admin/reset` are separately gated. Verified by calling those endpoints directly with a
  valid employee token and getting 403 (entry-mbs-user).
- Revocation: permission change → effective on the next request; account disabled → the existing
  token stops working immediately and sign-in is refused; password change by the owner → same.

## 7. Multi-user concurrency

- Employees read/write the same central rows; there is no per-device merge for employee work.
- Order status writes require `expected_revision`; a stale revision returns 409
  `revision_conflict`, the client raises a typed conflict, the UI shows it and reloads the row.
- Owner-side sync still uses `cloud_sync_map` revision tracking, so an employee edit is pulled as a
  normal newer revision.
- Order statuses are restricted to the main app's vocabulary (`Pending`, `Pending Approval`,
  `Completed`, `Cancelled`) both client- and UI-side; the Worker stores what it is given, so the
  client is where the vocabulary is enforced.

## 8. Offline / synchronisation behaviour

- MBS-user: offline banner, writes disabled, no queueing/replay (a status change either succeeds
  centrally or is reported failed). The session survives a brief outage; the connection is
  re-checked on demand and by polling.
- MBS (owner): unchanged 15 s push/pull with an offline queue. New: a reset-epoch mismatch triggers
  a one-time re-baseline instead of replaying a stale queue.
- No real-time infrastructure was introduced; polling was sufficient.

---

## 9. Security findings and fixes

| Finding | Resolution |
|---|---|
| F48 Reset never reached the cloud | Three explicit reset modes; central reset + epoch guard |
| F49 No central reset endpoint / no stale-queue guard | API-key-only endpoint, exact confirmation, epoch refused writes, `workspace_resets` record |
| F50 No employee client without the owner's API key | Separate MBS-user app; person-based sessions; no key shipped |
| F51 Green test entries reported TIMEOUT from a harness socket hang | `closeAllConnections()` + fallback; entries exit explicitly |
| F47 Per-request scrypt for API-key calls (High, still open) | Unchanged by design: it is an auth-design change. Note: MBS-user sessions do **not** pay this cost — Bearer auth is a SHA-256 lookup — so employee traffic is not affected by F47 |

Also verified in this pass: an employee session cannot list users or reset central data; a wrong
workspace id refuses valid credentials; logout revokes server-side; a disabled account's token is
dead immediately; stale-revision writes never silently overwrite.

Not done: live Cloudflare deployment, real D1 production reset, brute-force/rate-limit hardening
beyond the existing lockout, secret grep over the MBS-user installer.

---

## 10. Test results

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run typecheck:user` | PASS (strict, whole employee app) |
| `npm run build` | PASS |
| `npm run build:user` | PASS (main 16.2 kB, preload 1.2 kB, renderer 264 kB) |
| `entry-cloud-reset` (new) | **38/38 assertions PASS**, ~2 s |
| `entry-mbs-user` (new) | **28/28 assertions PASS**, ~3 s |
| `npm run dist:win` | PASS — `dist/Mooral Business Suite Setup 0.1.11.exe` (91,355,328 bytes) |
| `npm run dist:user` | PASS — `dist-user/MBS-user Setup 0.1.0.exe` (78,972,869 bytes) |
| `npm run test:main` | **14/14 entries PASS, 350 assertions, 0 FAIL, 0 TIMEOUT** — `bidirectional-sync 210.6s`, `reset-sync-safety 108.6s`, `cloud-multiuser 34.5s`, `order-invoice 31.4s`, everything else ≤ 17 s |
| `npm run test:e2e` | 6/6 PASS (chromium + firefox + webkit) |
| `npm run verify:release` | PASS (build output, `better-sqlite3` linkage, installer present) |
| `npm run verify:online` | PASS (D1 binding, `/v1/*` routing, 6 migrations shipped) |
| `npm run release:check` | PASS (signing configuration OK) |

The new entries run the **actual** `cloudflare/worker/index.js` as a real HTTP server over a real
SQLite database with all six migrations, and MBS-user's test imports the **same** client module the
Electron app uses.

## 11. Performance

- Employee requests avoid the F47 scrypt cost: Bearer authentication is one SHA-256 + a session
  join. The measured per-request cost for MBS-user against the loopback harness is single-digit
  milliseconds including the permission query.
- The owner's sync cost is unchanged (still dominated by per-request scrypt; see F47).
- No new indexes were required for the reset path: the deletes are `WHERE workspace_id=?` on
  tables already indexed by workspace (0002).
- No production-scale load test was run; do not quote a scale figure from this pass.

## 12. Main installer

`dist/Mooral Business Suite Setup 0.1.11.exe` — existing identity, licence flow and database
unchanged; the reset panel and sync changes are included. Unsigned.

## 13. MBS-user installer

`dist-user/MBS-user Setup 0.1.0.exe` — appId `com.mooral.mbsuser`, product name **MBS-user**,
separate version `0.1.0`, separate install directory, own shortcut, data in `%APPDATA%/MBS-user`,
no native modules, no database. Unsigned.

## 14. Installation and connection

See `MBS_USER_INSTALL.md` for the full procedure. Short version:

1. Apply migrations through `0006_workspace_reset_epoch.sql`; deploy the Worker.
2. Owner: enable cloud sync in MBS and run one sync so logins/grants reach D1.
3. Install `dist-user/MBS-user Setup 0.1.0.exe` on the employee PC.
4. Launch, enter server URL + workspace id (once), then employee ID + password.
5. Grant/revoke modules in MBS → **User Management**; changes apply within 45 s and immediately
   server-side.

## 15. Cloud deployment requirements

- `wrangler deploy` for the Worker; D1 bound as `DB`; `MBS_ADMIN_KEY` set as a secret.
- Migrations 0001–0006 applied **in order**; 0006 is mandatory for central reset.
- Each customer workspace provisioned through `/v1/admin/workspaces` (or existing
  `mooral-main` legacy key) and its workspace id/API key issued in the licence.
- HTTPS on the Worker URL; MBS-user refuses non-http(s) addresses.

## 16. Remaining limitations

1. **F47** — per-request scrypt on API-key requests remains a production risk for the owner's sync.
2. Installers are **unsigned** (SmartScreen warns); no clean-machine install test for either app.
3. No live Cloudflare/D1 exercise; central reset was never run against production data (deliberate).
4. MBS-user was tested over loopback HTTP, not installed on a second physical PC.
5. No password-change screen in MBS-user (owner resets in MBS); no employee photo.
6. Polling-based updates (≤45 s), not real-time.
7. No offline write queue in MBS-user, by design.
8. Local reset on a cloud-connected install downloads the central copy again — documented in the UI.
9. `0003_workspace_unique_constraints.sql` is still not applied in `entry-worker-tenant-isolation`,
   which deliberately asserts the pre-0003 global-username conflict.
10. Duplicate `mbs_messages` are deleted by a central reset; audit rows on the owner side are not
    deleted.

## 17. Commits

| Commit | Contents |
|---|---|
| `c66deef` | **feat(reset)** — Worker `reset_epoch` migration + admin reset endpoint + epoch guard; `cloud-reset-service.ts`, `sync-epoch.ts`, local-clear/bookkeeping helpers; password re-auth; preload/types; three-mode reset panel + CSS + i18n (en/bn/ar); sync re-baseline |
| `d962520` | **feat(mbs-user)** — separate application (`mbs-user/**`), shared employee API client, Electron main/preload, renderer, builder config, own package identity; root `build:user` / `typecheck:user` / `dist:user` scripts |
| `21bb31e` | **test(reset)** — `entry-cloud-reset.ts` (38 assertions), `entry-mbs-user.ts` (28), harness socket-close fix |
| this commit | **docs** — AUDIT_LOG F48–F51 + verification rows, this report, `MBS_USER_INSTALL.md` |

## 18. Verdict

**Local reset audited and rebuilt; central reset implemented with a real stale-device guard; the
employee application exists, is separately installable, and enforces permissions server-side.**

Ready for supervised pilot use. Not ready for unmanaged production rollout until F47 is addressed,
the installers are signed, and a central reset has been rehearsed against a staging D1 copy with a
verified backup/restore.

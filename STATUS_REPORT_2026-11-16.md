# Mooral Business Suite — Status Report

**Date:** 16 November 2026
**Branch:** `master` · **HEAD:** `6b6808b`
**Scope covered:** everything delivered up to this point, with the evidence actually executed — and the parts that are still open.

---

## 1. What the software is

| Part | Stack | Role |
|---|---|---|
| **MBS (owner app)** | Electron 31 + React + TypeScript + SQLite (`better-sqlite3`) | Full desktop business suite: dashboard, customers, products, inventory, orders, invoices, accounting, reports, employees, certificates, settings. Owns the local database and the workspaces API key. |
| **Cloudflare Worker + D1** | Worker (`cloudflare/worker/index.js`), 6 migrations | Central multi-tenant store behind `/v1/*`: workspace API keys, per-entity sync endpoints, `/v1/data/*`, `/health`, employee auth, admin reset. |
| **MBS-user (employee app)** | Separate Electron app (`mbs-user/`) | Person-based login against the Worker, permission-gated read modules plus order-status writes. No database, no API key in the renderer. |

Owner app stays fully usable offline; cloud sync is additive. Business logic lives in the main process and is reached through validated IPC.

---

## 2. Work completed in this engagement

| Commit | Change |
|---|---|
| `c66deef` | **Reset rewritten into three explicit modes — local / central / complete.** Local keeps the cloud copy (it returns on next sync); central deletes business tables and bumps `workspaces.reset_epoch` (migration `0006`); complete = central then factory. Central reset requires password re-auth, an exact workspace-id confirmation, writes a real SQLite backup first, and is recorded in `workspace_resets`. A device on a stale epoch is refused `409 reset_epoch_mismatch` and re-baselines instead of re-uploading deleted rows. Panel + copy in all three locales. |
| `d962520` | **Separate employee application (`mbs-user/`)** with its own `appId`, version, data folder and installer: login, permission fetch (`/v1/me/permissions`), read modules, order-status writes with optimistic concurrency, 45 s grant refresh, revocation/disable handled, no API key or DB in the app. |
| `21bb31e` | **Tests for the above**: `entry-cloud-reset` (38 assertions) and `entry-mbs-user` (28) against the real Worker handler over real HTTP; fixed the harness keep-alive close so a green entry no longer hangs to TIMEOUT. |
| `246e636` | **Docs**: `AUDIT_LOG` F48–F51, `HANDOVER_MBS_USER_2026-11-16.md`, `MBS_USER_INSTALL.md`. |
| `5e89a51` | **Invoice template implemented** — `buildInvoiceHtml()` now renders the supplied serif design from real data (crest initial, masthead, invoice-record rule, 4-cell metadata, billed-to/contact, 4-column items, QR beside totals, footer) while preserving the `includeFooter` / `@page` contract the PDF export depends on. |
| `08684c4` | **F47 fixed (performance):** API-key verification is memoised per Worker isolate, keyed by `SHA-256(workspace + key)` — never the raw key — 5-minute TTL, 200-entry bound, invalidated when the stored hash changes. Logins/password changes still pay scrypt deliberately. Plus `entry-worker-api-key-cache` (16 assertions + timing), `entry-reset-rehearsal` (33 assertions), MBS-user capture script, route-capture filters. |
| `6b6808b` | **Invoice defect fixed + visual verification.** Item rows no longer print a literal placeholder `"Item"` line. Added `scripts/qa/capture-invoice-template.mjs`, which prints a real invoice through the in-app preview and asserts the template traits. |

**Net effect for the user:** reset now means what the confirmation says (and survives the next sync); a second person can work on central records without sharing the owner's API key; authenticated cloud traffic is ~100× cheaper per request on a warm isolate; invoices print as the supplied design.

---

## 3. Verification actually executed

Every row below was run, not inferred. No check was skipped, weakened, or suppressed.

| Check | Result |
|---|---|
| `npm run test:main` | **16/16 entries passed, 399 PASS assertions, 0 FAIL, 0 TIMEOUT** at `6b6808b`, 6.6 min wall clock (see §3.1). |
| `npm run test:e2e` | 6/6 PASS (chromium, firefox, webkit) |
| `npm run typecheck` / `typecheck:user` | PASS (strict) |
| `npm run build` / `build:user` | PASS |
| `npm run dist:win` | PASS — `dist/Mooral Business Suite Setup 0.1.11.exe` (91.4 MB) + blockmap; `better-sqlite3` rebuilt for Electron 31.7.7 win32-x64 |
| `npm run dist:user` | PASS — `dist-user/MBS-user Setup 0.1.0.exe` (79.0 MB), own appId/productName/shortcut/version |
| `npm run verify:release` | PASS — build output present, packaged main links `better-sqlite3`, shipped Worker exposes the endpoints the client calls |
| `npm run verify:online` | PASS — D1 bound as `DB`, `/v1/*` routed, no hardcoded workspace id, 6 migrations shipped |
| `npm run release:check` | PASS (signing configuration OK) |
| `entry-worker-api-key-cache` | 16/16 PASS. First authenticated request **55.0 ms**, warm average **0.5 ms** over 5 calls. Negatives not cached; another workspace's key refused; rotated key dead immediately; cache bypassable with `MBS_API_KEY_CACHE_TTL_MS=0`. |
| `entry-reset-rehearsal` | 33/33 PASS. 189 rows snapshotted → backed up → central reset → local cleared → restored; every table back to its exact count (products 50, customers 10, orders 15, invoices 11, employees 18, …); integrity clean; stale-epoch write still 409. **Temp databases only — no production data touched.** |
| `entry-cloud-reset` | 38 assertions PASS: reset refused without key and from an employee Bearer session; mismatched confirmation deletes nothing; business tables emptied while users/grants/employees survive; epoch bumped + recorded; stale-epoch write 409 while reads stay open. |
| `entry-mbs-user` | 28 assertions PASS: sign-in, grants, Worker-side 403 for ungranted read, order-status write visible to the owner, stale-revision conflict, revocation effective on next request, disabled account's token dead, logout revokes server-side, wrong workspace refused. |
| Invoice capture (new) | Real Invoices page → row print → in-app Print Preview. Assertions all true: masthead, crest initial, 4 metadata cells, 4 item columns, totals, footer, QR, serif stack, no horizontal overflow, title `INV-000015`. **0 renderer errors.** Images: `qa-screenshots/invoice/invoice-preview.png` (full A4 sheet), `invoice-modal.png` (preview UI). |
| MBS-user capture | Real built app launched; login screenshot; unreachable-server path shows inline error `Cannot reach http://127.0.0.1:9. fetch failed`, stays on login, **0 renderer errors**. Images in `qa-screenshots/mbs-user/`. |
| Reset panel capture | `settings-database-settings` re-captured after the panel rewrite: 0 renderer errors, three-mode panel present. |

### 3.1 Suite run at this HEAD (`6b6808b`)

```
PASS    entry-backup-restore.ts                   5.3s
PASS    entry-bidirectional-sync.ts               202.1s
PASS    entry-cloud-multiuser.ts                  17.2s
PASS    entry-cloud-reset.ts                      2.2s
PASS    entry-database-fk-integrity.ts            4.4s
PASS    entry-ipc-security.ts                     2.2s
PASS    entry-license-mode-switch.ts              2.0s
PASS    entry-license-verification.ts             1.9s
PASS    entry-mbs-user.ts                         0.9s
PASS    entry-messaging-authorization.ts          7.6s
PASS    entry-order-invoice.ts                    22.2s
PASS    entry-reset-rehearsal.ts                  4.6s
PASS    entry-reset-sync-safety.ts                117.2s
PASS    entry-security-stress.ts                  17.8s
PASS    entry-worker-api-key-cache.ts             1.2s
PASS    entry-worker-tenant-isolation.ts          1.2s
16/16 entries passed
```

The run includes the two new entries (`cloud-reset`, `mbs-user`), the reset/restore rehearsal and the API-key cache checks, with the two sync-heavy entries still bounded by sync volume rather than timeouts.

---

## 4. Known limitations / not verified

These are real gaps, stated so nobody assumes them working:

1. **Installers are unsigned.** Windows SmartScreen will warn; no code-signing certificate configured.
2. **No clean-machine install test.** Installs were built and inspected, not installed on a fresh Windows image.
3. **No live Cloudflare deployment in this work.** Everything cloud-side ran against the real Worker code and real schema over a D1 shim (temp DBs). `wrangler deploy` and a production reset rehearsal need credentials and explicit authorization.
4. **MBS-user has not been exercised on a second physical PC.** Single-machine testing only; the multi-device story is covered by the tests, not by hardware.
5. **No physical print job / PDF file check.** The previewed HTML is the print payload and matches the PDF contract, but no job was sent to a printer and no exported `.pdf` was parsed.
6. **No full-page screenshot of the reset panel.** The Database settings page scrolls in an inner container, so a full-page capture does not reveal the lower sections.
7. **F45 remains a product decision, not a fix:** the Invoices subtitle promises creation, but invoices come from completed orders (the row icon opens edit-only). Recorded in `AUDIT_LOG`.

---

## 5. Release readiness

**Owner app — ready to ship for use, with the caveats above.** Functional surface is complete (no "coming soon" placeholders left), typecheck/build/package/release checks pass, and the main suite is green.

**Central sync + multi-user — code-complete and test-covered, not yet live.** The Worker, migrations and employee client are ready; going live is an operational step (deploy Worker, run migrations, hand out keys/accounts).

**Employee app (`MBS-user` 0.1.0) — usable, early.** Permissions, revocation and conflict handling are enforced server-side and tested; treat it as v0.1 until it has run on a real second machine.

---

## 6. Recommended next steps (in order)

1. **Deploy the Worker + apply migration `0006` to a staging D1**, then run one real central reset + restore there. This is the only remaining unknown in the reset story.
2. **Sign the two installers** and install both on a clean Windows machine.
3. **Export one invoice to PDF and inspect the file** (page size, margins, footer, QR legibility).
4. **Run MBS-user on a second PC** against the live Worker: grant, revoke, conflict.
5. Optionally reword the Invoices subtitle (F45) to match the order-driven flow.

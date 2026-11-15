# MBS-user — architecture, installation and connection

MBS-user is the employee companion application for Mooral Business Suite (MBS). It is a
**separate Windows application with its own installer, version, data folder and identity**. It
does not contain a business database, does not store an API key, and cannot change the owner's
MBS installation.

---

## 1. Architecture

```
                    ┌──────────────────────────────┐
                    │  MBS (owner / administrator) │
                    │  Electron + SQLite           │
                    │  ─ local database            │
                    │  ─ licence + install id      │
                    │  ─ 15s bidirectional sync    │
                    └──────────────┬───────────────┘
                                   │ HTTPS, workspace API key
                                   ▼
                    ┌──────────────────────────────┐
                    │  Cloudflare Worker           │
                    │  /v1/auth/*  /v1/me/*        │
                    │  /v1/data/*  /v1/users       │
                    │  /v1/admin/permissions/sync  │
                    │  /v1/admin/reset             │
                    └──────────────┬───────────────┘
                                   │ D1 binding
                                   ▼
                    ┌──────────────────────────────┐
                    │  Cloudflare D1               │
                    │  workspace_id on every row   │
                    │  users / grants / business   │
                    └──────────────┬───────────────┘
                                   │ HTTPS, employee session token
                                   ▼
        ┌──────────────────┬──────────────────┬──────────────────┐
        │  MBS-user PC 1   │  MBS-user PC 2   │  MBS-user PC 3   │
        │  Electron only   │  Electron only   │  Electron only   │
        │  no local DB     │  no local DB     │  no local DB     │
        └──────────────────┴──────────────────┴──────────────────┘
```

**The central Worker + D1 is the source of truth.** The owner's PC does **not** act as a server
and does **not** need to be switched on for employees to work: MBS-user talks to Cloudflare, not
to the owner's machine. The owner's installation still needs to run its normal sync so that
employee accounts, permission profiles and grants are present in D1.

### What lives where

| Data | Owner PC (SQLite) | Cloud (D1) | MBS-user PC |
|---|---|---|---|
| Products, customers, orders, invoices, accounting | Yes | Yes | No local copy |
| Employee logins (username + password hash) | Yes | Yes | Never stored |
| Permission profiles / per-user grants | Yes | Yes | Fetched per session |
| Licence, installation identity, API key | Yes | API key hash only | None |
| Session token | — | Hash only | Main-process memory only |

---

## 2. Prerequisites (one-time, owner side)

1. Deploy the Worker: `npm run cloudflare:deploy`.
2. Apply **all** migrations to D1, including the new
   `0006_workspace_reset_epoch.sql`:
   ```bash
   npx wrangler d1 execute <DB_NAME> --file cloudflare/migrations/0001_mbs_core_schema.sql
   npx wrangler d1 execute <DB_NAME> --file cloudflare/migrations/0002_workspace_isolation.sql
   npx wrangler d1 execute <DB_NAME> --file cloudflare/migrations/0003_workspace_unique_constraints.sql
   npx wrangler d1 execute <DB_NAME> --file cloudflare/migrations/0004_sync_cursor_columns.sql
   npx wrangler d1 execute <DB_NAME> --file cloudflare/migrations/0005_sync_tombstones.sql
   npx wrangler d1 execute <DB_NAME> --file cloudflare/migrations/0006_workspace_reset_epoch.sql
   ```
   Applying 0006 is required for **central reset**; without it the Worker refuses the reset with
   a clear 409 instead of deleting data without the stale-device guard.
3. Keep `MBS_ADMIN_KEY` set as a Worker secret (vendor-only provisioning key).
4. In MBS: **Settings → Company / Cloud**, enable cloud sync and confirm the licence carries the
   workspace id + API key. Run one sync so users and grants reach D1.
5. In MBS: create the employee record, then **User Management → Create employee login**, assign a
   permission profile. The account must be `active`.

---

## 3. Install

### Owner

`dist/Mooral Business Suite Setup <version>.exe` — unchanged, existing installer.

### Employee

`dist-user/MBS-user Setup 0.1.0.exe`

1. Copy the installer to the employee's Windows PC (no Node, no database, no other MBS files
   needed).
2. Run it. It installs to its own directory, creates an **MBS-user** desktop/Start-menu shortcut,
   and writes only to `%APPDATA%/MBS-user` (config) — never to MBS's folders.
3. Launch **MBS-user**.

The two applications can be installed side by side, updated independently and uninstalled
independently.

---

## 4. Connect and sign in

On first launch the login screen opens with **Server settings** expanded:

| Field | Value |
|---|---|
| Server address | The deployed Worker URL, e.g. `https://mbs-cloud.<account>.workers.dev` |
| Workspace ID | The workspace id from the licence, e.g. `acme-trading` |
| Employee ID | The employee's MBS login username |
| Password | The employee's password |

After a successful sign-in the app remembers only the server address and workspace id. The
password is not stored, and the session token lives in the main process's memory — closing the
app signs out.

**Never enter the workspace API key in MBS-user.** It is not accepted and not needed: employees
authenticate as people, not as the installation.

---

## 5. What employees can do

Modules appear only when granted. The Worker enforces the same keys on every request, so hiding
a module is a convenience, not the protection.

| Module | Permission | MBS-user capability |
|---|---|---|
| Overview | `dashboard.view` | Counts of visible orders/customers/products, order value |
| Orders | `orders.view` | List, search, open details |
| Orders — change status | `orders.edit` | Pending / Pending Approval / Completed / Cancelled |
| Customers | `customers.view` | Read-only list + search |
| Products | `products.view` | Read-only list + search |
| Invoices | `invoices.view` | Read-only list |
| My profile | always | Own grants, session expiry, reset generation |

Deliberately **not** available in MBS-user, at any permission level: employee management, user
accounts, permission configuration, company settings, licence, backup/restore, factory reset,
central reset. Those are owner capabilities in MBS.

---

## 6. Multi-user behaviour

- All employees read and write the **same central rows**; there is no per-device copy to merge.
- Order updates are optimistic: MBS-user sends the `sync_revision` it last saw. If another
  employee changed the order in between, the Worker returns 409 and MBS-user shows a conflict
  message and reloads the row instead of overwriting the newer change.
- Permission changes, account disabling and password changes made by the owner take effect
  server-side immediately; MBS-user also refreshes its grant list every 45 seconds and whenever
  the user presses **Refresh access**. A revoked/disabled session is signed out on the next call.
- Changes appear in the owner's MBS on its next sync cycle (15 seconds).

---

## 7. Offline behaviour

MBS-user is honest about connectivity rather than optimistic:

- an offline banner appears, and status controls are disabled;
- no write is queued or replayed later — an order-status change either succeeds centrally or is
  reported as failed;
- reads already on screen stay visible, but navigation to an unloaded module shows the connection
  error;
- the session is kept while offline, so a brief network drop does not sign the employee out;
- a disabled account is still refused as soon as the server is reachable.

There is deliberately **no offline write queue**: silently replaying stale order/financial
changes is worse than asking the employee to retry.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Cannot reach …" | Wrong server address, Worker not deployed, or PC offline. Test `/health`. |
| "Incorrect employee ID or password" | Username is the MBS login username, not the employee number. |
| "Invalid workspace" / 401 | Workspace id does not match the licence, or the account belongs to another workspace. |
| Module missing | The owner has not granted that permission (or it was revoked). Refresh access. |
| "Order was changed by someone else" | Genuine concurrent edit; the row reloads with the current version. |
| "Account temporarily locked" | Five failed attempts; wait 15 minutes or have the owner reset the password. |
| Nothing syncs from MBS | The owner's installation must run a sync (and cloud must be enabled) before logins/grants exist centrally. |

---

## 9. Uninstall

Windows **Settings → Apps → MBS-user → Uninstall**. This removes the program and its shortcut; it
does not touch MBS, its database, the licence, or any central data.

---

## 10. Known limitations

- No password-change screen in MBS-user; the owner resets it in MBS (**User Management**).
- Employee photos are not shown (they are local binary assets in MBS, intentionally not synced).
- Updates are polling-based (45 s) rather than real-time push.
- Windows installers are unsigned, so SmartScreen will warn on first run.
- MBS-user has no offline write queue by design (see §7).

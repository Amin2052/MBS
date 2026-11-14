# Mooral Business Suite — Authentication, User Management & Security Architecture
## Implementation Status

### Current Phase
V12.5 Product & ERP Development Task List, Phases 1-10. Phases 1-8 complete
and verified; Phase 9 (Localization) ~97% complete (RTL visual verification
outstanding); Phase 10 (Final QA & Release) in progress — regression,
migration-safety, and dead-code sweeps complete; electron-builder packaging
and full manual GUI acceptance testing not performed in this environment
(no GUI rendering available).

### V12.5 Completed Phases (this development cycle)
- Session Timeout / Auto Lock: IMPLEMENTED (`src/hooks/use-idle-lock.ts`,
  `src/components/auth/lock-screen.tsx`, `security_session_timeout_minutes`
  policy field). Multi-Session Control: IMPLEMENTED (Active Sessions viewer
  + per-session revoke in Security Settings; Remember Me sessions now expire
  after 30 days instead of never). Two-Factor Authentication: EVALUATED,
  documented decision not to implement (offline single-device app; Owner
  Recovery Key serves as an equivalent second factor) — see Security
  Settings page for the in-app rationale.
- Permission catalog expanded: approve/print/pdf_export actions and an
  `inventory` module added (77 permission keys total, up from 40).
  Permission Profile management opened to Administrator (was Owner-only).
  Employee permission-profile reassignment after account creation added
  (previously creation-time-only).
- i18n: Dashboard, Products, Customers, Orders, Inventory, Accounting,
  Employees, Certificates, and all 18 Settings pages are now fully wired
  into `src/i18n/en.ts` / `bn.ts` / `ar.ts`. RTL layout is wired
  (`dir="rtl"`, `src/styles/rtl.css`) but not visually verified.
- General-purpose Audit Trail added (`audit_log` table,
  `src/repositories/audit-log-repository.ts`), covering Products,
  Customers, Orders, Inventory, Certificates, Employees, User/Permission
  changes, and Settings changes — distinct from the pre-existing
  `password_reset_audit_log`.

### Remaining Work

### Current Architecture Summary
- **Database** (`src/database/database.ts`): additive-only migrations, matching pre-existing project convention. New tables: `users`, `sessions`, `permission_profiles`, `permissions`, `user_permissions`, `profile_permissions`. New columns on `company_settings`: `business_mode`, `security_max_login_attempts`, `security_lockout_minutes`.
- **Main process** (`electron/main/auth/*`, `electron/main/data-transfer-service.ts`, `electron/main/reset-service.ts`): `auth-manager.ts` (login/logout/session/lockout), `user-manager.ts` (Administrator/Employee lifecycle), `business-mode-service.ts`, `security-policy-service.ts`, `session-storage.ts` (OS-encrypted Remember Me), `security/password.ts` (scrypt + temp password generation), `security/session-token.ts`.
- **Repositories** (`src/repositories/*`): `user-repository.ts`, `session-repository.ts`, `permission-profile-repository.ts`, extended `employee-repository.ts`.
- **Permission engine** (`src/auth/*`): `permission-catalog.ts` (single source of truth for all permission keys), `permission-engine.ts` (the only place permission checks are evaluated).
- **Renderer**: `AuthProvider`/`useAuth` (mirrors the pre-existing `LicenseProvider` pattern), `AuthGate` (Setup Wizard → Login → Forced Password Change → App), `RequireModuleAccess` (route guard), User Management page (`src/pages/settings/user-management.tsx`), Security Settings page (Business Mode + Security Policies), Database Settings page (now also Data Import/Export + ERP/Factory Reset).
- All new IPC channels follow the existing inline `ipcMain.handle` convention in `electron/main/main.ts` and are exposed through `electron/preload/preload.ts` under `window.mooral.auth` / `users` / `permissionProfiles` / `businessMode` / `securityPolicy` / `dataTransfer` / `erpControl` / `credentials`.

### Next Recommended Steps
1. Manual QA pass in a real (non-sandboxed) Electron run: First-Time Setup → Owner login → switch to Enterprise Mode → create an Administrator and an Employee → verify permission-based nav/route/button filtering for the Employee → verify Mandatory Password Change on first Employee login → exercise Backup/Restore, Data Import/Export, and (carefully, on a disposable database) ERP Reset / Factory Reset.
2. Decide whether row-level Edit/Delete gating is worth the additional surface area, or whether module-level `.view` gating is sufficient for now.
3. Wire the new UI strings into `src/i18n/*` if/when the app's other newer pages are also brought up to full localization.

---

## 2026-08-05 — Certificate PDF, Forgot Password, Credential Preview, Owner Setup Focus

Four targeted fixes/features layered on top of the architecture above. `npm run typecheck`
and `npm run build` both pass. `node_modules/` is excluded from this ZIP (not part of the
original project) -- run `npm install` to restore it.

### Task 1 -- Product Certificate PDF Improvements (Complete)
File: `src/pages/certificates-page.tsx`.
- Product certificate logo now uses the exact same markup/CSS as the Employee
  certificate's `.cert-logo` (46x46, transparent, no border) -- same rendering logic,
  reused rather than duplicated.
- Footer switched from `flex` to the Employee certificate's
  `grid-template-columns:1fr 1fr 1fr` layout: QR code bottom-center, signature
  bottom-right.
- Description moved out of `.cert-statement` into its own `.cert-description` block
  below the Product Information table, font size bumped slightly (13px -> 14.5px).
- Employee Certificate builder untouched.

### Task 2 -- Forgot Password Workflow (Complete)
- Employee -> Administrator review -> Reset Code -> Employee sets new password.
- Administrator -> Owner review -> Reset Code -> Administrator sets new password
  (an Administrator can never approve another Administrator's request; only the Owner
  can, enforced server-side in `password-reset-manager.ts`, not just hidden in the UI).
- Owner -> Recovery Key (generated once at First-Time Setup, shown via a dedicated
  `RecoveryKeyRevealScreen` before the app can be entered, rotated on every successful
  recovery). An Administrator can never reset or generate a code for the Owner account.
- Enhancements: pending-request badge (per reviewer scope), full Request History with
  Pending/Approved/Completed/Expired/Cancelled status, 15-minute reset-code expiry
  (auto-flipped to `expired` on read), one-time-use codes
  (`reset_code_used_at` + status transition), and an append-only
  `password_reset_audit_log` table with a per-request "View Audit Log" viewer.
- New: `src/repositories/password-reset-repository.ts`,
  `electron/main/auth/password-reset-manager.ts`,
  `src/components/auth/forgot-password-screen.tsx`,
  `src/components/auth/recovery-key-reveal-screen.tsx`.
- Extended: `database.ts` (`password_reset_requests`, `password_reset_audit_log`,
  `users.recovery_key_hash`), `user-repository.ts`, `security/password.ts`
  (`generateResetCode`, `generateRecoveryKey`), `auth-manager.ts`
  (`verifyOwnerRecoveryKey`, `resetOwnerPasswordWithRecoveryKey`), `main.ts` /
  `preload.ts` / `electron.d.ts` / `auth-service.ts` (new `passwordReset:*` IPC
  namespace, following the existing `auth:*` convention), `auth-provider.tsx` /
  `auth-context.ts` (`pendingRecoveryKey`), `auth-gate.tsx`, `login-screen.tsx`,
  `user-management.tsx`/`.css` (Password Reset Requests tab: Pending + History).
- Not exercised inside a live Electron window in this environment (no display) --
  verified via `tsc`, `electron-vite build`, and direct `better-sqlite3` schema/query
  sanity checks reproducing the repository's exact SQL.

### Task 3 -- Credential Preview Bug (Complete)
File: `src/pages/settings/user-management.tsx` / `.css`. `credential-print-template.ts`
(the PDF generator) was not touched, per the instructions. `CredentialsModal`'s preview
was a plain username/password summary; it now renders `buildCredentialHtml()`'s actual
output (same template, same data) in an iframe, so the preview is visually identical to
the exported/printed PDF, and there is only one source of truth for the document.

### Task 4 -- Owner Setup Input Focus (Complete)
File: `src/components/auth/auth-shared.css`. `.auth-input-row:focus-within` now sets
`border-color:var(--muted)` (neutral gray, matching the existing focus convention used
elsewhere in the app, e.g. `.form-group input:focus` in `settings-category.css`) instead
of leaving no visible focus indicator at all. No outline/box-shadow/glow. Shared by the
Owner setup wizard, Login screen, and Forced Change Password screen.

### Final UI QA Pass (Complete)
- Activation Support Contacts: `electron/main/license-v2/ipc.ts`
  `saveSupportConfig` handler now throws instead of persisting; UI
  (`license-settings.tsx`) shows read-only values, no edit/save controls.
- Amount display: `src/utils/currency.ts` `formatCurrency` supports
  `{ compact?: boolean }` (default `true`, K/M abbreviation above 1,000).
  `CurrencyContextValue.format` passes options through. Edit Invoice and
  Invoice PDF (`invoices-page.tsx`) use `formatFullAmount` /
  `formatFullPlainAmount` (full precision) exclusively; all other amount
  displays across the app inherit the new compact default automatically
  via the shared `useCurrency().format` hook.
- Profile image: `auth-service.ts` adds a `CustomEvent`-based
  `notifyProfilePhotoChanged` / `onProfilePhotoChanged` bridge.
  `profile-page.tsx` fires it after successful save/remove;
  `topbar.tsx` fetches the photo on mount (covers refresh/re-login) and
  subscribes to the event for same-session live updates. Renders
  `<img class="topbar-avatar-photo">` when a photo exists, else the
  default `UserCircle` icon. Edit (pencil) icon on the profile page's own
  avatar is now conditionally rendered only while `editing` is true.
- Profile / Change Password parity: `change-password.css` card width,
  input border-radius, label typography, and save-button colors/radius
  aligned to `profile.css` / `settings-category.css` tokens.
- Table scrollbars: Products/Inventory table bodies switched from
  hidden to visible right-aligned thin scrollbars (matching
  `--border`/`--muted`); added shared sticky-header + `.table-scroll-body`
  utility rules in `layout.css` for future use.
- Per-table sidebar experiment fully reverted (component deleted, all
  wrapper markup and CSS removed) per corrected direction; main
  application sidebar (`sidebar.tsx`/`app-layout.tsx`) is unchanged and
  remains the single source of primary navigation.
- Verified via `npm run typecheck` (clean) and `npm run build`
  (`electron-vite build`, clean) after each stage of this pass.

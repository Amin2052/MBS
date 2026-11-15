# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — V12.5 Phase 1–10: Stabilization, Settings, Currency, Reports, Permissions, Audit Trail, Security, Localization (2026-08-21)

### Fixed
- Fresh-install demo-data seeding crashed on the 11th of 15 seeded orders (wrong tuple index for `customerIndex` in `seedDemoData()`, `src/database/database.ts`).
- **Critical**: the standalone Change Password page (`src/pages/change-password-page.tsx`) never actually changed the password — it logged the current and new password to the console and did nothing else. Rewired to the real `changePassword()` auth flow.
- `formatCurrency` (`src/utils/currency.ts`) produced inconsistent output per currency (BDT/SAR fell back to ISO codes). Rewritten to use the app's own currency symbol map with Western-digit formatting.
- 12 pages hardcoded the BDT symbol instead of respecting the selected currency; rewired to `useCurrency()`.
- Reports "Print" button showed a placeholder logo/company name instead of the real company profile.
- Reports `.xlsx` export was a fake HTML-table-as-`.xls` file; replaced with a real SheetJS-generated workbook.
- Inventory stock in/out was gated on `products.edit` instead of a dedicated `inventory.edit` permission.
- Permission Profile create/edit/delete were hardcoded Owner-only, contradicting the Administrator capability spec; opened to Owner + Administrator (backend and frontend).
- License & Activation settings page was completely unstyled (referenced nonexistent CSS classes); rebuilt with the shared design system.
- 13 modals across 6 files closed on click-outside, violating the explicit "clicking outside must not close" rule; fixed.
- Remember Me sessions never expired on their own; now expire after 30 days.
- Integration API Key was stored as plaintext in the database; now encrypted at rest via Electron `safeStorage`.
- Settings audit-log entries would have re-leaked the plaintext API key into `audit_log`; redacted before logging.
- "Require Approval Before Order Confirmation" setting was stored but never used; built the real approval workflow (Pending Approval status, Approve action, `orders.approve` permission).
- Removed dead code: unused `formatAmount`/`escapeHtml` leftovers from the currency/xlsx refactors, an unused `fullSalesTrendRows` memo, and a noisy per-order `console.log`.
- Stale "Coming Soon" block advertised Date Format/Number Format as unimplemented after they were built.

### Added
- 7 previously-stub Settings pages built end-to-end: Stock, Sales & Purchase, Accounting Preferences, HR & Payroll, Notifications, Integrations, Document Templates.
- Date Format and Number Format settings, wired into `src/utils/date-format.ts` / `src/utils/format-number.ts`.
- Session Timeout / Automatic Lock (`src/hooks/use-idle-lock.ts`, `src/components/auth/lock-screen.tsx`).
- Active Sessions viewer and per-session revoke, in Security Settings.
- Two-Factor Authentication evaluated and documented (not implemented — offline single-device app, Owner Recovery Key serves as an equivalent second factor).
- Permission catalog expanded from 4 actions/10 modules to 7 actions (added approve, print, pdf_export) × 11 modules (added inventory) — 77 keys total.
- Ability to reassign an existing Employee's permission profile (previously creation-only).
- General-purpose Audit Trail: new `audit_log` table, `src/repositories/audit-log-repository.ts`, `logAudit()` helper, wired into every create/edit/delete across Products, Customers, Orders, Inventory, Certificates, Employees, User/Permission changes, and Settings. New Audit Log viewer tab (filter + CSV export) in User Management.
- Print/PDF-Export permission gating for Certificates and Reports.
- Full English/Bangla/Arabic localization for Dashboard, Products, Customers, Orders, Inventory, Accounting, Employees, Certificates, and all 18 Settings pages.

### Verified
- `npm run typecheck` and `npm run build` (electron-vite) pass clean.
- Fresh-database migration/seed verified via isolated harness.
- Existing/pre-upgrade database migration verified: all new columns/tables/permissions correctly backfilled with zero data loss.
- Backup/restore confirmed schema-agnostic (whole-file copy + full migration re-run on next open).

## [Unreleased] — Certificate PDF, Forgot Password, Credential Preview, Owner Setup Focus (2026-08-05)

### Added
- **Forgot Password Workflow**: Employee → Administrator, Administrator → Owner request/approve/reset-code flow; a separate Owner Recovery Key flow (generated at First-Time Setup, rotated on every use, never reachable by an Administrator).
- `password_reset_requests` and `password_reset_audit_log` tables; `users.recovery_key_hash` column.
- `src/repositories/password-reset-repository.ts`, `electron/main/auth/password-reset-manager.ts`.
- `src/components/auth/forgot-password-screen.tsx`, `src/components/auth/recovery-key-reveal-screen.tsx`.
- New `passwordReset:*` IPC namespace (`request`, `listPending`, `listHistory`, `auditLog`, `generateCode`, `redeem`, `verifyOwnerRecoveryKey`, `resetOwnerWithRecoveryKey`) in `main.ts` / `preload.ts` / `electron.d.ts` / `auth-service.ts`.
- Password Reset Requests tab in User Management (Pending + Request History + per-request Audit Log viewer), with a pending-count badge.
- 15-minute reset-code expiry (auto-flipped to `expired` on read) and one-time-use enforcement (`reset_code_used_at`).
- Live iframe preview in the Account Credentials modal, rendering the exact same `buildCredentialHtml()` output used for Print/Save PDF.

### Changed
- Product Certificate PDF (`certificates-page.tsx`): logo now matches the Employee Certificate's rendering (transparent, no border, 46x46); QR code moved to bottom-center and signature to bottom-right (same grid layout as the Employee Certificate); Description moved below the Product Information table with a slightly larger font.
- `.auth-input-row:focus-within` (Owner Setup / Login / Forced Change Password screens) now shows a neutral gray focus border instead of no visible indicator at all — no blue outline/ring/glow, accessibility preserved.
- `AuthProvider` / `AuthGate`: added `pendingRecoveryKey` / `acknowledgeRecoveryKey` so the Owner cannot enter the app after First-Time Setup without acknowledging their Recovery Key.

### Fixed
- Credential preview no longer under-represents the exported PDF's content — it is now visually identical, from the same template and data, with no duplicate rendering path.

## [Unreleased] — Authentication, User Management & Security Architecture (Phases 1–5)

### Phase 1 — Authentication Foundation
- Added `users`, `sessions`, `permission_profiles`, `permissions`, `user_permissions` tables and a `business_mode` column on `company_settings` (additive migrations).
- Added scrypt-based password hashing and session token generation/hashing.
- Added OS-encrypted "Remember Me" session persistence via Electron `safeStorage`.
- Added `auth-manager.ts` (Owner setup, login, logout, session restore, change password) and `business-mode-service.ts`.
- Added First-Time Setup Wizard, Login screen (with Remember Me), `AuthProvider`/`useAuth`/`AuthContext`, `AuthGate`, wired into `main.tsx` inside the existing `LicenseGate`.
- Added `src/auth/permission-catalog.ts` and `permission-engine.ts` (permission engine foundation — Owner unrestricted).
- Wired real username/status + Logout into the existing topbar profile button.

### Phase 2 — Enterprise Foundation
- Added `profile_permissions` table; seeded five system Permission Profiles (Sales, Accounts, Inventory, HR, Manager) with default grants.
- Added Administrator account creation (Owner only) and Employee login creation (Owner/Administrator), both with system-generated usernames (`EMP######` / `ADM######`) and temporary passwords.
- Added Disable / Archive / Restore user lifecycle actions.
- Replaced the "Coming Soon" User Management placeholder with a working Users + Permission Profiles UI, gated to Enterprise Mode.

### Phase 3 — Permission Engine
- Added `auth:getMyPermissions` and wired real permission resolution into `AuthProvider` for Employee accounts (Owner/Administrator remain unrestricted).
- Added navigation filtering and `RequireModuleAccess` route guarding, applied to every route.
- Added Add/Create button permission gating on Customers, Products, Orders, Employees, Certificates.
- Replaced the legacy local Admin/General-User role toggle in `accounting-page.tsx` with the real permission engine.

### Phase 4 — Credential Management
- Added a printable credential template and `credentials:exportPdf` IPC handler (Print + Save PDF).
- Added Password Reset — issues a fresh temporary password and forces a change on next login; also powers "Reprint Credentials".
- Added the Mandatory Password Change screen, shown by `AuthGate` whenever `must_change_password` is true.

### Phase 5 — Owner Control Center
- Added Business Mode management UI (Starter/Enterprise switch) — never deletes data, only toggles feature availability.
- Added configurable Security Policies (max failed login attempts, lockout duration), enforced in the login flow. Never applies to the Owner account.
- Added Data Import/Export: portable JSON export of core business tables; import is strictly additive and can never overwrite or delete existing data.
- Added ERP Reset and Factory Reset with the spec's 15-second countdown confirmation flow, Owner only, app relaunches automatically on success.
- Gated the existing Backup / Restore / Database Optimization / Integrity Check sections to Owner only.

## [Unreleased] — Invoice Polish + Application Foundation

### Invoice Module (Phase 1)
- Fixed a real bug: invoice totals, item prices, and summary cards were using
  `formatNumber()`, which abbreviates values (e.g. `1200` → `"1.2K"`). This is
  wrong for financial documents. All money values now use the new
  `formatCurrency()` formatter, which shows full precision with thousands
  separators and 2 decimals.
- Replaced the two unlabeled date inputs in the invoice filter toolbar with a
  labeled filter layout: **Search / Status / From Date / To Date**, each with
  a proper `<label>`.
- Search, status filter, and date filters now run entirely client-side via
  `useMemo` (data is fetched once on mount), matching the pattern already
  used by Orders/Customers/Products, instead of re-querying the database on
  every keystroke.
- Invoice list, modal, and detail view are now fully translated (English,
  Bangla, Arabic) via the new i18n system.
- Dates throughout the Invoice module now render through the shared,
  locale-aware `formatDate` / `formatDateShort` utility instead of a raw
  string slice.
- Print and PDF export output is now escaped against HTML injection and
  respects the active language's text direction (`dir="rtl"` for Arabic).
- General UI polish: right-aligned monetary table columns, emphasized
  invoice ID, consistent labeled form fields in the Add/Edit modal, tidier
  spacing throughout.

### Multi-language System (Phase 2)
- New `src/i18n/` module: `en.ts`, `bn.ts`, `ar.ts` dictionaries, `index.ts`
  (locale registry + metadata), `translator.ts` (dot-path lookup with
  English fallback).
- New `LanguageProvider` + `useLanguage()` hook (mirrors the existing
  `ThemeProvider` pattern): persists the selected language to
  `localStorage`, restores it on startup, and switches instantly with no
  app restart.

### RTL Support (Phase 3)
- Selecting Arabic sets `dir="rtl"` on `<html>` automatically; English and
  Bangla remain `dir="ltr"`.
- New `src/styles/rtl.css` overrides the small number of physical (non-
  logical) CSS properties that don't flip automatically under RTL
  (sidebar border side, dropdown anchoring, form text alignment). Flexbox/
  grid layouts flip natively via the browser's writing-mode handling, so
  the vast majority of the UI needed no changes.

### Language Selector (Phase 4)
- Replaced the non-functional "English" button in the Topbar with a real
  dropdown showing 🇺🇸 English / 🇧🇩 বাংলা / 🇸🇦 العربية, an active-state
  highlight, click-outside-to-close, and instant switching.

### Theme System (Phase 5)
- Extended `ThemeMode` from `light | dark` to `light | dark | system`.
- `system` mode detects the OS color scheme via
  `prefers-color-scheme` and updates live if the OS theme changes while
  the app is open.
- Added an inline script in `index.html` that applies the correct
  `data-theme` and `dir` attributes **before** React mounts, eliminating
  any flash of the wrong theme/direction on startup.
- Added a compact theme-cycle button in the Topbar (light → dark → system)
  so the new system is actually testable without waiting for the Settings
  page.

### Currency System (Phase 6)
- New `src/utils/currency.ts`: `formatCurrency()` (symbol + 2-decimal,
  thousands-separated amount) and `formatAmount()` (no symbol).
- New `CurrencyProvider` + `useCurrency()` hook, following the same
  persisted-context pattern as theme/language.
- Supported currencies: BDT (shown as `BDT`, default), USD ($), EUR (€), SAR (﷼). The taka sign is not used in the product.
- Invoice Module now uses this formatter everywhere money is displayed.
  Orders/Reports/Accounting/Dashboard can adopt the same `useCurrency()`
  hook or `formatCurrency()` utility when those modules are next touched.

### Date & Time Foundation (Phase 7)
- New `src/utils/date-format.ts`: `formatDate`, `formatDateShort`,
  `formatDateTime`, all locale-aware via `Intl.DateTimeFormat` and mapped
  to the active language (`en-US`, `bn-BD`, `ar-SA`), including native
  Bangla/Arabic numerals.

### Company Settings Foundation (Phase 8)
- New `src/types/company-settings.ts` and
  `src/constants/company-settings.ts` (defaults).
- New `src/services/company-settings-service.ts`: `getCompanySettings()`,
  `updateCompanySettings()`, `resetCompanySettings()`, backed by
  `localStorage` for now. This is data-layer infrastructure only — no
  Settings page was built, per instructions.

### Code Cleanup (Phase 9)
- Verified zero unused locals/parameters across the project (temporary
  `--noUnusedLocals --noUnusedParameters` tsc pass).
- Removed the unused `Globe` icon import from the Topbar (replaced by the
  language dropdown's flag emoji).
- Confirmed no duplicate CSS selectors were introduced in `invoices.css`.

### Fixed
- Money values on invoices no longer get abbreviated to `K`/`M` — see
  Invoice Module notes above.
- Removed a dead `search`/`status`/date-filter `useEffect` dependency chain
  that caused a database round-trip on every keystroke in the invoice
  search box.

## [Unreleased] — Final UI QA Pass

### Added
- Read-only Activation Support Contacts: main-process handler now rejects
  writes; settings UI shows plain values instead of editable inputs.
- Live profile-photo sync bridge (`notifyProfilePhotoChanged` /
  `onProfilePhotoChanged`) so the Topbar avatar updates immediately after
  save/remove, in addition to fetching on mount for refresh/re-login.
- `formatCurrency` compact-mode option (`{ compact?: boolean }`, default
  `true`): normal UI amount displays now use K/M formatting; Edit Invoice
  and Invoice PDF explicitly opt out via `{ compact: false }` /
  `formatFullAmount` to always show exact amounts.
- Visible right-side scrollbars with sticky table headers for
  Products/Inventory table bodies; shared `.table-scroll-body` /
  sticky-head utility in `layout.css`.

### Changed
- Topbar avatar renders the actual saved profile photo (falls back to the
  default icon when none exists) instead of always showing the default
  icon.
- Profile-avatar edit (pencil) icon is now hidden until Edit Profile is
  active.
- `change-password.css` tokens (card width, input radius, label size,
  button color/radius/hover) aligned to match `profile.css` /
  `settings-category.css` for full visual parity between Edit Profile and
  Change Password.

### Fixed
- Edit Invoice modal's per-line-item price/total and the "Due" summary
  box were using the compact K/M helper instead of full precision;
  switched to a new `formatFullPlainAmount` helper.
- Reverted an earlier per-table sidebar experiment (removed component,
  wrapper markup, and CSS) per corrected direction; restored original
  table markup on Products, Inventory, Employees, Orders, Accounting,
  Certificates.

## [0.1.0]

### Added

- Initial repository bootstrap
- Repository hardening
- Development tooling

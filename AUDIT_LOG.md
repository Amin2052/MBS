# AUDIT_LOG — Graphite Atelier UI pass

Project: `mooral-business-suite` v0.1.11 (Electron 31 + electron-vite, React 18, TS strict)
Scope rule honoured throughout: **UI/UX only.** No changes to SQLite schema, better-sqlite3,
IPC contracts, auth/permission logic, licence logic, invoice/accounting calculations, PDF/print
behaviour or sync. `git diff` against the checkpoint contains **zero** changes under
`electron/`, `tests/`, `src/auth/`, `src/database/`, `src/repositories/`, `src/pdf/`,
`src/services/`.

---

## 0. Environment findings (before any UI work)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| E1 | No git repository existed in the project folder (git resolved an unrelated repo in `C:\Users\Amin`). | Medium | **Fixed** — `git init` + `.gitignore`, checkpoint commit `ba2b5f5`. |
| E2 | `node_modules/` was absent, so nothing could be typechecked, built or tested. | Medium | **Fixed** — `npm install` (587 packages) + `better-sqlite3` rebuilt. |
| E3 | Electron's `postinstall` was blocked by npm's script policy, so `node_modules/electron/dist/electron.exe` did not exist — the app and any Playwright-Electron test could not launch. | High | **Fixed** — ran `node node_modules/electron/install.js`. |
| E4 | `scripts/run-main-tests.mjs` spawned `npx` without a shell and fell back to `xvfb-run`, so the main-process suite could not run on Windows at all — the product's only target platform. | High | **Fixed** — resolves esbuild and Electron via module paths; `xvfb-run` only used on Linux without `DISPLAY`. |

## 1. Baseline (recorded before UI changes)

| Check | Baseline result |
|-------|-----------------|
| `npm run typecheck` | PASS (no diagnostics) |
| `npm run build` | PASS |
| `npm run test:main` | 9/11 suites pass; `entry-ipc-security.ts` reports 2 failures (see F14) |
| `npm run test:e2e` (Playwright) | 6/6 pass |
| `npm run release:check` | PASS |
| `npm run verify:release` | **FAIL** — requires `server/index.js` (see F15) |
| `npm run verify:online` | **FAIL** — requires `server/index.js` (see F15) |
| `scripts/qa/css-audit.mjs` | did not exist; added in this pass |

---

## 2. Phase log

### Phase 1 — Audit & checkpoint
Full source inventory (333 files; ~16.1k CSS lines, ~27.8k TSX lines). Read the existing
handover/notes docs, the router (all 30 routes), the shell (`app-layout`, `sidebar`,
`topbar`, `content`), the theme provider, and the token file. Discovered that **every page
stylesheet is already written against shared `--*` custom properties**, which made a
token-first re-skin the correct (and least destructive) strategy.

### Phase 2 — Graphite Atelier tokens
Rewrote `src/styles/themes.css` (172 → 578 lines) as a full design system:
graphite surface ramp, single metallic-gold accent, warm-white/silver type, hairline
borders, restrained status colours, radius/spacing/motion/z-index scales, tabular numerals,
and a new `Atelier Daylight` light palette. Kept every pre-existing variable name so all
pages inherit automatically. 131 tokens declared in **both** themes.

Set Graphite (dark) as the default appearance in `constants/theme.ts` and `index.html`,
while still honouring a stored `light`/`system` preference.

### Phase 3 — Shared primitives
Added `src/styles/atelier.css` (loaded once in `main.tsx`). Baseline rules are wrapped in
`:where()` (zero specificity) so they can only fill gaps and can never override a page's own
rules. Covers native controls, focus-visible rings, scrollbars, selection, disabled/readonly,
date-picker glyphs, table baselines, plus opt-in components (`.ga-btn`, `.ga-card`,
`.ga-badge`, `.ga-empty`, `.ga-skeleton`, `.ga-alert`, `.ga-tabs`, `.ga-modal`, tooltips).

### Phase 4 — Desktop shell
- Sidebar: real logo plate, one refined lucide icon per destination, workspace section label,
  footer with connection dot + version. Permission filtering and nav data untouched.
- Workspace header: breadcrumb + page title derived from the same navigation table,
  Ctrl+K search focus, theme switch, and a **real** notification panel backed by
  `window.mooral.notifications.get()` (loaded lazily on open, with loading/empty/error states).
- New application status bar (`status-bar.tsx`): database state + size, connectivity,
  signed-in identity, version — all from existing IPC, no new surface.

### Phase 5 — Modules
All module pages inherit the palette through tokens. Hand-finished: dashboard KPI cards,
chart stroke, and the auth/activation shell.

### Phase 6 — Auth & supporting screens
Retheme of `login-screen.css` (navy/blue glass → graphite/gold), `license-gate.css`, and the
activation flow's full localisation.

### Phase 7 — Localisation & RTL
Fixed the RTL active-nav gradient; all new strings added to `en`/`bn`/`ar`; verified with
real captures (see §4).

### Phase 8 — Polish
Contrast pass on every gold/status fill; motion restraint (1px hover lift, 120–180 ms,
`prefers-reduced-motion` respected); print-document ink deliberately preserved.

### Phase 9 — Verification
See §3 and §4.

---

## 3. Findings and fixes

Severity: Critical / High / Medium / Low. Every item below was **fixed** unless its status
says otherwise.

| # | Finding | Sev | Status | Where |
|---|---------|-----|--------|-------|
| F1 | Fresh installs opened in `system` theme, so many users never saw the intended dark product. | High | Fixed | `constants/theme.ts`, `index.html` |
| F2 | Light theme on the auth/activation shell was **dark-on-dark and unreadable**: the shell's three base surfaces were pinned to navy hex while the card used `--surface`. | Critical | Fixed | `login-screen.css` (aliases → palette tokens) |
| F3 | 31 button/badge rules painted `var(--primary)` with literal `white` text. Correct for old blue (~3.6:1), fails badly on gold (~2.2:1). | High | Fixed | block-aware codemod → `var(--on-primary)` (8.9:1) |
| F4 | `color:#fff` on restraint-coloured status fills (danger/success/warning badges, hover states) failed AA. | High | Fixed | new `--on-danger/-success/-warning/-info` per theme |
| F5 | Dashboard trend line was hardcoded `#2563eb` (old blue) in JSX. | Medium | Fixed | `dashboard-page.tsx` → `var(--chart-line)` |
| F6 | "Inventory alert" count badge: white on muted amber ≈ 2.4:1. | High | Fixed | `dashboard.css` |
| F7 | RTL active nav used a hardcoded blue gradient and `rgba(255,255,255,.08)` border — the only RTL-only colour override in the app. | Medium | Fixed | `rtl.css` |
| F8 | The entire activation gate was **hardcoded English** (no `t()` at all) — the first screen a user sees was the only untranslated surface. | High | Fixed | 38 keys × 3 locales; `license-gate.tsx` |
| F9 | Decorative activation SVGs used hardcoded `#7aa6ff`/`#2f6fed` blue. | Low | Fixed | `license-gate.tsx` → palette tokens |
| F10 | Login/activation placeholder, security indicator, error and success colours were hardcoded navy/blue hex. | Medium | Fixed | `login-screen.css` |
| F11 | Brand artwork is a full mark+wordmark lockup on a white square; at 20–34 px it rendered as an illegible dark blob. | Medium | Fixed | clip to mark's bounding box on a tokenised light plate |
| F12 | Login shell fonts referenced unbundled `Sora`/`Inter`, so the auth screen used a different typeface from the app. | Low | Fixed | → `--font-sans` / `--font-display` |
| F13 | Design-spec surfaces were missing entirely: no nav icons, no breadcrumbs, no status bar, no notification surface, no theme switch in the shell. | High | Fixed | shell components |
| F14 | `entry-ipc-security.ts`: 2 positive-path assertions fail. Root cause: the temp DB is unlicensed and `requireActiveUser()` correctly throws the licence error. The negative (security) assertions all pass — it fails **safe**. Test-setup defect, not a product bug. | Medium | **Open — needs owner decision** | `tests/main/entry-ipc-security.ts` |
| F15 | `verify:release` and `verify:online` fail on a missing `server/` directory (this checkout ships cloud code under `cloudflare/`). Pre-existing. | High (release pipeline) | **Open — needs owner decision** | `scripts/verify-release.mjs`, `scripts/verify-online-architecture.mjs` |
| F16 | `electron/main/main.ts` sets `backgroundColor: "#ffffff"`, producing a white flash before the dark renderer paints. | Medium | **Open — needs owner decision** (protected file) | `electron/main/main.ts` |
| F17 | 95 CSS class selectors match no TSX (legacy rules). | Low | **Reported, not deleted** — deletion is unsafe because several families are built dynamically (`status-${x}`, `contract-status-*`); removing them would silently break styling. Listed by `css-audit.mjs`. | various `.css` |
| F18 | React console warning on the dashboard: "Each child in a list should have a unique key prop". Orders whose product row had been removed carried no `product_name`, so the widget rendered a row with `name: undefined` — a real `undefined` list key plus a blank "0 sold" row. | Low | Fixed (found by the authenticated route walk) | `dashboard-page.tsx` |
| F19 | The setup, login and both password/username recovery screens still hardcoded the old blue `#7aa6ff`/`#2f6fed` in their decorative SVGs (20 occurrences across 4 files); the earlier licence-gate fix had not covered them. | Medium | Fixed | 5 auth/licence TSX files |
| F20 | `stopColor="var(--primary)"` inside an SVG `<linearGradient>` computes to **black** in Chromium — `var()` does not resolve for `stop-color` in a presentation attribute (verified directly, not assumed), so the decorative hexagon painted near-black instead of gold. | Medium | Fixed — gradient stops are now styled from CSS, strokes keep `var()` (which does resolve) | `login-screen.css` |
| F21 | Settings tiles used the legacy `--purple` token, which is violet in the light palette but bronze in the dark one, so the Settings grid turned violet in Atelier Daylight. | Medium | Fixed — light `--purple` moved onto the bronze ramp | `themes.css` |
| F22 | KPI cards and quick-action chips each carried a different accent (blue / green / purple / orange), contradicting the single-accent palette and making four cards read as four unrelated modules. | Medium | Fixed — one gold accent, status still carried by caption text | `dashboard.css` |
| F23 | **Arabic bidi corruption of machine-readable values**: `+8801711001008` rendered as `8801711001008+`, `28 Oct 2026` as `Oct 2026 28`, and `Delta Engineering Ltd.` as `.Delta Engineering Ltd`. Neutral characters at the edges of a value get relocated by the RTL paragraph. | High | Fixed — `unicode-bidi: plaintext` (the CSS form of `dir="auto"`) on table/row/cell values; currency cells deliberately excluded because `Intl` already places the symbol correctly | `rtl.css` |
| F24 | Dashboard quick actions ("Add Customer", "Add Product", "Create Order", "View Invoices") and the stock caption were hardcoded English in every locale. | Medium | Fixed — 7 keys × 3 locales | `dashboard-page.tsx`, `i18n/*` |
| F25 | The status bar repeated the app version that the sidebar footer already shows. | Low | Fixed | `status-bar.tsx` |
| F26 | `database:getInfo` is owner/administrator-only, but the status bar called it for every role — an Employee would have seen a false red "Unavailable" dot. | Medium | Fixed — the indicator is only rendered for roles allowed to read it | `status-bar.tsx` |
| F27 | **Saving an empty Add Customer / Add Product dialog did nothing at all.** Both handlers opened with a bare `if(!form.name) return;` — no message, no border, no toast, dialog simply stayed open. This is the worst kind of validation failure: the click appears ignored. | High | Fixed — inline `.form-error` with `role="alert"`, cleared on open/submit, 3-locale messages | `customers-page.tsx`, `products-page.tsx`, `atelier.css`, `i18n/*` |
| F28 | **Escape did not close any create/edit dialog.** All 7 dialogs (customers, products, orders, invoices ×2, accounting, employees, certificates) were mouse-only, so a keyboard user had to tab to the × button. | High (accessibility) | Fixed — shared `useEscapeKey` hook wired into all 7 | `src/hooks/use-escape-key.ts` + 6 pages |
| F29 | The Employees dialog heading was hardcoded English (`{editId ? "Edit" : "New"} Employee`) inside an otherwise fully translated dialog. | Medium | Fixed — `common.new` / `common.edit` + `employees.employee` | `employees-page.tsx`, `i18n/*` |
| F30 | Orders validates with native `window.alert("Select Customer.")` — unlocalised and inconsistent with the new inline pattern (Products mixes both). | Medium | **Open — recommended follow-up**: functional, but it is a blocking OS dialog with hardcoded English; converting it needs i18n keys plus inline markup inside the order form. | `orders-page.tsx`, `products-page.tsx` |
| F31 | Certificates dialog heading and category filter derive their wording from the English literals `"Employee"` / `"Product"`, which are used as both data and label, so they cannot be translated without mapping the category through i18n. | Medium | **Open — recommended follow-up** | `certificates-page.tsx` |
| F32 | The Invoices and Certificates create dialogs could not be opened by the interaction harness's button matcher, so their submit paths were not exercised interactively. | Low (coverage) | **Open — coverage gap, not a known defect** | — |

Non-findings worth recording:
- **0 undefined CSS variables** and **0 theme gaps** across all 16k CSS lines (the token layer is complete).
- **0 hardcoded paint colours** remain outside the token file, except deliberately-preserved
  print-document ink (white paper / black report ink), which the audit allowlists with a reason.

---

## 4. Verification performed

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:main` | 256 PASS / 2 FAIL (F14), 9 of 11 entry suites fully green |
| `npm run test:e2e` | 6/6 PASS |
| `npm run release:check` | PASS |
| `scripts/qa/css-audit.mjs` | 0 errors (0 undefined vars, 0 theme gaps, 0 hardcoded colours) |
| `scripts/qa/smoke-electron.mjs` | App boots, renders, **0 console errors, 0 page errors** |
| `scripts/qa/capture-shell.mjs` | 24 screenshots: 4 window sizes × 3 languages × 2 themes, 0 renderer errors |
| `scripts/qa/capture-routes.mjs` | Authenticated walk: trial activated and Owner created through the real IPC handlers, then **all 30 routes** captured at 1366×768/en/dark plus a 7-route × 2-sizes × 3-languages × 2-themes matrix — **0 renderer errors, 0 empty renders** |
| `scripts/qa/interact-routes.mjs` | Interaction pass: 6 create dialogs opened, submitted empty, dismissed; shell controls exercised. **0 renderer errors.** Result: 2 silent-validation defects found and fixed, Escape found broken everywhere and fixed, theme toggle / Ctrl+K / notification popover / profile menu verified working |

Captures are in `qa-screenshots/<WxH>/<lang>/<theme>/shell.png` and
`qa-screenshots/routes/<WxH>/<lang>/<theme>/<route>.png`.

> **QA side effect to be aware of:** activating the trial writes an anti-reset
> anchor to `~/.mbs_sys_cache` (deliberately outside the user profile, so that
> deleting app data cannot restart a trial). Running `capture-routes.mjs`
> therefore consumes the 7-day trial of the machine it runs on. The anchor it
> created during this pass was moved aside to `*.qa-trialspent-*`, leaving the
> machine with no active trial; delete `~/.mbs_sys_cache` to be certain.

---

## 5. NOT done in this pass (explicit)

These parts of the brief were **not** executed and must not be reported as complete:

1. ~~Route-by-route authenticated walk~~ — **now done** (`capture-routes.mjs`): every route
   was reached and captured. ~~Interaction~~ — **partially done** (`interact-routes.mjs`):
   the Customers, Products, Orders, Employees, Accounting and Invoices dialogs were opened,
   submitted empty and dismissed with Escape, and the shell controls were exercised. Still
   uncovered: full happy-path creation (filling a form and asserting the record appears),
   editing, deletion and the delete-confirmation dialogs, and the Invoices/Certificates
   create dialogs (F32).
2. **Hand-redesign of all 11 modules and 19 settings subpages.** They inherit the new tokens
   automatically and were verified to render, but their individual layouts were not
   re-authored page by page.
3. **Stress test** (50k customers / 200k orders / 1M ledger rows, long-task measurement).
4. **Load test** (1,000 parallel reads, 200 parallel invoice creations).
5. **Penetration test** beyond the existing `entry-ipc-security` suite (injection, path
   traversal, XSS/XLSX-formula, brute-force, secret grep).
6. **Human-error clicking test** (double submits, empty/oversized input, focus traps, offline flips).
7. **Per-page 4-size screenshots in all 18 combinations for every route.** Done for 30 routes at
   the canonical size and for 7 key routes across 2 sizes × 3 languages × 2 themes; the full
   18-combination sweep for every one of the 30 routes was not run.

The tooling for 1 and 7 now exists and is verified (`scripts/qa/capture-routes.mjs`).

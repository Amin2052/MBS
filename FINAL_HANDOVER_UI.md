# FINAL_HANDOVER_UI.md — Graphite Atelier

**Product:** Mooral Business Suite 0.1.11 — Windows desktop ERP (Electron + React + SQLite)
**Change type:** UI / UX only. No business logic, schema, IPC contract, auth, licence,
accounting, PDF or sync behaviour was modified.
**Checkpoint:** `ba2b5f5 — checkpoint: before Graphite Atelier`
**Baseline failures:** see *Known issues* — two pre-existing pipeline defects and one
pre-existing test-setup defect are documented, not hidden.

---

## 1. What was built

**Graphite Atelier** is a premium dark desktop design language:

| Role | Value |
|------|-------|
| Workspace background | `#12151a` deep graphite |
| Sidebar | `#0d1013` near-black graphite |
| Cards | `#191d23` / `#1f242b` layered charcoal |
| Accent (primary) | `#c9a24a` metallic gold |
| Secondary accent | `#a8804f` muted bronze |
| Primary text | `#ece7dd` warm white |
| Secondary text | `#9aa1a9` muted silver |
| Borders | `#2a2f37` hairline graphite |
| Status | restrained green / amber / red |

No neon, no glow, no multi-stop gradients, no website patterns. Depth comes from layered
surfaces plus hairline borders; motion is 120–180 ms ease-out with a 1 px hover lift and
respects `prefers-reduced-motion`.

**Light mode ("Atelier Daylight")** is a first-class warm ivory/bronze palette, not an
inversion — every foreground/background pair clears WCAG AA for body text.

### Architecture: why this re-skins every page at once

Every existing page stylesheet (~16 k lines) was already written against shared CSS custom
properties (`--background`, `--surface`, `--border`, `--primary`, `--sidebar*`, `--foreground`,
`--muted`, …). Re-authoring those tokens therefore re-skins all 30 routes and 19 settings
pages without rewriting page CSS. On top of that, a zero-specificity primitive layer
(`atelier.css`, all baseline rules in `:where()`) fills in controls that were previously
unstyled, and cannot override a page's own rules.

New tokens include `--on-primary`, `--on-danger/-success/-warning/-info`,
`--brand-plate`, `--overlay`, `--focus-ring`, `--scrollbar-*`, `--table-*`, `--chart-*`,
`--titlebar/--statusbar`, type scale, spacing, radius, motion and z-index scales.

---

## 2. Modified / added files

**Design system**
- `src/styles/themes.css` — rewritten token system, 131 tokens declared in **both** themes
- `src/styles/atelier.css` — **new** shared primitive + component layer
- `src/styles/layout.css` — desktop shell (sidebar / workspace / status bar / breakpoints)
- `src/styles/rtl.css` — removed hardcoded blue RTL gradient
- `src/main.tsx` — loads `atelier.css`
- `src/constants/theme.ts`, `index.html` — Graphite dark is the default appearance

**Shell**
- `src/components/layout/sidebar.tsx` — logo plate, per-destination icons, section label, footer
- `src/components/layout/topbar.tsx` — breadcrumb + page title, Ctrl+K search, theme switch,
  notification panel (real IPC), keyboard/Escape handling
- `src/components/layout/topbar.css` — rewritten header controls
- `src/components/layout/status-bar.tsx` — **new** DB / connectivity / identity / version bar
- `src/layouts/app-layout.tsx` — mounts the status bar

**Auth & licence**
- `src/components/auth/login-screen.css` — rethemed (was navy/blue glass), theme-aware
- `src/components/license/license-gate.css` — rethemed, all navy/blue literals tokenised
- `src/components/license/license-gate.tsx` — fully localised (was hardcoded English)

**Pages (palette inheritance + targeted fixes)**
- `dashboard.css` / `dashboard-page.tsx` — KPI refinement, theme-aware chart stroke
- `messages-card.css`, `print-preview.css`, `change-password.css`, `profile.css`,
  `settings/settings-category.css`, `settings/user-management.css`, `accounting.css`,
  `certificates.css`, `customers.css`, `employees.css`, `inventory.css`, `invoices.css`,
  `orders.css`, `product-details.css`, `products.css`, `reports.css`, `action-buttons.css`
  — hardcoded colours replaced with tokens; contrast fixes on primary/status fills

**Localisation**
- `src/i18n/en.ts`, `bn.ts`, `ar.ts` — new `shell` and `licenseGate` namespaces (+38 keys each)

**Tooling**
- `scripts/qa/css-audit.mjs` — **new** undefined-variable / theme-gap / hardcoded-colour / dead-selector audit
- `scripts/qa/codemod-on-primary.mjs` — **new** block-aware contrast codemod (idempotent, reviewable)
- `scripts/qa/smoke-electron.mjs` — **new** real-app render smoke test
- `scripts/qa/capture-shell.mjs` — **new** size × language × theme screenshot matrix
- `scripts/qa/capture-routes.mjs` — **new** authenticated walk: trial + Owner setup via IPC, then
  every route captured (see §3)
- `scripts/qa/vite.qa.config.mjs` — **new** QA-only renderer server (unpackaged Electron loads :5173)
- `scripts/run-main-tests.mjs` — cross-platform fix (see Known issues)
- `.gitignore` — new

---

## 3. Page checklist (honest status)

| Surface | New shell/chrome | Token-inherited palette | Hand-redesigned layout |
|---------|:---:|:---:|:---:|
| Dashboard | ✓ | ✓ | ✓ KPI cards, chart |
| Customers | ✓ | ✓ | — |
| Products / Product details | ✓ | ✓ | — |
| Inventory | ✓ | ✓ | — |
| Orders | ✓ | ✓ | — |
| Invoices | ✓ | ✓ | — |
| Accounting (+ ledger/journal/summary) | ✓ | ✓ | — |
| Reports | ✓ | ✓ | — |
| Employees | ✓ | ✓ | — |
| Certificates | ✓ | ✓ | — |
| Settings hub + 19 subpages | ✓ | ✓ | — |
| Login | — | ✓ | ✓ |
| Licence activation | — | ✓ | ✓ (incl. full bn/ar) |
| First-time setup, lock, recovery, forced password change | — | ✓ | — |
| Profile, change password | ✓ | ✓ | — |
| Error boundary | — | ✓ | — |

"Token-inherited" means the page picks up Graphite Atelier automatically and was checked for
hardcoded colours; it was **not** individually re-composed. See *Not done*.

Every route above was **reached and captured** with the real app, real database and real IPC
(`scripts/qa/capture-routes.mjs`): the script activates the trial and creates an Owner account
through the app's own handlers, then walks the router. Zero renderer errors across all 30.
Captures: `qa-screenshots/routes/1366x768/en/dark/<route>.png`, plus a 7-route matrix across
2 window sizes × English/Bangla/Arabic × dark/light.

---

## 4. Preserved functionality

- SQLite schema, better-sqlite3, repositories, migrations — untouched
- IPC contracts and every main-process handler — untouched (0 diff under `electron/`)
- Authentication, permissions, tenancy, licence verification — untouched
- Invoice/order/accounting calculations and numbering — untouched
- PDF generation, print templates, print preview behaviour — untouched
- Cloud sync (Cloudflare worker/portal) — untouched
- Bangla / English / Arabic + RTL — preserved **and extended** (activation gate now localised)
- Print documents keep black ink on white paper by design (allowlisted in the CSS audit)
- No mock data introduced; the notification panel and status bar read real IPC data only

---

## 5. Test results

| Check | Baseline | Final |
|-------|----------|-------|
| `npm run typecheck` | PASS | **PASS** |
| `npm run build` | PASS | **PASS** |
| `npm run test:main` | 9/11 suites green; 2 IPC assertions fail | **9/11 suites green; 256 PASS, 2 FAIL (same pre-existing)** |
| `npm run test:e2e` | 6/6 | **6/6 PASS** |
| `npm run release:check` | PASS | **PASS** |
| `npm run verify:release` | FAIL (missing `server/`) | **FAIL — pre-existing, not caused by this pass** |
| `npm run verify:online` | FAIL (missing `server/`) | **FAIL — pre-existing** |
| CSS audit | n/a | **0 errors** (0 undefined vars, 0 theme gaps, 0 hardcoded colours) |
| Electron render smoke | n/a | **0 console errors, 0 page errors** |
| Visual matrix (shell) | n/a | **24 captures**, 0 renderer errors |
| Visual matrix (routes) | n/a | **116 captures**, 30 routes + 7-route RTL/size sweep, **0 renderer errors, 0 empty renders** |

No regression was introduced: the two failing IPC assertions and the two failing verify
scripts failed identically before any UI change (they do not touch renderer code).

### Screenshots
`qa-screenshots/{1920x1080,1600x900,1366x768,1280x720}/{en,bn,ar}/{dark,light}/shell.png`
plus `qa-screenshots/smoke/first-screen.png`.

Verified visually on the authenticated screens: correct layout at all sizes with no overflow;
Bangla conjuncts render cleanly at 1280×720 and the dashboard is fully translated; Arabic
mirrors correctly (rail side, card order, toolbar alignment) and machine-readable values keep
their own direction (`+8801711001008`, `28 Oct 2026`, `Delta Engineering Ltd.`); light mode
fully legible on every page checked.

---

## 6. Known issues

**Needs owner decision (not fixed — outside UI scope or pre-existing):**

1. **`entry-ipc-security.ts` — 2 failing assertions (Medium).**
   Repro: `npm run test:main`.
   Cause: the temp DB has no licence, so `requireActiveUser()` throws the "not licensed"
   error for the two *positive* assertions. Every negative/security assertion passes, so the
   product fails safe. Fix belongs in the test setup (activate a licence before asserting
   success), not in auth code.

2. **`verify:release` / `verify:online` fail (High for release pipeline).**
   Both scripts require `server/index.js`; this checkout ships cloud code under `cloudflare/`.
   Either the scripts or the deployment layout is out of sync.

3. **White flash at startup (Medium).**
   `electron/main/main.ts` hardcodes `backgroundColor: "#ffffff"`. On the dark default the
   window flashes white before first paint. One-line fix, but it is in a protected file, so it
   is reported rather than changed.

4. **`server/` absence and `npm audit`**: dependency audit was not run in this pass.

**Low / accepted:**

5. 95 CSS class selectors match no TSX. Not deleted: several families are constructed
   dynamically (`status-${x}`, `contract-status-*`), so bulk deletion is unsafe. The list is
   produced by `scripts/qa/css-audit.mjs`.
6. The brand plate shows a hairline of the wordmark at its lower edge; the supplied artwork's
   mark and wordmark nearly touch, so perfect isolation would require a new asset.
7. Legacy `.topbar-actions` / `.topbar-btn` rules are retained (styled) because
   `components-layout-topbar.tsx` is an unused duplicate header; deleting it was out of scope.

---

## 7. Not done in this pass

Stated plainly so nothing is over-claimed:

- Interaction coverage on the authenticated pages: modals, create/edit wizards, validation
  messages and empty/error states were rendered but not clicked through end to end.
- Hand-redesign of each of the 11 modules and 19 settings subpages (they inherit the design
  system and were verified to render, but their layouts were not re-composed).
- A full 18-combination size/language/theme sweep for every one of the 30 routes (done for 7
  key routes; all 30 were captured at the canonical 1366×768/en/dark).
- Stress test with large datasets, load test of IPC, penetration test beyond the existing IPC
  suite, and the human-error clicking test described in Part 3.3–3.6.

---

## 8. How to run

```bash
npm install          # rebuilds better-sqlite3 for Electron
npm run dev          # development (Vite + Electron)
npm run build        # production bundle into out/
npm run dist:win     # Windows NSIS installer into dist/
```

Verification and QA tooling:

```bash
npm run typecheck
npm run build
npm run test:main        # main-process suite (now works on Windows)
npm run test:e2e
node scripts/qa/css-audit.mjs
node scripts/qa/smoke-electron.mjs
node scripts/qa/capture-shell.mjs  [--sizes=1366x768,1280x720]
node scripts/qa/capture-routes.mjs [--full-only | --matrix-only] [--sizes=1366x768]
```

> `capture-routes.mjs` activates the 7-day trial to reach the workspace, and the trial's
> anti-reset anchor is written to `~/.mbs_sys_cache` (outside the profile by design). It prints
> a warning when that happens — run it on a disposable machine or remove that directory after.

> `smoke-electron.mjs` and `capture-shell.mjs` need a renderer server on :5173 because an
> unpackaged Electron run loads the dev URL. Start one first:
> `npx vite --config scripts/qa/vite.qa.config.mjs`
> Both scripts use a disposable `--user-data-dir`, so real profiles, databases and licence
> files are never touched.

Theme switching still works exactly as before (`light` / `dark` / `system`), and Graphite
dark is now the default for fresh installs.

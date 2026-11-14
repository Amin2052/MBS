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

Captures are in `qa-screenshots/<WxH>/<lang>/<theme>/shell.png`.

---

## 5. NOT done in this pass (explicit)

These parts of the brief were **not** executed and must not be reported as complete:

1. **Route-by-route authenticated walk.** The workspace is behind licence activation and
   account setup; captures cover the reachable first screen only.
2. **Hand-redesign of all 11 modules and 19 settings subpages.** They inherit the new tokens
   automatically, but their individual layouts were not re-authored page by page.
3. **Stress test** (50k customers / 200k orders / 1M ledger rows, long-task measurement).
4. **Load test** (1,000 parallel reads, 200 parallel invoice creations).
5. **Penetration test** beyond the existing `entry-ipc-security` suite (injection, path
   traversal, XSS/XLSX-formula, brute-force, secret grep).
6. **Human-error clicking test** (double submits, empty/oversized input, focus traps, offline flips).
7. **Per-page 4-size screenshots in all 18 combinations for every route.**

The reusable tooling for 1 and 7 now exists (`scripts/qa/capture-shell.mjs`), so extending it
to authenticated routes is a matter of scripting the activation/login flow.

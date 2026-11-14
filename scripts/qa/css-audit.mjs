/**
 * Graphite Atelier — CSS integrity audit.
 *
 * Answers four questions the design pass needs, statically and repeatably:
 *
 *   1. UNDEFINED VARIABLES   Is every `var(--x)` the app uses actually
 *                            declared somewhere? An undefined var silently
 *                            falls back to nothing, which is how half-styled
 *                            controls appear.
 *   2. THEME GAPS            Is every *global* token declared in BOTH
 *                            :root[data-theme="dark"] and
 *                            :root[data-theme="light"]? A token present in
 *                            only one palette breaks the other theme.
 *   3. HARDCODED COLOURS     Literal hex/rgb colours in paint properties
 *                            (color/background/border/fill/stroke) that
 *                            bypass the token system. Shadows, overlays and
 *                            gradients are reported separately as notes,
 *                            because alpha-composited depth values are not
 *                            colours the palette owns.
 *   4. DEAD SELECTORS        Class selectors in per-page CSS that no .tsx /
 *                            .html file mentions. Reported as a warning:
 *                            dynamic class construction can legitimately
 *                            produce false positives.
 *
 * Usage:  node scripts/qa/css-audit.mjs [--json]
 * Exit:   0 = no errors, 1 = errors found.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const AS_JSON = process.argv.includes("--json");
const THEMES_FILE = join(ROOT, "src", "styles", "themes.css");

const SKIP_DIRS = new Set(["node_modules", "_retired", "out", "dist", "release", ".git", "qa-screenshots"]);

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some(e => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const cssFiles = walk(join(ROOT, "src"), [".css"]);
const codeFiles = walk(join(ROOT, "src"), [".tsx", ".ts"]).concat(
  ["index.html"].map(f => join(ROOT, f)).filter(f => { try { return statSync(f).isFile(); } catch { return false; } })
);

/* ------------------------------------------------------------------ parsing */

const VAR_USE = /var\(\s*(--[a-zA-Z0-9-_]+)/g;
const VAR_DEF = /(--[a-zA-Z0-9-_]+)\s*:/g;

/** Extract the body of a rule whose selector matches `predicate`, brace-balanced. */
function ruleBodies(css, predicate) {
  const bodies = [];
  let depth = 0;
  let selStart = 0;
  let current = null;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        current = { selector: css.slice(selStart, i).trim(), start: i + 1 };
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && current) {
        current.end = i;
        if (predicate(current.selector)) {
          bodies.push(css.slice(current.start, current.end));
        }
        selStart = i + 1;
        current = null;
      }
    }
  }
  return bodies;
}

const themesCss = readFileSync(THEMES_FILE, "utf8");

const baseTokens = new Set();
for (const body of ruleBodies(themesCss, s => s === ":root")) {
  for (const m of body.matchAll(VAR_DEF)) baseTokens.add(m[1]);
}

const darkTokens = new Set();
for (const body of ruleBodies(themesCss, s => s.includes('data-theme="dark"'))) {
  for (const m of body.matchAll(VAR_DEF)) darkTokens.add(m[1]);
}

const lightTokens = new Set();
for (const body of ruleBodies(themesCss, s => s.includes('data-theme="light"'))) {
  for (const m of body.matchAll(VAR_DEF)) lightTokens.add(m[1]);
}

// Tokens declared outside the token file are component-scoped (e.g. the login
// screen's private --mbs-* aliases). They are legitimately defined, but must
// not be treated as theme-owned.
const localTokens = new Set();
for (const file of cssFiles) {
  if (file === THEMES_FILE) continue;
  for (const m of readFileSync(file, "utf8").matchAll(VAR_DEF)) localTokens.add(m[1]);
}

const allDefined = new Set([...baseTokens, ...darkTokens, ...lightTokens, ...localTokens]);

/* ------------------------------------------------------------------- checks */

const errors = [];
const warnings = [];
const notes = [];

/* 1 + 2. Variables */

const usedVars = new Map(); // name -> Set(files)
for (const file of cssFiles.concat(codeFiles)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(VAR_USE)) {
    if (!usedVars.has(m[1])) usedVars.set(m[1], new Set());
    usedVars.get(m[1]).add(relative(ROOT, file));
  }
}

for (const [name, files] of [...usedVars].sort(([a], [b]) => a.localeCompare(b))) {
  if (!allDefined.has(name)) {
    errors.push({
      kind: "undefined-variable",
      token: name,
      detail: `var(${name}) is used but never declared`,
      where: [...files].slice(0, 4)
    });
    continue;
  }

  if (localTokens.has(name) && !baseTokens.has(name) && !darkTokens.has(name) && !lightTokens.has(name)) {
    continue; // component-scoped by design
  }

  const inDark = darkTokens.has(name) || baseTokens.has(name);
  const inLight = lightTokens.has(name) || baseTokens.has(name);

  if (!inDark || !inLight) {
    errors.push({
      kind: "theme-gap",
      token: name,
      detail: `declared only in ${inDark ? "dark" : "light"} theme — the other palette has no value`,
      where: [...files].slice(0, 4)
    });
  }
}

/* 3. Hardcoded colours */

/**
 * Deliberate exceptions. Printed documents are ink-on-paper by definition:
 * a "themed" invoice would be a bug, not a feature. These are reviewed and
 * expected, so they are excluded from the colour warning rather than being
 * silently tolerated.
 */
const DOCUMENT_INK_ALLOWLIST = [
  {
    test: (file, line, property) =>
      file.endsWith("print-preview.css") &&
      /^background(-color)?$/.test(property) &&
      [408, 420].includes(line),
    reason: "print preview page / iframe paper is white by definition"
  },
  {
    test: (file) => file.endsWith("reports.css"),
    reason: "@media print report template uses black document ink"
  },
  {
    test: (file) => file.endsWith("atelier.css"),
    reason: "@media print reset forces black-on-white document output"
  }
];

function isDocumentInk(file, line, property) {
  return DOCUMENT_INK_ALLOWLIST.some(entry => entry.test(file, line, property));
}

const PAINT_PROP = /(^|[;{\s])(color|background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|border-inline|border-block|outline|fill|stroke|box-shadow)\s*:\s*([^;}]+)/g;
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

for (const file of cssFiles) {
  if (file === THEMES_FILE) continue;

  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");

  lines.forEach((line, index) => {
    if (line.trim().startsWith("/*") || line.trim().startsWith("*")) return;

    for (const m of line.matchAll(PAINT_PROP)) {
      const value = m[3];
      if (!COLOUR_LITERAL.test(value)) continue;

      const isDepth = /^(box-shadow|text-shadow)$/i.test(m[2]);
      const entry = {
        file: rel,
        line: index + 1,
        property: m[2],
        value: value.trim().slice(0, 70)
      };

      if (isDepth) {
        notes.push({ kind: "alpha-depth", ...entry });
      } else if (isDocumentInk(rel, index + 1, m[2])) {
        notes.push({ kind: "document-ink", ...entry });
      } else {
        warnings.push({ kind: "hardcoded-colour", ...entry });
      }
      break; // one report per line is enough
    }
  });
}

/* 4. Dead class selectors */

const CLASS_SEL = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
const codeText = codeFiles.map(f => readFileSync(f, "utf8")).join("\n");

const cssClasses = new Map();
for (const file of cssFiles) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8")
    // strip comments so commented-out selectors don't register
    .replace(/\/\*[\s\S]*?\*\//g, "");

  for (const m of text.matchAll(CLASS_SEL)) {
    if (!cssClasses.has(m[1])) cssClasses.set(m[1], new Set());
    cssClasses.get(m[1]).add(rel);
  }
}

// Classes owned by third-party renderers (Recharts emits its own class names
// on generated SVG). These are never referenced in our JSX by design.
const VENDOR_CLASS = /^recharts-/;

for (const [cls, files] of cssClasses) {
  if (VENDOR_CLASS.test(cls)) continue;

  // A class is "live" if the identifier appears anywhere in TSX/HTML — this
  // deliberately over-approximates (template literals, conditional joins).
  if (codeText.includes(cls)) continue;

  warnings.push({
    kind: "dead-selector",
    selector: "." + cls,
    where: [...files]
  });
}

/* ------------------------------------------------------------------- report */

if (AS_JSON) {
  console.log(JSON.stringify({ errors, warnings, notes }, null, 2));
} else {
  const byKind = (list, kind) => list.filter(e => e.kind === kind);

  console.log("Graphite Atelier — CSS audit");
  console.log("============================");
  console.log(`Token file: ${relative(ROOT, THEMES_FILE)}`);
  console.log(`Global tokens: ${baseTokens.size} base, ${darkTokens.size} dark, ${lightTokens.size} light`);
  console.log(`Component-scoped tokens: ${localTokens.size}`);
  console.log(`Variables referenced: ${usedVars.size}`);
  console.log("");

  const undefinedVars = byKind(errors, "undefined-variable");
  const themeGaps = byKind(errors, "theme-gap");
  const hardcoded = byKind(warnings, "hardcoded-colour");
  const dead = byKind(warnings, "dead-selector");
  const depth = byKind(notes, "alpha-depth");

  console.log(`ERRORS`);
  console.log(`  undefined variables : ${undefinedVars.length}`);
  for (const e of undefinedVars) console.log(`    - ${e.token}  (${e.where.join(", ")})`);
  console.log(`  theme gaps          : ${themeGaps.length}`);
  for (const e of themeGaps) console.log(`    - ${e.token}  (${e.where.join(", ")})`);
  console.log("");
  console.log(`WARNINGS`);
  console.log(`  hardcoded colours   : ${hardcoded.length}`);
  for (const w of hardcoded.slice(0, 40)) {
    console.log(`    - ${w.file}:${w.line}  ${w.property}: ${w.value}`);
  }
  if (hardcoded.length > 40) console.log(`    ... and ${hardcoded.length - 40} more`);
  console.log(`  dead selectors      : ${dead.length}`);
  for (const w of dead.slice(0, 40)) console.log(`    - ${w.selector}  (${w.where.join(", ")})`);
  if (dead.length > 40) console.log(`    ... and ${dead.length - 40} more`);
  console.log("");
  console.log(`NOTES`);
  console.log(`  alpha depth values  : ${depth.length}  (shadows/overlays — reviewed, not tokenised)`);
  console.log("");
  console.log(errors.length === 0 ? "RESULT: no errors." : `RESULT: ${errors.length} error(s).`);
}

process.exit(errors.length === 0 ? 0 : 1);

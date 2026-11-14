/**
 * One-shot, reviewable codemod — Graphite Atelier contrast pass.
 *
 * WHY: `--primary` is now a metallic gold (#c9a24a, ~7.4:1 against graphite).
 * Any rule that painted `var(--primary)` behind white text was relying on the
 * old blue (#3b82f6), where white-on-fill was ~3.6:1. On gold, white text is
 * ~2.2:1 and fails WCAG AA badly. The design system answers this with
 * `--on-primary` (graphite lettering for gold fills, 8.9:1).
 *
 * SCOPE: deliberately narrow. It only rewrites a `color: ...` declaration
 * inside the SAME rule block that paints `background: var(--primary)` (solid
 * fill only — not `--primary-dark`, not gradients, not `--primary-soft`
 * tints which keep normal foreground text). Blocks are matched by brace
 * balancing, not by regex across the whole file, so a colour in a sibling
 * rule can never be touched.
 *
 * Idempotent: a block already using var(--on-primary) is left alone.
 *
 * Usage: node scripts/qa/codemod-on-primary.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "_retired" || entry === "out" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

/** Split a stylesheet into { selector, body, start, end } blocks, recursively. */
function blocks(css) {
  const result = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = -1;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];

    if (ch === "{") {
      if (depth === 0) {
        bodyStart = i + 1;
        result.push({
          selector: css.slice(selectorStart, i).trim(),
          start: bodyStart,
          end: -1
        });
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const current = result[result.length - 1];
        if (current && current.end === -1) current.end = i;
        selectorStart = i + 1;
      }
    }
  }

  return result.filter(b => b.end > b.start).map(b => ({
    ...b,
    body: css.slice(b.start, b.end)
  }));
}

const FILL = /background(?:-color)?\s*:\s*var\(--primary\)\s*(?:;|!important;)/;
const WHITE_TEXT = /color\s*:\s*(?:#fff(?:fff)?|white)\s*(;|!important;)/;

let changedFiles = 0;
let changedBlocks = 0;

for (const file of walk(join(ROOT, "src"))) {
  const css = readFileSync(file, "utf8");
  const found = blocks(css);

  // Rewrite from the end so earlier offsets stay valid.
  const edits = [];
  for (const block of found) {
    if (!FILL.test(block.body)) continue;
    if (!WHITE_TEXT.test(block.body)) continue;
    if (block.body.includes("var(--on-primary)")) continue;

    edits.push({
      pos: block.start + block.body.search(WHITE_TEXT),
      length: block.body.match(WHITE_TEXT)[0].length
    });
  }

  if (!edits.length) continue;

  let next = css;
  for (const edit of edits.reverse()) {
    next =
      next.slice(0, edit.pos) +
      "color: var(--on-primary);" +
      next.slice(edit.pos + edit.length);
  }

  changedFiles++;
  changedBlocks += edits.length;

  if (!DRY) writeFileSync(file, next, "utf8");
  console.log(`${DRY ? "[dry] " : ""}${file.replace(ROOT, "")}: ${edits.length} block(s)`);
}

console.log(
  `\n${DRY ? "Would rewrite" : "Rewrote"} ${changedBlocks} rule block(s) across ${changedFiles} file(s).`
);

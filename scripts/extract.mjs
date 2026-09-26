import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

// Upstream ships a bundle, not sources, so this is how the port was bootstrapped.
// It is a one-time tool: src/ has been adapted since and the script refuses to
// overwrite adapted modules without --force. Point it at an extracted
// cursor-smith/main.js from a vault to re-run the extraction.
const SRC = process.env.CURSOR_SMITH_BUNDLE || process.argv[2];
if (!SRC) {
  console.error(
    "usage: node scripts/extract.mjs <path-to/cursor-smith/main.js> [--force]\n" +
      "or set CURSOR_SMITH_BUNDLE. See CREDITS.md - this is a one-time bootstrap tool."
  );
  process.exit(1);
}
const OUT = resolve(process.argv[2] ?? "src");
const FORCE = process.argv.includes("--force");
const lines = readFileSync(SRC, "utf8").split("\n");

const at = (n) => lines[n - 1];

// [outPath, fromLine, toLine] inclusive, 1-indexed.
const SEGMENTS = [
  ["constants.js", 31, 161],
  ["motion.js", 163, 241],
  ["settings.js", 243, 888],
  ["presets.js", 890, 1482],
  ["share.js", 1487, 1588],
  ["color.js", 1590, 1804],
  ["demo.js", 1806, 2123],
  ["measure.js", 3632, 4588],
  ["fire.js", 4590, 4685],
  ["effects/fire.js", 4687, 5261],
  ["effects/pops.js", 5263, 5908],
  ["effects/dust.js", 5910, 6232],
  ["effects/trail.js", 6234, 6395],
  ["effects/index.js", 6397, 6403],
  ["paint/color.js", 6405, 6630],
  ["paint/blink.js", 6633, 6704],
  ["paint/shape.js", 6706, 7121],
  ["paint/energy.js", 7123, 7306],
  ["text.js", 7308, 7350],
  ["paint/tether.js", 7351, 7804],
  ["paint/secondaries.js", 7807, 7914],
  ["paint/smear.js", 7916, 8212],
  ["paint/frame.js", 8214, 8359],
  ["paint/index.js", 8361, 8370],
  ["torch/paint.js", 8373, 8429],
  ["torch/index.js", 8431, 8831],
  ["library.js", 8834, 8951],
  ["vim.js", 8954, 9301],
  ["geometry.js", 9306, 9353],
  ["engine.js", 9355, 10423],
  ["carets.js", 10425, 10877],
  ["core.js", 10879, 11590],
];

const bodies = new Map();
for (const [out, from, to] of SEGMENTS) {
  const body = lines
    .slice(from - 1, to)
    .join("\n")
    .replace(/^var import_obsidian\d+ = require\("obsidian"\);\n?/m, "")
    .replace(/^var import_obsidian\d+ = require\("obsidian"\);\n?/m, "")
    .trim();
  bodies.set(out, body);
}

// The segments above are hand-kept line ranges into a 11,593-line bundle, so an
// off-by-one silently truncates a module rather than failing. Parse each body
// before anything is written: a range that cuts a declaration in half has to be
// an error here, not a mystery blank page later.
import ts from "typescript";
const truncated = [];
for (const [out, body] of bodies) {
  const sf = ts.createSourceFile(out, body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const d of sf.parseDiagnostics) {
    const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    truncated.push(`${out} (bundle lines ${SEGMENTS.find((s2) => s2[0] === out).slice(1).join("-")}, body line ${line + 1}): ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
}
if (truncated.length) {
  console.error("segment ranges do not produce valid modules:\n  " + truncated.join("\n  "));
  process.exit(1);
}

// Collect top-level declarations per module so we can build the import graph.
const declRe = /^(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/gm;
const exported = new Map(); // name -> outPath
for (const [out, body] of bodies) {
  for (const m of body.matchAll(declRe)) {
    const name = m[1];
    if (!exported.has(name)) exported.set(name, out);
  }
}

const HEADER =
  "// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.\n" +
  "// Engine logic reused under the terms of the upstream project; see CREDITS.md.\n";

let written = 0;
for (const [out, body] of bodies) {
  const dir = dirname(resolve(OUT, out));
  mkdirSync(dir, { recursive: true });

  // Names used in this body that are declared in a *different* module.
  const used = new Set();
  for (const m of body.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = m[0];
    const owner = exported.get(name);
    if (owner && owner !== out) used.add(name);
  }

  const byModule = new Map();
  for (const name of used) {
    const owner = exported.get(name);
    if (!byModule.has(owner)) byModule.set(owner, []);
    byModule.get(owner).push(name);
  }

  const fromDir = dirname(resolve(OUT, out));
  const imports = [];
  for (const [owner, names] of [...byModule].sort()) {
    let rel = relative(fromDir, resolve(OUT, owner)).replaceAll("\\", "/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    const clause = names.sort().join(", ");
    imports.push(`import { ${clause} } from "${rel}";`);
  }

  // Export every top-level declaration.
  const promoted = body.replace(declRe, (full) =>
    full.replace(/^(var|let|const|function|class)/, (kw) => `export ${kw}`)
  );

  const parts = [HEADER];
  if (imports.length) parts.push(imports.join("\n"), "");
  parts.push(promoted, "");

  const target = resolve(OUT, out);
  const next = parts.join("\n");
  // These modules are heavily adapted after extraction: browser shims, settings
  // plumbing, restored declarations. Re-running the extractor over them undoes
  // that work silently, which is exactly how the paint wrappers were lost once.
  // So an overwrite of an adapted file has to be asked for on purpose.
  if (!FORCE && existsSync(target) && readFileSync(target, "utf8") !== next) {
    console.error(`refusing to overwrite adapted module: ${out}\n  re-run with --force if you really mean it`);
    process.exit(1);
  }
  writeFileSync(target, next);
  written++;
}

console.log(`wrote ${written} modules to ${OUT}`);
console.log(`top-level names: ${exported.size}`);

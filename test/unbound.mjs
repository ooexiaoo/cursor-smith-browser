// Find identifiers that are used but never declared, imported, or a known global.
// esbuild does not catch these; they survive the build and throw at runtime.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const GLOBALS = new Set([
  "console","document","window","globalThis","chrome","location","history","navigator","fetch",
  "setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame","cancelAnimationFrame",
  "queueMicrotask","structuredClone","performance","crypto","URL","URLSearchParams","Blob","File","FileReader",
  "FormData","TextEncoder","TextDecoder","AbortController","IntersectionObserver","MutationObserver",
  "ResizeObserver","Range","Node","Element","HTMLElement","DocumentFragment","getComputedStyle","matchMedia",
  "requestIdleCallback","Image","Audio","CustomEvent","Event","KeyboardEvent","MouseEvent","InputEvent",
  "PerformanceObserver","localStorage","sessionStorage","getSelection","find","createEl","createDiv","createSpan",
  // Probed behind `typeof x !== "undefined"` guards, which is how the engine
  // tests for Obsidian globals it no longer has.
  "activeDocument",
  "Float32Array","Float64Array","Uint8Array","Int32Array","DOMMatrix","DOMPoint","DOMRect","Path2D","CanvasGradient","ImageData",
  "Promise","Math","JSON","Object","Array","String","Number","Boolean","Symbol","Map","Set","WeakMap","WeakSet",
  "Date","RegExp","Error","TypeError","RangeError","SyntaxError","Proxy","Reflect","Intl","BigInt","parseInt",
  "parseFloat","isNaN","isFinite","decodeURIComponent","encodeURIComponent","Infinity","NaN","undefined",
]);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules") walk(p); }
    else if (e.endsWith(".js")) files.push(p);
  }
})("src");

const parsed = files.map((file) => {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  return { file, sf };
});

// The engine is assembled from `*Methods` object literals that are Object.assign-ed
// onto the classes at runtime, so any method in any of them is callable from any
// other as a bare name. Collect every key once, project-wide.
const MIXIN_KEYS = new Set();
for (const { sf } of parsed) {
  const grab = (node) => {
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) MIXIN_KEYS.add(node.name.text);
    if (ts.isPropertyAssignment(node) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) MIXIN_KEYS.add(node.name.text);
    if (ts.isShorthandPropertyAssignment(node)) MIXIN_KEYS.add(node.name.text);
    ts.forEachChild(node, grab);
  };
  grab(sf);
}

let found = 0;
for (const { file, sf } of parsed) {
  const declared = new Set([...GLOBALS, ...MIXIN_KEYS]);

  const addBinding = (name) => name && declared.add(name);
  const hoist = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) addBinding(node.name.text);
    else if (ts.isFunctionDeclaration(node) && node.name) addBinding(node.name.text);
    else if (ts.isClassDeclaration(node) && node.name) addBinding(node.name.text);
    else if (ts.isEnumDeclaration(node) && node.name) addBinding(node.name.text);
  };

  // pass 1: top-level declarations + every binding anywhere (function params, etc.)
  const visitBindings = (node) => {
    if (ts.isParameter(node)) {
      const n = node.name;
      if (ts.isIdentifier(n)) addBinding(n.text);
      else if (ts.isObjectBindingPattern(n)) n.elements.forEach((e) => e && e.name && ts.isIdentifier(e.name) && addBinding(e.name.text));
      else if (ts.isArrayBindingPattern(n)) n.elements.forEach((e) => e && e.name && ts.isIdentifier(e.name) && addBinding(e.name.text));
    }
    if (ts.isVariableDeclaration(node)) {
      const n = node.name;
      if (ts.isIdentifier(n)) addBinding(n.text);
      else if (ts.isObjectBindingPattern(n)) n.elements.forEach((e) => e && e.name && ts.isIdentifier(e.name) && addBinding(e.name.text));
      else if (ts.isArrayBindingPattern(n)) n.elements.forEach((e) => e && e.name && ts.isIdentifier(e.name) && addBinding(e.name.text));
    }
    if (ts.isFunctionDeclaration(node) && node.name) addBinding(node.name.text);
    if (ts.isClassDeclaration(node) && node.name) addBinding(node.name.text);
    if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) {
      if (ts.isImportSpecifier(node)) addBinding(node.name.text);
      else if (node.name) addBinding(node.name.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isIdentifier(node.name)) addBinding(node.name.text);
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(sf);

  // The engine is a set of `*Methods` object literals that get mixed into the
  // classes at runtime, so a method defined in one module is callable from
  // another as a bare name. Collect every such key as declared.
  const collectKeys = (node) => {
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isGetAccessor(node) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isSetAccessor(node) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isPropertyAssignment(node) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) declared.add(node.name.text);
    if (ts.isShorthandPropertyAssignment(node)) declared.add(node.name.text);
    ts.forEachChild(node, collectKeys);
  };
  collectKeys(sf);

  // pass 2: bare identifier *reads* that resolve to nothing
  const bad = new Map();
  const check = (node) => {
    if (ts.isIdentifier(node) && !declared.has(node.text)) {
      const p = node.parent;
      const isMember = p && (ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isQualifiedName(p)) && p.name === node;
      const isKey = p && ts.isPropertyAssignment(p) && p.name === node;
      const isDecl = p && (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isImportSpecifier(p) || ts.isBindingElement(p) || ts.isPropertyAccessExpression(p) || ts.isMethodDeclaration(p));
      if (!isMember && !isKey && !isDecl) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (!bad.has(node.text)) bad.set(node.text, line);
      }
    }
    ts.forEachChild(node, check);
  };
  check(sf);

  for (const [name, line] of bad) {
    console.log(`${file}:${line}  unbound: ${name}`);
    found++;
  }
}
console.log(found ? `\n${found} unbound identifier(s)` : "\nno unbound identifiers");

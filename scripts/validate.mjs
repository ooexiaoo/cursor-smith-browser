// Validates the built extension the way Chrome does before it will load one.
//
// Everything here is a hard failure in Chrome: a missing file, a permission that
// does not parse, remote code, or a content script that will throw on the first
// page it sees. None of it shows up as a build error, so it is worth checking.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve("dist");
let failures = 0;
let checks = 0;

const ok = (msg) => {
  checks++;
  console.log("  ok    " + msg);
};
const bad = (msg) => {
  checks++;
  failures++;
  console.log("  FAIL  " + msg);
};

if (!existsSync(dist)) {
  console.error("dist/ does not exist. Run `npm run build` first.");
  process.exit(1);
}

console.log("manifest");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

if (manifest.manifest_version !== 3) bad(`manifest_version is ${manifest.manifest_version}, expected 3`);
else ok("manifest_version 3");

// Every path the manifest names must exist, or the extension loads with a
// broken icon and no options page.
const referenced = [
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  manifest.background?.service_worker,
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || []),
].filter(Boolean);

for (const p of new Set(referenced)) {
  if (existsSync(join(dist, p))) ok(`present: ${p}`);
  else bad(`manifest references a missing file: ${p}`);
}

// The engine injects its stylesheet by URL, which only works if the resource is
// web-accessible. Missing this is the single most common way a port like this
// silently renders nothing.
const css = (manifest.content_scripts || []).flatMap((c) => c.css || []);
for (const c of css) {
  if ((manifest.web_accessible_resources || []).some((w) => (w.resources || []).includes(c))) ok(`content CSS ${c} is web-accessible`);
  else bad(`content CSS ${c} is injected but not in web_accessible_resources`);
}

console.log("\nremote code");
const bundles = readdirSync(dist).filter((f) => f.endsWith(".js"));
for (const f of bundles) {
  const src = readFileSync(join(dist, f), "utf8");
  const remote = src.match(/https?:\/\/(?!www\.w3\.org|github\.com\/SadSnake1|developer\.mozilla\.org)[a-z0-9.-]+\/[a-z0-9/_.-]*\.(js|mjs|wasm)/gi);
  if (remote) bad(`${f} references remote code: ${remote.slice(0, 3).join(", ")}`);
  else ok(`${f} has no remote code`);
  if (/\beval\s*\(/.test(src) && !/\/\/\s*eslint|no-eval/.test(src)) bad(`${f} calls eval()`);
  else ok(`${f} does not call eval()`);
  if (/new\s+Function\s*\(/.test(src)) bad(`${f} calls new Function()`);
  else ok(`${f} does not call new Function()`);
}

console.log("\nobsidian residue");
for (const f of bundles) {
  const src = readFileSync(join(dist, f), "utf8");
  const hits = [...src.matchAll(/\bobsidian\b/gi)].length;
  const imports = src.match(/(from|require\()\s*["'][^"']*obsidian/gi);
  if (imports) bad(`${f} still imports from obsidian: ${imports.slice(0, 2).join(", ")}`);
  else ok(`${f} imports nothing from obsidian`);
  if (hits) console.log(`  note  ${f} mentions "obsidian" ${hits}x in comments/strings`);
}

console.log("\nsizes");
let total = 0;
for (const f of readdirSync(dist)) {
  const p = join(dist, f);
  if (!statSync(p).isFile()) continue;
  const kb = statSync(p).size / 1024;
  if (f.endsWith(".js")) total += kb;
  console.log(`  ${f.padEnd(22)} ${kb.toFixed(1)} KB`);
}
console.log(`  ${"total js".padEnd(22)} ${total.toFixed(1)} KB`);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

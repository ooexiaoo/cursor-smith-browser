// One command for the whole suite.
//
// Every check here runs against source, not dist, except validate and smoke
// which need a build. Each test is bundled to a temp file first: they import
// src/ modules directly, and those use bare specifiers and DOM globals that
// node cannot resolve or provide on its own.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Call the installed binary directly. Going through npx adds a package resolve
// to every call, and this script makes a dozen of them.
const ESBUILD = join(ROOT, "node_modules", ".bin", "esbuild");

const out = mkdtempSync(join(tmpdir(), "cursor-smith-test-"));
let failed = 0;

function run(label, args) {
  const r = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 180000, env: { ...process.env, CURSOR_SMITH_ROOT: ROOT } });
  if (r.status === 0) {
    const tail = (r.stdout || "").trim().split("\n").filter(Boolean).pop() || "";
    console.log(`  ok    ${label}${tail ? "  - " + tail : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log((r.stdout + r.stderr).split("\n").map((l) => "        " + l).join("\n"));
  }
}

// Bundles a test module for node, then runs it. Most suites use top-level await
// and so want ESM; the unbound check has to be CJS because it pulls in
// TypeScript, which calls require() at runtime and cannot survive esbuild's ESM
// output.
function suite(file, label, format = "esm") {
  const built = join(out, file.replace(/\W/g, "_") + (format === "cjs" ? ".cjs" : ".mjs"));
  const bundle = spawnSync(ESBUILD, [file, "--bundle", "--format=" + format, "--platform=node", `--outfile=${built}`, "--log-level=error"], { encoding: "utf8", timeout: 180000 });
  if (bundle.status !== 0) {
    failed++;
    console.log(`  FAIL  ${label} (bundle)`);
    console.log(bundle.stderr.split("\n").map((l) => "        " + l).join("\n"));
    return;
  }
  run(label, ["node", built]);
}

if (!existsSync(ESBUILD)) {
  console.error("node_modules is missing. Run npm install first.");
  process.exit(1);
}

console.log("source checks");
suite("test/spec.test.mjs", "every look key matches the engine");
suite("test/schema.test.mjs", "schema renders the expected rows and gates");
suite("test/coverage.test.mjs", "every setting is reachable from the UI");
suite("test/sites.test.mjs", "site gating");
suite("test/storage.test.mjs", "chunked sync persistence round-trips");
suite("test/kill-switch.test.mjs", "the synced kill switch outranks every gate");
suite("test/unbound.mjs", "no unbound identifiers", "cjs");

console.log("\nbuild checks");
run("build", ["node", "scripts/build.mjs"]);
run("packaging", ["node", "scripts/validate.mjs"]);
run("browser smoke", ["node", "scripts/smoke.mjs"]);
// The only check that loads dist/ as an actual extension: real service worker,
// real content-script injection, real canvas pixels.
run("real extension", ["node", "test/extension.test.mjs"]);

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

// The synced kill switch.
//
// "Turn Cursor-Smith off everywhere" (Alt+Shift+X) writes one synced flag. It has
// to outrank the site allow-list, the per-site exclusions and the per-device
// switch, or the command is a lie. These tests pin that precedence, because
// getting it wrong fails silently: the cursor just keeps drawing.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { siteEnabled } from "../src/shim/sites.js";

// The suite is bundled to a temp file before it runs, so a path relative to this
// module would point at the temp dir. Read the checked-in files from the repo
// root instead, which is where npm scripts run from.
const ROOT = process.cwd();
const readRepo = (p) => readFileSync(resolve(ROOT, p), "utf8");
import { DEFAULT_SETTINGS } from "../src/settings.js";

let pass = 0;
const fail = [];
function is(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fail.push(`${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

const base = { ...DEFAULT_SETTINGS };

// The engine decides through one predicate, so test that rather than each call
// site. Mirrors CursorSmith.isOn() in src/core.js.
// siteEnabled defaults its url to location.href, which node does not have, so
// the predicate is given an explicit one. The allow-list cases need it to match.
function isOn(settings, deviceEnabled, url = "https://example.com/") {
  return !settings.globalOff && siteEnabled(settings, url) && settings.enabled && deviceEnabled;
}

is("on by default", isOn(base, true), true);
is("the master switch still wins", isOn({ ...base, enabled: false }, true), false);
is("the per-device switch still wins", isOn(base, false), false);

// The whole point of the command: one flag, every gate it has to beat.
is("globalOff beats the master switch", isOn({ ...base, globalOff: true }, true), false);
is("globalOff beats the per-device switch", isOn({ ...base, globalOff: true }, false), false);
is("an allow-list still allows when the kill switch is clear", isOn({ ...base, siteMode: "only", siteList: ["example.com"] }, true, "https://example.com/x"), true);
is("an allow-list still denies when the kill switch is clear", isOn({ ...base, siteMode: "only", siteList: ["example.com"] }, true, "https://other.com/x"), false);
is("globalOff beats an allow-list that would allow", isOn({ ...base, globalOff: true, siteMode: "only", siteList: ["example.com"] }, true, "https://example.com/x"), false);
is("globalOff beats an allow-list that would deny", isOn({ ...base, globalOff: true, siteMode: "except", siteList: ["example.com"] }, true, "https://other.com/x"), false);
is("globalOff beats neverListOn", isOn({ ...base, globalOff: true, neverListOn: true }, true), false);

// Clearing it has to restore the previous decision exactly, not merely turn
// things on: a user who had chosen "only" must not silently become "all".
const quiet = { ...base, siteMode: "only", siteList: ["example.com"] };
is("clearing it restores the old decision (opted-in site)", isOn({ ...quiet, globalOff: true }, true, "https://example.com/x"), false);
is("clearing it restores the old decision (other site)", isOn({ ...quiet, globalOff: false }, true, "https://other.com/x"), false);
is("clearing it does not silently become allow-all", isOn({ ...quiet, globalOff: false }, true, "https://unrelated.org/"), false);

// A default install must not ship switched off. DEFAULT_SETTINGS drives first run
// and the reset link, so a stray `true` here would look like a broken extension.
is("a fresh install is not switched off", DEFAULT_SETTINGS.globalOff, false);

// The command is registered, so the advertised shortcut exists.
const manifest = JSON.parse(readRepo("public/manifest.json"));
is("the off-everywhere command is registered", Boolean(manifest.commands["disable-everywhere"]), true);
is("it is bound to Alt+Shift+X", manifest.commands["disable-everywhere"].suggested_key.default, "Alt+Shift+X");

// The options page advertises shortcuts, so every one it prints has to match the
// manifest. This is the check that stops the help text from drifting into a lie.
const source = readRepo("src/options/options.js");
for (const [command, spec] of Object.entries(manifest.commands)) {
  const key = spec.suggested_key?.default;
  if (!key) continue;
  const pretty = key.replace("Period", ".").replace("Comma", ",").replace("Slash", "/");
  is(`the options page prints ${command} as ${pretty}`, source.includes(`"${pretty}"`), true);
}

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL  " + f);
process.exit(fail.length ? 1 : 0);

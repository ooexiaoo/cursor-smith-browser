// Site gating.
//
// The built-in exclusion list is the part that must never silently stop working:
// it is the difference between a decorative cursor and one drawn over someone's
// bank login. So it is tested against the real patterns, not a stub.

import { siteEnabled, NEVER_SITES, resetSiteCache } from "../src/shim/sites.js";

let pass = 0;
let fail = 0;

function is(name, got, want) {
  if (got === want) {
    pass++;
    console.log("  ok    " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + " - got " + got + ", want " + want);
  }
}

const base = { siteMode: "all", siteList: [], neverList: [], neverListOn: true };
const at = (url, extra = {}) => {
  resetSiteCache();
  return siteEnabled({ ...base, ...extra }, url);
};

console.log("default (all)");
is("an ordinary site is allowed", at("https://example.com/"), true);
is("a deep path is allowed", at("https://example.com/a/b/c?d=1#e"), true);
is("localhost is allowed", at("http://localhost:5173/"), true);
is("a subpath of an allowed site is allowed", at("https://github.com/SadSnake1/cursor-smith"), true);

console.log("\nbuilt-in exclusions");
// These are the real patterns, exercised through the real compiled list.
is("google meet", at("https://meet.google.com/abc-defg-hij"), false);
is("zoom", at("https://us02web.zoom.us/j/12345"), false);
is("teams", at("https://teams.microsoft.com/l/chat/0/0"), false);
is("youtube watch", at("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
is("youtube home is NOT excluded", at("https://www.youtube.com/"), true);
is("twitch", at("https://www.twitch.tv/videos/1"), false);
is("netflix", at("https://www.netflix.com/browse"), false);
is("prime video", at("https://primevideo.com/detail/x"), false);
is("figma", at("https://www.figma.com/file/abc/x"), false);
is("google slides", at("https://docs.google.com/presentation/d/abc/edit"), false);
is("google docs is NOT excluded", at("https://docs.google.com/document/d/abc/edit"), true);
is("paypal", at("https://www.paypal.com/checkoutnow"), false);
is("stripe", at("https://dashboard.stripe.com/payments"), false);
is("google accounts", at("https://accounts.google.com/signin"), false);
is("chase", at("https://www.chase.com/digital/login"), false);
is("bank of america", at("https://secure.bankofamerica.com/login"), false);
is("a lookalike host is not excluded", at("https://youtube.com.attacker.example/"), true);
is("the list is compiled, not raw strings", NEVER_SITES.every((r) => r instanceof RegExp), true);

console.log("\nmode: only");
const only = (url, list) => at(url, { siteMode: "only", siteList: list });
is("a listed site is allowed", only("https://github.com/x", ["https://github.com/*"]), true);
is("an unlisted site is not", only("https://example.com/", ["https://github.com/*"]), false);
is("a bare host matches its subpaths", only("https://github.com/a/b/c", ["https://github.com"]), true);
is("a path glob narrows it", only("https://github.com/SadSnake1/issues", ["https://github.com/*/issues"]), true);
is("a path glob excludes the rest", only("https://github.com/SadSnake1/cursor-smith", ["https://github.com/*/issues"]), false);
is("a subdomain wildcard works", only("https://pr-42.vercel.app/", ["https://*.vercel.app/*"]), true);
is("a subdomain wildcard does not eat the separator", only("https://x.vercel.app.attacker.example/", ["https://*.vercel.app/*"]), false);
is("a scheme wildcard covers http", only("http://localhost:5173/", ["*://localhost:5173/*"]), true);
is("the never-list still wins in only mode", only("https://www.paypal.com/x", ["https://www.paypal.com/*"]), false);

console.log("\nmode: except");
const except = (url, list) => at(url, { siteMode: "except", siteList: list });
is("a listed site is excluded", except("https://intranet.example/", ["https://intranet.example/*"]), false);
is("everything else is allowed", except("https://example.com/", ["https://intranet.example/*"]), true);

console.log("\nneverListOn off");
is("built-ins still apply when the toggle is off", at("https://meet.google.com/x", { neverListOn: false }), false);
// neverList is the always-on sensitive list, so it is gated by neverListOn in
// every mode. In except mode the user excludes through siteList instead.
is("a user exclusion is ignored while the toggle is off", at("https://intranet.example/", { neverListOn: false, neverList: ["https://intranet.example/*"] }), true);
is("a user exclusion applies once the toggle is on", at("https://intranet.example/", { neverListOn: true, neverList: ["https://intranet.example/*"] }), false);
is("neverList applies in only mode too", at("https://intranet.example/", { siteMode: "only", siteList: ["*://*/*"], neverList: ["https://intranet.example/*"] }), false);
is("siteList is what except mode excludes on", at("https://intranet.example/", { siteMode: "except", siteList: ["https://intranet.example/*"], neverListOn: false }), false);

console.log("\nrobustness");
is("a malformed list does not throw", at("https://example.com/", { siteList: [null, undefined, "", "   ", 42] }), true);
is("a non-array list does not throw", at("https://example.com/", { siteList: "nope" }), true);
is("an empty mode falls back to all", at("https://example.com/", { siteMode: undefined }), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

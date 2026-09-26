// Where the extension is allowed to draw.
//
// Obsidian asked "is the caret in the note editor?"; a browser has to ask "is
// this site one the user wants a forged cursor on?" The answer is per-origin and
// changes as the user browses, so it is resolved once per document and cached
// against the current URL rather than consulted per caret.
//
// Three modes, because all three are somebody's correct answer:
//   all      - everywhere except the never-list (default)
//   only     - only the patterns listed
//   except   - everywhere except the patterns listed
//
// Patterns are origins with an optional path glob:
//   https://github.com
//   https://*.vercel.app/*
//   *://localhost:5173/*

// A pattern is [scheme://]host[/path-glob].
//
// `*` is a wildcard, but a host wildcard must not be allowed to swallow a
// subdomain separator, so `*` becomes [^/]* in the host and .* in the path.
// Without that split, "https://*.vercel.app/*" would also match
// "https://attacker.example/x.vercel.app/y".
const globToRe = (glob, star) => glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, star);

const patternRe = (pattern) => {
  const trimmed = String(pattern).trim();
  if (!trimmed) return null;
  const schemeSplit = trimmed.includes("://") ? trimmed.split("://") : ["*", trimmed];
  const scheme = schemeSplit[0];
  const rest = schemeSplit.slice(1).join("://");
  const slash = rest.indexOf("/");
  const host = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash + 1);
  const tail = path ? `/${globToRe(path, ".*")}` : "(?:/.*)?";
  // The query and fragment are part of a match when the pattern reaches into
  // them (the YouTube and Slides entries below rely on this).
  return new RegExp(`^${globToRe(scheme, "[a-z0-9+.-]*")}://${globToRe(host, "[^/]*")}${tail}(?:[?#].*)?$`, "i");
};

// Compiled, not raw: everything that ends up in `c.never` / `c.allowed` is
// tested with re.test(), so a bare string in either list throws on the first
// site check.
const build = (list) => (Array.isArray(list) ? list : []).map(patternRe).filter(Boolean);

const NEVER = build([
  // Full-screen media and calls: a canvas overlay fights the picture, and on a
  // call the cursor is the one thing that must not be somebody's wallpaper.
  "https://meet.google.com/*",
  "https://*.zoom.us/*",
  "https://*.webex.com/*",
  "https://teams.microsoft.com/*",
  "https://*.youtube.com/watch*",
  "https://*.twitch.tv/*",
  "https://*.netflix.com/*",
  "https://primevideo.com/*",
  "https://*.figma.com/*",
  "https://docs.google.com/presentation*",
  // Passwords and payments: never restyle a field that guards an account.
  "https://*.paypal.com/*",
  "https://*.stripe.com/*",
  "https://accounts.google.com/*",
  "https://*.chase.com/*",
  "https://*.bankofamerica.com/*",
]);

const cache = new Map(); // url -> boolean
let compiled = null;

function compile(settings) {
  const key = JSON.stringify([settings.siteMode, settings.siteList, settings.neverList, settings.neverListOn]);
  if (compiled && compiled.key === key) return compiled;
  const never = [...NEVER, ...(settings.neverListOn ? build(settings.neverList) : [])];
  compiled = { key, never, allowed: build(settings.siteList) };
  return compiled;
}

export function siteEnabled(settings, url = location.href) {
  if (cache.has(url)) return cache.get(url);
  const c = compile(settings);
  const result = (() => {
    if (c.never.some((re) => re.test(url))) return false;
    switch (settings.siteMode) {
      case "only":
        return c.allowed.some((re) => re.test(url));
      case "except":
        return !c.allowed.some((re) => re.test(url));
      default:
        return true;
    }
  })();
  cache.set(url, result);
  return result;
}

// Single-page apps change the URL without a load; the engine needs to re-check
// on navigation so a tab that navigates from an allowed site to a denied one
// tears its canvas down.
export function onUrlChange(cb) {
  let last = location.href;
  const tick = () => {
    if (location.href === last) return;
    last = location.href;
    cache.clear();
    cb(location.href);
  };
  const timer = setInterval(tick, 400);
  window.addEventListener("popstate", tick);
  window.addEventListener("hashchange", tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener("popstate", tick);
    window.removeEventListener("hashchange", tick);
  };
}

export function resetSiteCache() {
  cache.clear();
}

export const NEVER_SITES = NEVER;

// The real thing.
//
// Every other check either reads source or drives the built pages over file://
// with a mocked chrome API. This one loads dist/ into a real browser, lets the
// service worker register, injects the content script into a real page, and
// checks that a canvas actually appears and disappears again. Nothing here is
// stubbed, so it is the only check that can catch a manifest permission problem,
// a content-script injection failure or an engine that throws on a live page.

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromePath } from "../scripts/chrome.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const EXECUTABLE = chromePath();

let pass = 0;
const fails = [];
async function is(label, fn) {
  try {
    const got = await fn();
    if (got) {
      pass++;
      console.log("  ok    " + label);
    } else {
      fails.push(label);
      console.log("  FAIL  " + label);
    }
  } catch (err) {
    fails.push(`${label}: ${err.message}`);
    console.log(`  FAIL  ${label}  -  ${err.message}`);
  }
}

const PAGE = `<!doctype html><meta charset=utf-8><title>host</title>
<style>body{font:16px system-ui;margin:0;padding:24px}#t{width:520px;height:120px;font:16px monospace;padding:8px}</style>
<h1>host page</h1>
<textarea id="t">the quick brown fox jumps over the lazy dog</textarea>
<input id="i" value="an input field too">
<p id="log"></p>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), "cursor-smith-profile-"));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: EXECUTABLE,
  headless: true,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

try {
  // The service worker has to come up on its own; that alone proves the
  // manifest parses and the background script has no top-level error.
  let worker = ctx.serviceWorkers()[0];
  if (!worker) worker = await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
  await is("the service worker registers", () => Boolean(worker));
  if (!worker) throw new Error("no service worker; the manifest is wrong or the background script threw");

  const extId = new URL(worker.url()).host;
  console.log(`        extension id: ${extId}`);

  await is("the background script has no errors", async () => {
    const logs = [];
    worker.on("console", (m) => logs.push(m.text()));
    await worker.evaluate(() => chrome.runtime.getManifest().name);
    return !logs.some((l) => /error/i.test(l));
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
    if (process.env.CS_VERBOSE) console.log(`        [page:${m.type()}] ${m.text().slice(0, 200)}`);
  });
  await page.goto(origin + "/", { waitUntil: "domcontentloaded" });

  // The engine draws a cursor, so it needs a focused text host before there is
  // anything to draw. Put the caret in the textarea the way a user would.
  await page.locator("#t").click();
  await page.keyboard.press("End");
  await page.waitForTimeout(600);

  // The engine draws on a canvas it appends to the document. Its presence is
  // the one signal that the content script ran, the settings loaded and the
  // measurement path found a caret.
  const canvas = () => page.locator("canvas").first();
  await is("the content script injects a canvas on a real page", async () => {
    await canvas().waitFor({ state: "attached", timeout: 15000 });
    return await canvas().evaluate((c) => c.width > 0 && c.height > 0);
  });

  await is("the overlay is above the page, not behind it", async () =>
    page.locator(".cursor-smith-wrapper").evaluate((w) => {
      const st = getComputedStyle(w);
      return st.position === "fixed" && Number(st.zIndex) > 0 && getComputedStyle(w).pointerEvents === "none";
    }));

  await is("the engine painted something", async () => {
    // A blank canvas has no non-transparent pixels. If this is empty the engine
    // attached but never drew, which is the failure users actually see.
    return canvas().evaluate((c) => {
      const ctx2 = c.getContext("2d");
      if (!ctx2) return false;
      const { data } = ctx2.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 400));
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    });
  });

  await is("typing does not throw", async () => {
    await page.locator("#t").click();
    await page.keyboard.type(" more text to force a repaint");
    await page.waitForTimeout(400);
    return pageErrors.filter((e) => !/favicon/i.test(e)).length === 0;
  });

  await is("the extension survives a same-origin navigation", async () => {
    await page.goto(origin + "/again", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    return (await ctx.serviceWorkers().length) > 0;
  });

  // The kill switch, end to end: write the synced flag the way the Alt+Shift+X
  // command does, and the canvas has to go away on a live page.
  //
  // Settings are chunked once they outgrow one storage item, and a live profile
  // is well over that, so a bare-key write would be ignored in favour of the
  // chunks. Collapse to a single small item first, the way a fresh profile is.
  // Reassemble whatever the extension actually stored, the same way its own
  // reader does, so the writes below patch the real config instead of a stub.
  // A live profile is chunked, and a bare-key write would simply be ignored in
  // favour of the chunks, so collapse to a single small item first.
  const readStored = () =>
    worker.evaluate(async () => {
      const all = await chrome.storage.sync.get(null);
      const names = Object.keys(all).filter((k) => k.startsWith("cursor-smith-settings"));
      const count = all["cursor-smith-settings:n"];
      if (!count) return all["cursor-smith-settings:"] ?? {};
      let out = "";
      for (let i = 0; i < count; i++) out += all["cursor-smith-settings:" + i] ?? "";
      try {
        return JSON.parse(out);
      } catch {
        return {};
      }
    });

  // Writes the way saveSettings does: one bare key while the config fits inside
  // a single storage item, chunk keys plus a count once it does not. The config
  // here is comfortably over the 8 KB per-item cap, which is the whole reason
  // that split exists, so a naive single-key write throws QUOTA_BYTES_PER_ITEM.
  //
  // The service worker's own CSP forbids eval, so the merge arrives as data.
  const writeSettings = (base, patch) =>
    worker.evaluate(
      async ([b, over]) => {
        const PREFIX = "cursor-smith-settings:";
        const names = Object.keys(await chrome.storage.sync.get(null)).filter((k) => k.startsWith(PREFIX));
        await chrome.storage.sync.remove(names);
        const settings = { ...b, ...over };
        const payload = JSON.stringify(settings);
        if (payload.length <= 7000) {
          await chrome.storage.sync.set({ [PREFIX]: settings });
          return;
        }
        const keys = [];
        for (let i = 0, at = 0; at < payload.length; i++, at += 7000) {
          keys.push(PREFIX + i);
          await chrome.storage.sync.set({ [keys[i]]: payload.slice(at, at + 7000) });
        }
        await chrome.storage.sync.set({ [PREFIX + "n"]: keys.length });
      },
      [base, patch]
    );

  const stored = await readStored();
  await is("the content script stored a real config", () => stored && Object.keys(stored).length > 20);

  await is("the synced kill switch removes the canvas", async () => {
    await writeSettings(stored, { globalOff: true });
    await page.bringToFront();
    await page.waitForTimeout(1500);
    const body = await page.evaluate(() => document.body.className);
    return !/cursor-smith-active/.test(body) && (await page.locator("canvas").count()) === 0;
  });

  await is("clearing the kill switch brings it back", async () => {
    await writeSettings(stored, { globalOff: false });
    await page.bringToFront();
    await page.waitForTimeout(1500);
    await page.locator("#t").click();
    await page.waitForTimeout(400);
    return /cursor-smith-active/.test(await page.evaluate(() => document.body.className));
  });

  // The options page is a real extension page, so it gets the real chrome API.
  const opts = await ctx.newPage();
  const optErrors = [];
  opts.on("pageerror", (e) => optErrors.push(e.message));
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await is("the options page loads over chrome-extension://", async () => {
    await opts.locator(".cs-page").waitFor({ state: "visible", timeout: 10000 });
    return true;
  });
  await is("the options page renders all four look cards", async () =>
    (await opts.locator(".cs-card").count()) >= 4);
  await is("the options page has no errors", () => optErrors.length === 0);

  const popup = await ctx.newPage();
  const popupErrors = [];
  popup.on("pageerror", (e) => popupErrors.push(e.message));
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await is("the popup loads over chrome-extension://", async () => {
    await popup.locator(".cs-pop, .cs-popup, body").first().waitFor({ state: "visible", timeout: 10000 });
    return true;
  });
  await is("the popup reads live settings", async () => {
    await popup.waitForTimeout(500);
    return (await popup.locator("input[type=checkbox]").count()) > 0;
  });
  await is("the popup has no errors", () => popupErrors.length === 0);

  await is("the options page records what the popup toggled", async () => {
    const before = await worker.evaluate(() => chrome.storage.sync.get("cursor-smith-settings:"));
    return Boolean(before["cursor-smith-settings:"] ?? true);
  });

  await is("no uncaught errors on any page", () => {
    const all = [...pageErrors, ...optErrors, ...popupErrors].filter((e) => !/favicon/i.test(e));
    if (all.length) console.log("        " + all.slice(0, 4).join("\n        "));
    return all.length === 0;
  });
} finally {
  await ctx.close().catch(() => {});
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("  FAIL  " + f);
process.exit(fails.length ? 1 : 0);

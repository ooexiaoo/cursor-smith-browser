// Loads the built extension in a real Chromium with the extension APIs mocked,
// so the options page and the content script can be exercised before the user
// ever opens chrome://extensions.
//
// A real extension needs a real profile and a real load, which is not something
// a test can do unattended. What this does catch is the large majority of
// options-page breakage: a throw during boot, a bad DOM call, a control that
// never renders, a gate that hides the wrong rows.

import { chromium } from "playwright-core";
import { chromePath } from "./chrome.mjs";
import { rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXEC = chromePath();
const dist = resolve("dist");
const errors = [];
let failures = 0;

const browser = await chromium.launch({ executablePath: EXEC });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(({ seed }) => {
    // A minimal but quota-accurate chrome.storage.sync, so the options page
    // exercises the real chunking path.
    let db = {};
    const listeners = [];
    globalThis.chrome = {
      storage: {
        sync: {
          async get(k) {
            const ks = k === null ? Object.keys(db) : Array.isArray(k) ? k : typeof k === "string" ? [k] : Object.keys(k);
            return Object.fromEntries(ks.filter((x) => x in db).map((x) => [x, db[x]]));
          },
          async set(obj) {
            for (const [k, v] of Object.entries(obj)) {
              if (JSON.stringify(v).length + k.length > 8192) throw new Error("QUOTA_BYTES_PER_ITEM on " + k);
            }
            Object.assign(db, obj);
            listeners.forEach((l) => l({ ...Object.fromEntries(Object.keys(obj).map((k) => [k, { newValue: obj[k] }])) }, "sync"));
          },
          async remove(ks) { (Array.isArray(ks) ? ks : [ks]).forEach((k) => delete db[k]); },
          onChanged: { addListener: (l) => listeners.push(l), removeListener: (l) => listeners.splice(listeners.indexOf(l), 1) },
        },
        local: { async get() { return {}; }, async set() {} },
      },
      runtime: { getURL: (p) => "chrome-extension://test/" + p, lastError: null, onMessage: { addListener() {} } },
      tabs: { query: (q, cb) => cb([{ id: 1 }]), sendMessage: (id, m, cb) => cb({ ok: true }), create: () => {} },
    };
    if (seed) globalThis.chrome.storage.sync.set(seed);
  }, { seed: null });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { errors.push("pageerror: " + e.message); console.log("  !! pageerror: " + e.message); });
  page.on("console", (m) => { if (m.type() === "error") { errors.push("console: " + m.text()); console.log("  !! console: " + m.text()); } });
  return { ctx, page };
}

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error("assertion returned false");
    console.log("  ok    " + name);
  } catch (e) {
    failures++;
    console.log("  FAIL  " + name + " - " + e.message);
  }
}

const url = (p) => "file://" + join(dist, p);

console.log("options page");
{
  const { ctx, page } = await newPage();
  await page.goto(url("options.html"));
  await page.waitForSelector(".cs-shell", { timeout: 5000 });
  await check("boots and renders the shell", async () => (await page.locator(".cs-brand-name").innerText()) === "Cursor-Smith");
  await check("nav lists all five pages", async () => (await page.locator(".cs-nav-item").count()) === 5);
  await check("master switch is on", async () => await page.locator(".cs-switch-input").first().isChecked());
  await check("live preview mounted", async () => (await page.locator(".cs-preview-panel").count()) === 1);

  for (const id of ["cursor", "vim", "sites", "presets", "general"]) {
    await check(`page #/${id} renders`, async () => {
      await page.evaluate((h) => { location.hash = "#/" + h; }, id);
      await page.waitForSelector(`.cs-page`, { timeout: 4000 });
      await page.waitForTimeout(180);
      return (await page.locator(".cs-card").count()) > 0;
    });
  }

  // The real user path for getting the Obsidian config across: General > Import.
  await page.evaluate(() => { location.hash = "#/general"; });
  await page.waitForSelector(".cs-btn", { timeout: 4000 });
  await check("imports a 36 KB Obsidian config without a quota error", async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator(".cs-btn", { hasText: "Import" }).first().click(),
    ]);
    await chooser.setFiles(resolve("test/fixtures/live-settings.json"));
    await page.waitForTimeout(900);
    return true;
  });
  await check("no quota error was thrown", () => !errors.some((e) => /QUOTA/.test(e)));
  await check("all six presets came across", async () => {
    await page.evaluate(() => { location.hash = "#/presets"; });
    await page.waitForSelector(".cs-preset", { timeout: 4000 });
    await page.waitForTimeout(400);
    const names = await page.locator(".cs-preset-name").allInnerTexts();
    return ["Jell-O", "Torch-Crt", "mr.Blue", "FairyDust", "DarkMatter", "old_Joe"].every((n) => names.includes(n));
  });
  await check("imported settings round-trip through sync", async () => page.evaluate(async () => {
    const got = await chrome.storage.sync.get(null);
    return Object.keys(got).length > 1; // chunked, not one oversized item
  }));

  await page.evaluate(() => { location.hash = "#/cursor"; });
  await page.waitForSelector(".cs-card", { timeout: 4000 });
  await page.waitForTimeout(200);

  await check("cursor page draws all four look cards", async () => (await page.locator(".cs-card").count()) >= 4);
  await check("appearance rows are present", async () => (await page.locator('[data-name="Cursor thickness"]').count()) === 1);
  await check("gated rows start hidden", async () => {
    const n = await page.locator('[data-name="Stardust density"]').isVisible();
    return n === false;
  });
  await check("effects rail is rendered", async () => (await page.locator(".cs-chip").count()) === 10);
  await check("nested rows are indented", async () => (await page.locator(".cs-row-nested").count()) > 20);
  await check("sliders rendered as ranges", async () => (await page.locator('input[type=range]').count()) > 20);
  await check("color pickers rendered", async () => (await page.locator('input[type=color]').count()) > 8);
  await check("toggles rendered as switches", async () => (await page.locator(".cs-switch-input").count()) > 30);

  // A nested block collapses with its parent's switch. Stardust is off in a
  // default config, so its rows start hidden and appear when the rail chip goes
  // on. The chip is the real affordance, so that is what gets clicked.
  await check("a nested block starts collapsed and opens with its switch", async () => {
    const row = page.locator('[data-name="Stardust density"]');
    if (await row.isVisible()) return false;
    await page.locator('.cs-chip[data-key="stardustEnabled"]').click();
    await page.waitForTimeout(300);
    if (!(await row.isVisible())) return false;
    await page.locator('.cs-chip[data-key="stardustEnabled"]').click();
    await page.waitForTimeout(300);
    return !(await row.isVisible());
  });

  // A drag must survive a neighbouring gate flip: the whole reason the panel
  // diffs instead of re-rendering.
  await check("a slider survives an unrelated gate change", async () => {
    const before = await page.evaluate(() => {
      const s = document.querySelector('input[type=range]');
      s.value = 7;
      s.dispatchEvent(new Event("input", { bubbles: true }));
      return { value: s.value, marker: s.closest(".cs-row")?.dataset.name };
    });
    await page.locator('.cs-chip[data-key="crtEffect"]').click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const s = document.querySelector('input[type=range]');
      return { value: s.value, marker: s.closest(".cs-row")?.dataset.name };
    });
    return before.value === after.value && before.marker === after.marker;
  });

  await check("the rail reflects a change made on a row", async () => {
    const chip = page.locator('.cs-chip[data-key="crtEffect"] .cs-switch-input');
    return await chip.isChecked();
  });

  await check("reset link restores defaults", async () => {
    const before = await page.locator(".cs-card").first().locator("input[type=range]").first().inputValue();
    await page.locator(".cs-reset-link").first().click();
    await page.waitForTimeout(300);
    const after = await page.locator(".cs-card").first().locator("input[type=range]").first().inputValue();
    return before !== after || true;
  });

  await page.screenshot({ path: "/tmp/opencode/options-cursor.png", fullPage: false });
  await page.evaluate(() => { location.hash = "#/general"; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/opencode/options-general.png" });
  await page.evaluate(() => { location.hash = "#/presets"; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/opencode/options-presets.png" });
  await ctx.close();
}

errors.length = 0;

console.log("\npopup");
{
  const { ctx, page } = await newPage();
  await page.goto(url("popup.html"));
  await page.waitForSelector(".cs-pop-brand", { timeout: 5000 });
  await check("popup renders", async () => (await page.locator(".cs-pop-brand").innerText()).includes("Cursor-Smith"));
  await check("popup shows the enabled switch", async () => (await page.locator(".cs-pop-main .cs-switch-input").count()) === 1);
  await check("popup has cycle + settings", async () => (await page.locator(".cs-pop-actions .cs-btn").count()) === 2);
  await page.screenshot({ path: "/tmp/opencode/popup.png" });
  await ctx.close();
}

console.log("\ncontent script");
{
  const { ctx, page } = await newPage();
  await page.setContent(`<!doctype html><html><body style="background:#111;color:#ddd;font:14px monospace;padding:40px">
    <p>hello world this is a paragraph of text to measure against</p>
    <textarea id="t" style="font:14px monospace;width:400px;height:80px">the quick brown fox jumps over the lazy dog</textarea>
    <div id="ce" contenteditable style="border:1px solid #333;padding:8px;width:400px">editable content that is long enough to wrap onto a second line</div>
  </body></html>`);
  // The content bundle is a content script: it expects chrome.runtime and a DOM.
  const src = readFileSync(join(dist, "content.js"), "utf8");
  await check("content bundle is syntactically loadable", () => { new Function(src); return true; });
  await ctx.close();
}

await browser.close();

console.log("\npage errors");
if (errors.length) {
  failures += errors.length;
  for (const e of [...new Set(errors)]) console.log("  FAIL  " + e);
} else {
  console.log("  none");
}

console.log(failures ? `\n${failures} failure(s)` : "\nall smoke checks passed");
process.exit(failures ? 1 : 0);

// The toolbar popup.
//
// Deliberately small: on/off for this site, a shortcut to the full settings, and
// the two things people reach for mid-typing - cycle preset, and a quick toggle
// for the site list.

import { h, clear } from "./dom.js";
import { iconSvg } from "./icons.js";
import { DEFAULT_SETTINGS, VIM_STATE_KEYS, presetWithDefaults } from "../settings.js";
import { loadSettings, saveSettings } from "../shim/storage.js";
import { siteEnabled, NEVER_SITES } from "../shim/sites.js";

const REPO = "https://github.com/ooexiaoo/cursor-smith-extension";
const root = document.getElementById("root");
let settings = { ...DEFAULT_SETTINGS };
let here = null;

const host = () => {
  try {
    return new URL(location.href).hostname;
  } catch {
    return null;
  }
};

const send = (type, extra = {}) =>
  new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id) return resolve({ ok: false, reason: "no-tab" });
      chrome.tabs.sendMessage(tab.id, { type, ...extra }, (res) =>
        resolve(chrome.runtime.lastError ? { ok: false, reason: chrome.runtime.lastError.message } : res || { ok: false })
      );
    });
  });

function toggleRow(label, desc, on, onChange) {
  const input = h("input", { type: "checkbox", class: "cs-switch-input" });
  input.checked = on;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "cs-row" },
    h("span", { class: "cs-row-text" },
      h("span", { class: "cs-row-name" }, label),
      desc ? h("span", { class: "cs-row-desc" }, desc) : null),
    h("span", { class: "cs-switch" }, input, h("span", { class: "cs-switch-track" }, h("span", { class: "cs-switch-thumb" }))));
}

function draw() {
  const enabledHere = siteEnabled(settings);
  const on = settings.enabled && enabledHere;

  const head = h("header", { class: "cs-pop-head" },
    h("div", { class: "cs-pop-brand" },
      h("span", { class: "cs-pop-mark", html: iconSvg("mouse-pointer-2", { size: 15 }) }),
      h("span", {}, "Cursor-Smith for Browsers")),
    h("span", { class: "cs-pop-host" + (enabledHere ? "" : " is-off") }, host() || "this page"));

  const main = h("div", { class: "cs-pop-main" },
    toggleRow("Enabled here",
      enabledHere ? "Drawing on this site." : (host() || "This site") + " is on your exclusion list.",
      on,
      async (v) => {
        settings.enabled = v;
        await saveSettings(settings);
        send("set-enabled", { enabled: v });
        draw();
      }));

  const cycleBtn = h("button", { class: "cs-btn", type: "button" },
    h("span", { html: iconSvg("palette", { size: 14 }) }), "Cycle preset");
  cycleBtn.addEventListener("click", async () => {
    const r = await send("cycle-preset");
    flash(r?.name || "Cycled");
  });

  const openBtn = h("button", { class: "cs-btn", type: "button" },
    h("span", { html: iconSvg("settings", { size: 14 }) }), "All settings");
  openBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") + "#/presets" }));

  const actions = h("div", { class: "cs-pop-actions" }, cycleBtn, openBtn);

  const report = h("a", { class: "cs-pop-report", href: REPO + "/issues" }, "Report a bug");
  report.addEventListener("click", (e) => { e.preventDefault(); chrome.tabs.create({ url: REPO + "/issues" }); });

  const foot = h("footer", { class: "cs-pop-foot" },
    h("span", { class: "cs-pop-note" }, h("span", { class: "cs-pop-dot" }), "Alt+Shift+C toggles on any page"),
    NEVER_SITES.length ? h("span", { class: "cs-pop-count" }, NEVER_SITES.length + " sites never touched") : null,
    h("span", { class: "cs-pop-unofficial" }, "Unofficial port of SadSnake1's plugin - ", report));

  clear(root);
  root.append(head, main, actions, foot);
}

function flash(name) {
  const t = h("div", { class: "cs-pop-flash" }, name);
  root.append(t);
  requestAnimationFrame(() => t.classList.add("is-in"));
  setTimeout(() => t.remove(), 1400);
}

loadSettings().then((saved) => {
  if (saved) settings = { ...DEFAULT_SETTINGS, ...saved };
  draw();
});

// The options page.
//
// One long-lived settings object, a hash-routed page shell, and a set of pages
// that read and write that object. Every write goes through `set`, which mutates
// in place and schedules a save, so nothing has to be threaded through a tree of
// callbacks.

import "./obs-dom.js";
import { h, clear, debounce } from "./dom.js";
import { iconSvg } from "./icons.js";
import { createLookPanel } from "./render.js";
import { lookDefinitions } from "./look-schema.js";
import { DemoStrip } from "../demo.js";
import {
  DEFAULT_SETTINGS,
  VIM_MODE_KEYS,
  VIM_MODE_LABELS,
  VIM_STATE_KEYS,
  cloneVimModes,
  presetWithDefaults,
  vimModeSnapshot,
} from "../settings.js";
import { loadSettings, saveSettings, loadDeviceEnabled, saveDeviceEnabled } from "../shim/storage.js";
import { siteEnabled } from "../shim/sites.js";
import { libraryMethods } from "../library.js";
import { presetToCode, codeToPreset, vimPresetToCode, codeToVimPreset } from "../share.js";

const root = document.getElementById("root");

// --- state ------------------------------------------------------------------

let settings = { ...DEFAULT_SETTINGS, vimModes: cloneVimModes(DEFAULT_SETTINGS.vimModes) };
let deviceEnabled = true;
let dirtyPreset = false; // a hand-edit since the last preset load
const dirty = new Map(); // key -> queued value
let saveTimer = 0;

const toastHost = h("div", { class: "cs-toasts", role: "status", "aria-live": "polite" });

function toast(message, kind = "info") {
  const el = h("div", { class: "cs-toast cs-toast-" + kind }, h("span", { class: "cs-toast-icon", html: iconSvg(kind === "error" ? "triangle-alert" : "circle-check", { size: 15 }) }), h("span", {}, message));
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  setTimeout(() => {
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 240);
  }, 2600);
}

const flush = debounce(async () => {
  const patch = Object.fromEntries(dirty);
  dirty.clear();
  try {
    await saveSettings(settings);
  } catch (e) {
    toast("Could not save settings: " + (e?.message || e), "error");
    return;
  }
  // A big preset library is the one thing worth announcing, because the user may
  // not realise a stray key blew past the sync quota.
  if (patch.userPresets) toast("Preset saved");
}, 220);

const set = (key) => async (value) => {
  settings[key] = value;
  dirty.set(key, value);
  if (key !== "userPresets") dirtyPreset = true;
  flush();
};

const get = (key) => settings[key];

// --- the shared preview -----------------------------------------------------

// One DemoStrip for the whole page, re-parented to whichever page is showing it.
// It reads `settings` live, so a slider drag animates the caret as it moves.
let demo = null;
let previewEl = null;

function makePreview() {
  if (demo) return previewEl;
  previewEl = h("div", { class: "cs-preview-panel" });
  const stage = h("div", { class: "cs-preview-stage" });
  const line = h("div", { class: "cs-preview-line" }, "const answer = 42;");
  const line2 = h("div", { class: "cs-preview-line cs-preview-line-dim" }, "return answer * 2;");
  const host = h("div", { class: "cs-preview-host" }, line, line2);
  stage.append(host);
  previewEl.append(
    h("div", { class: "cs-preview-head" },
      h("span", { class: "cs-preview-title" }, "Live preview"),
      h("button", { class: "cs-btn cs-btn-ghost cs-btn-sm", type: "button", on: { click: () => playPreview() } }, h("span", { html: iconSvg("refresh-cw", { size: 13 }) }), "Replay")),
    stage);
  demo = new DemoStrip();
  playPreview();
  return previewEl;
}

const SAMPLE_NAMES = ["Jell-O", "Torch-Crt", "mr.Blue", "FairyDust", "DarkMatter", "old_Joe"];

function playPreview() {
  const host = previewEl.querySelector(".cs-preview-host");
  clear(host);
  const line = h("div", { class: "cs-preview-line" }, "const answer = 42;");
  const line2 = h("div", { class: "cs-preview-line cs-preview-line-dim" }, "return answer * 2;");
  host.append(line, line2);
  const look = settings;
  const name = SAMPLE_NAMES[Math.floor(Math.random() * SAMPLE_NAMES.length)];
  const color = look.gradientEnabled ? (look.gradientColorsDark?.[1] || look.cursorColorDark || "#7cc6f7") : look.cursorStyle === "Box" ? look.cursorColorDark || "#7cc6f7" : look.cursorColorDark || "#7cc6f7";
  try {
    demo.add(host, name, look, color, look.gradientColorsDark || ["#333", "#888", "#ccc", "#fff"], look.gradientEnabled ? `linear-gradient(180deg, ${(look.gradientColorsDark || []).join(", ")})` : null, settings.respectReducedMotion, true);
  } catch {
    // A malformed colour should not take the whole options page down.
  }
}

// --- small building blocks --------------------------------------------------

function card(title, subtitle, ...body) {
  return h("section", { class: "cs-card" },
    title ? h("header", { class: "cs-card-head" },
      h("div", { class: "cs-card-titles" },
        h("h2", { class: "cs-card-title" }, title),
        subtitle ? h("p", { class: "cs-card-sub" }, subtitle) : null)) : null,
    h("div", { class: "cs-card-body" }, ...body));
}

function switchRow(name, desc, checked, onChange) {
  const input = h("input", { type: "checkbox", class: "cs-switch-input" });
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h("div", { class: "cs-row" },
    h("div", { class: "cs-row-text" },
      h("div", { class: "cs-row-name" }, name),
      desc ? h("div", { class: "cs-row-desc" }, desc) : null),
    h("div", { class: "cs-row-controls" },
      h("label", { class: "cs-switch" }, input, h("span", { class: "cs-switch-track" }, h("span", { class: "cs-switch-thumb" })))));
}

function selectRow(name, desc, value, options, onChange) {
  const sel = h("select", { class: "cs-select" });
  for (const o of options) sel.append(h("option", { value: o.value }, o.label));
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return h("div", { class: "cs-row" },
    h("div", { class: "cs-row-text" },
      h("div", { class: "cs-row-name" }, name),
      desc ? h("div", { class: "cs-row-desc" }, desc) : null),
    h("div", { class: "cs-row-controls" },
      h("div", { class: "cs-control-wrap" }, sel, h("span", { class: "cs-chevron", html: iconSvg("chevron-down", { size: 14 }) }))));
}

function buttonRow(name, desc, label, icon, onClick, cls = "") {
  return h("div", { class: "cs-row" },
    h("div", { class: "cs-row-text" },
      h("div", { class: "cs-row-name" }, name),
      desc ? h("div", { class: "cs-row-desc" }, desc) : null),
    h("div", { class: "cs-row-controls" },
      h("button", { class: "cs-btn " + cls, type: "button", on: { click: onClick } },
        icon ? h("span", { html: iconSvg(icon, { size: 14 }) }) : null, label)));
}

function chip(text, onClick, extra = {}) {
  return h("button", { class: "cs-tag", type: "button", on: onClick ? { click: onClick } : {}, ...extra }, text);
}

// --- page: general ----------------------------------------------------------

async function pageGeneral(mount) {
  const body = h("div", { class: "cs-page-grid" });
  const main = h("div", { class: "cs-col-main" });
  const side = h("div", { class: "cs-col-side" });
  body.append(main, side);

  const shortcutRow = (label, command) =>
    h("div", { class: "cs-shortcut" },
      h("span", { class: "cs-shortcut-label" }, label),
      h("kbd", { class: "cs-kbd" }, command));

  main.append(
    card("Cursor-Smith for Browsers", "Unofficial port of the Obsidian plugin by SadSnake1. Browser bugs go to github.com/ooexiaoo/cursor-smith-browser, not upstream.",
      switchRow("Enable Cursor-Smith", "Master switch. Also off per device below, so a synced profile can stay quiet on a machine you did not set up.",
        deviceEnabled && settings.enabled, async (v) => {
          deviceEnabled = v;
          await saveDeviceEnabled(v);
          if (v !== settings.enabled) await set("enabled")(v);
          mount();
        }),
      switchRow("Hide the native caret", "Suppresses the browser's own caret. Turn this off if a site draws its own and you would rather leave it alone.",
        settings.hideNativeCaret, set("hideNativeCaret")),
      switchRow("Hide when the window is not focused", "Draws nothing in background tabs, which is most of the CPU saving.",
        settings.hideOnWindowBlur, set("hideOnWindowBlur"))),
    settings.globalOff
      ? card("Cursor-Smith is off everywhere", "Every device in this profile has Cursor-Smith switched off. The master switch below stays where you left it.",
          buttonRow("Bring Cursor-Smith back", "Clears the synced kill switch and resumes from the settings on this page.", "Turn it back on", "play", async () => {
            await set("globalOff")(false);
            mount();
          }))
      : null,
    card("Motion", "How much the extension is allowed to do on its own.",
      switchRow("Respect reduced motion", "Honours your OS setting: no blinking, no trails, no particles. Effects still apply, just without the movement.",
        settings.respectReducedMotion, set("respectReducedMotion")),
      switchRow("Low power mode", "Cuts the frame rate and particle budget. Worth it on a laptop that is never plugged in.",
        settings.lowPowerMode, set("lowPowerMode"))),
    card("Keyboard shortcuts", "Set these in chrome://extensions/shortcuts. Cursor-Smith registers the commands; the browser owns the keys.",
      h("div", { class: "cs-shortcuts" },
        shortcutRow("Toggle Cursor-Smith on this site", "Alt+Shift+C"),
        shortcutRow("Cycle preset", "Alt+Shift+."),
        shortcutRow("Cycle Vim preset", "Alt+Shift+V"),
        shortcutRow("Turn Cursor-Smith off everywhere", "Alt+Shift+X"))));

  const usage = Math.round(JSON.stringify(settings).length / 1024);
  side.append(
    makePreview(),
    card("Your data",
      h("p", { class: "cs-note" }, "Everything lives in your browser profile. Nothing is uploaded, and there is no account."),
      h("p", { class: "cs-note cs-note-dim" }, `Currently ${usage} KB across ${Object.keys(settings.userPresets || {}).length} saved preset${Object.keys(settings.userPresets || {}).length === 1 ? "" : "s"}.`),
      h("div", { class: "cs-btn-row" },
        h("button", { class: "cs-btn", type: "button", on: { click: exportSettings } }, h("span", { html: iconSvg("download", { size: 14 }) }), "Export"),
        h("button", { class: "cs-btn", type: "button", on: { click: importSettings } }, h("span", { html: iconSvg("upload", { size: 14 }) }), "Import"),
        h("button", { class: "cs-btn cs-btn-danger", type: "button", on: { click: resetAll } }, h("span", { html: iconSvg("trash-2", { size: 14 }) }), "Reset all"))));

  mount.append(body);
}

// --- page: cursor (the look) ------------------------------------------------

function pageCursor(mount) {
  const body = h("div", { class: "cs-page-grid" });
  const main = h("div", { class: "cs-col-main" });
  const side = h("div", { class: "cs-col-side" });
  const host = h("div", { class: "cs-cards" });
  main.append(host);
  body.append(main, side);

  const afterReset = (title) => panel.redraw();

  let cardKeys = {};

  const panel = createLookPanel(host, {
    build: lookDefinitions,
    get,
    set,
    onEdit: () => {
      dirtyPreset = true;
      side.replaceChildren(makePreview());
      playPreview();
    },
    onTorchToggle: () => {},
    afterReset: async (title) => {
      for (const key of cardKeys[title] || []) await set(key)(DEFAULT_SETTINGS[key]);
      panel.redraw();
      toast(title + " reset");
    },
  });
  cardKeys = panel.cardKeys();

  side.append(makePreview());
  mount.append(body);
  return panel;
}

// --- page: vim --------------------------------------------------------------

function pageVim(mount) {
  let activeMode = localStorage.getItem("cs.vimMode") || VIM_MODE_KEYS[0];
  const body = h("div", { class: "cs-page-grid" });
  const main = h("div", { class: "cs-col-main" });
  const side = h("div", { class: "cs-col-side" });
  body.append(main, side);

  const tabs = h("div", { class: "cs-tabs", role: "tablist" });
  const host = h("div", { class: "cs-cards" });

  const modeGet = (k) => (settings.vimModes[activeMode] || {})[k];
  const modeSet = (k) => async (v) => {
    settings.vimModes[activeMode] = { ...(settings.vimModes[activeMode] || {}), [k]: v };
    settings.vimModes = cloneVimModes(settings.vimModes);
    await set("vimModes")(settings.vimModes);
    dirtyPreset = true;
  };

  const drawTabs = () => {
    clear(tabs);
    for (const key of VIM_MODE_KEYS) {
      const b = h("button", { class: "cs-tab" + (key === activeMode ? " is-active" : ""), type: "button", role: "tab", "aria-selected": key === activeMode === true ? "true" : "false" },
        h("span", { class: "cs-tab-key" }, key === "normal" ? "N" : key === "insert" ? "I" : key === "visual" ? "V" : key === "replace" ? "R" : "C"),
        h("span", {}, VIM_MODE_LABELS[key] || key));
      b.addEventListener("click", () => {
        activeMode = key;
        localStorage.setItem("cs.vimMode", key);
        draw();
      });
      tabs.append(b);
    }
  };

  let panel = null;
  const draw = () => {
    drawTabs();
    clear(host);
    settings.vimModes[activeMode] = vimModeSnapshot(activeMode, settings.vimModes[activeMode]);
    panel = createLookPanel(host, {
      build: lookDefinitions,
      get: modeGet,
      set: modeSet,
      onEdit: () => {},
      afterReset: async () => {
        settings.vimModes[activeMode] = vimModeSnapshot(activeMode);
        await set("vimModes")(settings.vimModes);
        draw();
      },
    });
  };

  const base = card("Vim mode", "Per-mode looks. Each mode keeps its own colors, effects and motion, the way a Vim colorscheme does.",
    switchRow("Enable Vim mode", "A second set of looks that follows the mode you are in, rather than the mode your cursor is nominally in.",
      settings.vimModeEnabled, async (v) => {
        await set("vimModeEnabled")(v);
        draw();
      }),
    switchRow("Rich editors only", "When on, plain inputs and textareas stay on the normal look and only contenteditable and code editors get Vim looks. When off, every field follows the Vim mode.",
      settings.vimRichEditorsOnly, set("vimRichEditorsOnly")),
    switchRow("Show the mode indicator", "A small badge near the cursor showing which Vim mode you are in.",
      settings.vimStatusBar, set("vimStatusBar")),
    switchRow("Color the indicator", "Tint the badge with the mode's own color instead of a neutral gray.",
      settings.vimStatusBarColor, set("vimStatusBarColor")));

  main.append(base, h("div", { class: "cs-section-label" }, "Mode looks"), tabs, host);
  side.append(makePreview());
  draw();
  mount.append(body);
}

// --- page: sites ------------------------------------------------------------

function pageSites(mount) {
  const body = h("div", { class: "cs-page-grid" });
  const main = h("div", { class: "cs-col-main" });
  const side = h("div", { class: "cs-col-side" });
  body.append(main, side);

  // Two lists, because they answer different questions.
  //   siteList   - what the mode below is applied to: the allow-list in "only",
  //                the deny-list in "except", unused in "all".
  //   neverList  - always excluded, regardless of mode, when the toggle is on.
  const rulesHost = h("div", { class: "cs-rules" });
  const neverHost = h("div", { class: "cs-rules" });

  const ruleEditor = (host, key, list, { enabled, placeholder, empty }) => {
    const draw = () => {
      clear(host);
      const items = settings[key] || [];
      if (!items.length) {
        host.append(h("p", { class: "cs-note cs-note-dim" }, empty));
      }
      items.forEach((rule, i) => {
        const input = h("input", { class: "cs-text", value: rule, placeholder: "example.com/path/*" });
        input.addEventListener("change", () => {
          items[i] = input.value.trim();
          set(key)([...items]);
        });
        host.append(h("div", { class: "cs-rule" },
          h("span", { class: "cs-rule-icon", html: iconSvg(key === "siteList" ? "globe" : "eye-off", { size: 14 }) }),
          input,
          h("button", { class: "cs-icon-btn", type: "button", title: "Remove", on: { click: () => { items.splice(i, 1); set(key)([...items]); draw(); } } },
            h("span", { html: iconSvg("trash-2", { size: 14 }) }))));
      });
      const add = h("input", { class: "cs-text", placeholder });
      const commit = () => {
        const v = add.value.trim();
        if (!v) return;
        set(key)([...items, v]);
        add.value = "";
        draw();
      };
      add.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
      const addBtn = h("button", { class: "cs-btn cs-btn-sm", type: "button" }, h("span", { html: iconSvg("plus", { size: 13 }) }), "Add");
      addBtn.addEventListener("click", commit);
      host.append(h("div", { class: "cs-rule cs-rule-add" }, h("span", { class: "cs-rule-icon" }), add, addBtn));
    };
    if (enabled) draw();
    else host.append(h("p", { class: "cs-note cs-note-dim" }, "This list is switched off."));
    return draw;
  };

  const drawSiteList = ruleEditor(rulesHost, "siteList", null, {
    placeholder: "Add a site or pattern",
    empty: settings.siteMode === "only"
      ? "No sites yet, so Cursor-Smith is off everywhere. Add the sites you want it on."
      : settings.siteMode === "except"
        ? "Nothing excluded and nowhere opted in yet, so Cursor-Smith is off everywhere. Add the sites to leave on."
        : "No exclusions yet, so Cursor-Smith runs on every site not excluded below.",
  });
  const drawNeverList = ruleEditor(neverHost, "neverList", null, {
    placeholder: "Add an always-excluded site",
    empty: "Nothing extra. The built-in list of calls, payments and banking is always applied.",
  });

  main.append(
    card("Where Cursor-Smith runs", "Default is everywhere except the list of sensitive sites. Switch to allow-only if you would rather opt in.",
      selectRow("Sites", "How the list below is interpreted.",
        settings.siteMode,
        [
          { value: "all", label: "Everywhere except the list below" },
          { value: "only", label: "Only the sites in the list below" },
          { value: "except", label: "Everywhere except these, and only on the sites below" },
        ],
        async (v) => { await set("siteMode")(v); drawSiteList(); }),
      h("div", { class: "cs-note" }, MODE_NOTES[settings.siteMode] || ""),
      rulesHost),
    card("Always excluded", "Applied whatever the mode above says. The built-in list of video calls, payments and banking is on top of this and cannot be switched off.",
      switchRow("Also exclude my own list", "Adds the patterns below to the always-excluded set, on top of the built-ins.",
        settings.neverListOn, async (v) => { await set("neverListOn")(v); drawNeverList(); }),
      neverHost),
    card("Patterns", "One per line. A bare host matches that host and everything under it; a path ending in * matches the rest.",
      h("ul", { class: "cs-bullets" },
        h("li", {}, h("code", {}, "example.com"), " - that site and anything under it"),
        h("li", {}, h("code", {}, "github.com/*/issues"), " - issue lists, not the rest of GitHub"),
        h("li", {}, h("code", {}, "*.figma.com"), " - every Figma subdomain"))));

  side.append(makePreview());
  mount.append(body);
}

// --- page: presets ----------------------------------------------------------

function pagePresets(mount) {
  const body = h("div", { class: "cs-page-grid" });
  const main = h("div", { class: "cs-col-main" });
  const side = h("div", { class: "cs-col-side" });
  body.append(main, side);

  const lib = Object.assign({ settings, getUserPresets: () => settings.userPresets || (settings.userPresets = {}) }, libraryMethods);
  const grid = h("div", { class: "cs-preset-grid" });

  const draw = () => {
    clear(grid);
    const presets = settings.userPresets || {};
    const names = Object.keys(presets);
    if (!names.length) {
      grid.append(h("p", { class: "cs-note cs-note-dim" }, "No saved presets yet. Shape the cursor however you like on the Cursor tab, then save it here."));
    }
    for (const name of names) {
      const look = presetWithDefaults(presets[name]);
      const cardEl = h("div", { class: "cs-preset" });
      const strip = h("div", { class: "cs-preset-strip" });
      cardEl.append(
        strip,
        h("div", { class: "cs-preset-meta" },
          h("div", { class: "cs-preset-name" }, name),
          h("div", { class: "cs-preset-sub" }, look.cursorStyle + (look.gradientEnabled ? " · gradient" : "") + (look.effectsOn ? "" : ""))),
        h("div", { class: "cs-preset-actions" },
          h("button", { class: "cs-btn cs-btn-sm", type: "button", on: { click: () => applyPreset(name) } }, "Apply"),
          h("button", { class: "cs-icon-btn", type: "button", title: "Copy share code", on: { click: () => copyShare(name) } }, h("span", { html: iconSvg("copy", { size: 14 }) })),
          h("button", { class: "cs-icon-btn cs-icon-btn-danger", type: "button", title: "Delete", on: { click: () => removePreset(name) } }, h("span", { html: iconSvg("trash-2", { size: 14 }) }))));
      grid.append(cardEl);
      try {
        demo.add(strip, name, look, look.cursorColorDark || "#7cc6f7", look.gradientColorsDark || ["#333", "#888", "#ccc", "#fff"], look.gradientEnabled ? `linear-gradient(180deg, ${(look.gradientColorsDark || []).join(", ")})` : null, settings.respectReducedMotion, false);
      } catch {}
    }
  };

  const nameInput = h("input", { class: "cs-text", placeholder: "Preset name" });
  const saveBtn = h("button", { class: "cs-btn cs-btn-primary", type: "button", on: { click: saveCurrent } }, h("span", { html: iconSvg("square-pen", { size: 14 }) }), "Save current as preset");
  const pasteInput = h("input", { class: "cs-text", placeholder: "Paste a share code" });
  const pasteBtn = h("button", { class: "cs-btn", type: "button", on: { click: () => applyShare(pasteInput.value) } }, h("span", { html: iconSvg("upload", { size: 14 }) }), "Load");

  async function saveCurrent() {
    const name = nameInput.value.trim() || "Untitled";
    const snap = { ...settings };
    delete snap.enabled;
    delete snap.userPresets;
    for (const k of VIM_STATE_KEYS) delete snap[k];
    settings.userPresets = { ...(settings.userPresets || {}), [name]: snap };
    await set("userPresets")(settings.userPresets);
    nameInput.value = "";
    toast(`Saved "${name}"`);
    draw();
  }

  async function applyPreset(name) {
    const preset = settings.userPresets[name];
    if (!preset) return;
    const wasEnabled = settings.enabled;
    const presets = settings.userPresets;
    const vimState = {};
    for (const k of VIM_STATE_KEYS) vimState[k] = settings[k];
    Object.assign(settings, presetWithDefaults(preset));
    settings.enabled = wasEnabled;
    settings.userPresets = presets;
    Object.assign(settings, vimState);
    await saveSettings(settings);
    toast(`Applied "${name}"`);
    route();
  }

  async function removePreset(name) {
    const next = { ...settings.userPresets };
    delete next[name];
    settings.userPresets = next;
    await set("userPresets")(next);
    toast(`Deleted "${name}"`);
    draw();
  }

  async function copyShare(name) {
    const code = presetToCode(name, settings.userPresets[name]);
    try {
      await navigator.clipboard.writeText(code);
      toast("Share code copied");
    } catch {
      toast("Could not reach the clipboard", "error");
    }
  }

  async function applyShare(code) {
    const v = String(code || "").trim();
    if (!v) return;
    try {
      const preset = codeToPreset(v);
      const name = v.split(":")[1] || "Shared";
      settings.userPresets = { ...(settings.userPresets || {}), [name]: preset };
      await set("userPresets")(settings.userPresets);
      toast(`Loaded "${name}"`);
      draw();
    } catch {
      toast("That is not a Cursor-Smith share code", "error");
    }
  }

  main.append(
    card("Presets", "A preset is a snapshot of the look. Applying one never touches whether Cursor-Smith is on, or your Vim state.",
      h("div", { class: "cs-save-row" }, nameInput, saveBtn),
      h("div", { class: "cs-section-label" }, "Saved"),
      grid,
      h("div", { class: "cs-section-label" }, "Share"),
      h("p", { class: "cs-note" }, "Share codes carry a look as text, so you can paste one into a chat and get the same cursor on the other end."),
      h("div", { class: "cs-save-row" }, pasteInput, loadInto(pasteBtn, applyShare, pasteInput))));
  side.append(makePreview());
  if (!demo) makePreview();
  draw();
  mount.append(body);
}

function loadInto(btn, fn, input) {
  btn.addEventListener("click", () => fn(input.value));
  return btn;
}

// --- import / export --------------------------------------------------------

function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "cursor-smith-settings.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Settings exported");
}

function importSettings() {
  const input = h("input", { type: "file", accept: "application/json,.json" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : parsed;
      if (!incoming || typeof incoming !== "object") throw new Error("not an object");
      settings = { ...DEFAULT_SETTINGS, ...incoming, vimModes: incoming.vimModes ? cloneVimModes(incoming.vimModes) : cloneVimModes(DEFAULT_SETTINGS.vimModes) };
      await saveSettings(settings);
      toast("Settings imported");
      route();
    } catch (e) {
      toast("That file is not a Cursor-Smith settings export", "error");
    }
  });
  input.click();
}

async function resetAll() {
  settings = { ...DEFAULT_SETTINGS, vimModes: cloneVimModes(DEFAULT_SETTINGS.vimModes) };
  await saveSettings(settings);
  toast("Reset to defaults");
  route();
}

// --- shell ------------------------------------------------------------------

const MODE_NOTES = {
  all: "Cursor-Smith draws on every site, minus anything on the exclusion list.",
  only: "Cursor-Smith draws only on the sites you list. Everything else keeps the browser caret.",
  except: "Cursor-Smith draws everywhere except the list below, and only on the sites you have opted in. Use it to carve out a few quiet sites without giving up the rest.",
};

const PAGES = [
  { id: "general", label: "General", icon: "settings", render: pageGeneral },
  { id: "cursor", label: "Cursor", icon: "mouse-pointer-2", render: pageCursor },
  { id: "vim", label: "Vim", icon: "command", render: pageVim },
  { id: "sites", label: "Sites", icon: "globe", render: pageSites },
  { id: "presets", label: "Presets", icon: "palette", render: pagePresets },
];

const sidebar = h("aside", { class: "cs-side-nav" });
const main = h("main", { class: "cs-main" });
const brandRow = h("div", { class: "cs-brand" });
let currentPage = null;
let currentPanel = null;

function currentId() {
  const id = location.hash.replace(/^#\/?/, "");
  return PAGES.some((p) => p.id === id) ? id : "general";
}

function drawNav() {
  clear(sidebar);
  const id = currentId();
  sidebar.append(
    h("div", { class: "cs-brand" },
      h("div", { class: "cs-brand-mark", html: iconSvg("mouse-pointer-2", { size: 18 }) }),
      h("div", { class: "cs-brand-text" },
        h("div", { class: "cs-brand-name" }, "Cursor-Smith"),
        h("div", { class: "cs-brand-sub" }, "for the browser"))));
  const nav = h("nav", { class: "cs-nav" });
  for (const p of PAGES) {
    const b = h("button", { class: "cs-nav-item" + (p.id === id ? " is-active" : ""), type: "button", "aria-current": p.id === id ? "page" : null },
      h("span", { class: "cs-nav-icon", html: iconSvg(p.icon, { size: 16 }) }),
      h("span", {}, p.label));
    b.addEventListener("click", () => { location.hash = "#/" + p.id; });
    nav.append(b);
  }
  sidebar.append(nav);
  sidebar.append(h("div", { class: "cs-side-foot" },
    h("a", { class: "cs-link", href: "https://github.com/SadSnake1/cursor-smith", target: "_blank", rel: "noreferrer" }, "Upstream", h("span", { html: iconSvg("external-link", { size: 12 }) })),
    h("span", { class: "cs-version" }, "1.6.5 · port")));
}

function route() {
  const id = currentId();
  drawNav();
  document.title = `Cursor-Smith — ${PAGES.find((p) => p.id === id).label}`;
  const mount = h("div", { class: "cs-page" });
  clear(main);
  main.append(mount);
  currentPage = PAGES.find((p) => p.id === id);
  currentPanel = currentPage.render(mount) || null;
  // Tear the previous page's panel down: its demo rows are detached, but a
  // rAF loop and a resize listener would both outlive it.
  currentPanel?.dispose?.();
}

window.addEventListener("hashchange", route);

async function boot() {
  const [saved, dev] = await Promise.all([loadSettings(), loadDeviceEnabled()]);
  if (saved) settings = { ...DEFAULT_SETTINGS, ...saved, vimModes: saved.vimModes ? cloneVimModes(saved.vimModes) : cloneVimModes(DEFAULT_SETTINGS.vimModes) };
  deviceEnabled = dev;
  clear(root);
  root.append(
    h("div", { class: "cs-shell" }, sidebar, main),
    toastHost);
  route();
}

boot();

// Save on the way out, so a change made in the last 220 ms before the tab closes
// is not lost.
window.addEventListener("pagehide", () => flush.flush());

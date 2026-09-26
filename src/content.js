// Content script entry.
//
// Runs the engine in the page, wires the browser's lifecycle to the plugin's
// Obsidian-shaped one, and injects the stylesheet. The engine itself is
// unchanged in shape: construct it, onload(), hand it a document.
//
// A hot reload replaces the content script WITHOUT reloading the page, so the
// previous instance is torn down first - otherwise its canvas, stylesheet and
// listeners survive into the next run.

import { CursorSmithPlugin } from "./core.js";
import { disposeHost } from "./shim/host.js";
// Side effect on purpose: the engine calls Obsidian's DOM helpers, so they have
// to exist before it constructs anything.
import "./shim/dom.js";

const STYLE_ID = "cursor-smith-browsers-css";
const GLOBAL_KEY = "__cursorSmithInstance";

function injectStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const link = doc.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("cursor-smith.css");
  (doc.head || doc.documentElement).appendChild(link);
}

function teardown() {
  const prev = globalThis[GLOBAL_KEY];
  if (!prev) return;
  globalThis[GLOBAL_KEY] = null;
  try {
    prev.onunload();
  } catch (e) {
    console.error("[cursor-smith] previous instance did not stop cleanly:", e);
  }
  try {
    disposeHost();
  } catch {
    // The previous build may predate the host facade.
  }
}

teardown();

const plugin = new CursorSmithPlugin();
globalThis[GLOBAL_KEY] = plugin;


if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    injectStyles(document);
    void plugin.onload();
  }, { once: true });
} else {
  injectStyles(document);
  void plugin.onload();
}

window.addEventListener("pagehide", () => teardown(), { once: true });

// Keyboard shortcuts and the popup both arrive here: the background page holds
// no engine, so a command is a message to whichever tab asked for it.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "cursor-smith:command") {
    const run = plugin._commands?.[msg.command];
    if (!run) {
      sendResponse({ ok: false, reason: "unknown command" });
      return true;
    }
    run();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "cursor-smith:shutdown") {
    teardown();
    document.getElementById(STYLE_ID)?.remove();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

// The host facade.
//
// The upstream engine is written against Obsidian's `this.app`, in 29 places,
// and most of them are incidental: "give me the focused editor", "tell me when
// the window resized", "am I in a presentation". Rather than rewrite those call
// sites and risk the engine's carefully-sequenced teardown, the extension
// supplies an object with the same shape and answers from the browser instead.
//
// Deliberately small. Anything the engine asks for that the web has no honest
// equivalent for returns a benign default rather than a plausible-looking lie.

import { activeView } from "./dom-view.js";
import { loadDeviceEnabled, saveDeviceEnabled } from "./storage.js";

class FakeView {
  constructor(type) {
    this._type = type;
  }
  getViewType() {
    return this._type;
  }
}

class Workspace {
  // Obsidian's activeEditor.editor.cm, which is how the engine reaches the
  // focused text document. There is no workspace here - there is a focus.
  get activeEditor() {
    const cm = activeView();
    return cm ? { editor: { cm } } : null;
  }

  getActiveViewOfType() {
    return null;
  }

  on(event, cb) {
    return subscribeWorkspaceEvent(event, cb);
  }

  onLayoutReady(cb) {
    // Everything this engine gates on "the app has finished loading" is really
    // "the document is interactive", which for a content script is now.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => cb(), { once: true });
    } else {
      queueMicrotask(cb);
    }
    return { unload: () => {} };
  }

  iterateAllLeaves(cb) {
    const cm = activeView();
    if (cm) cb(cm);
  }

  updateOptions() {}
}

class Vault {
  // Upstream this flips Obsidian's own vim plugin. In a browser the nearest
  // honest equivalent is our own vim state, so read and write that.
  setConfig(key, value) {
    if (key === "vimMode") siteVimMode = !!value;
  }
  getConfig(key) {
    if (key === "vimMode") return siteVimMode;
    return null;
  }
}

let siteVimMode = false;

const unsub = new Set();

// The engine's `workspace.on(...)` list is four style/layout invalidations and
// a window-close. Map them onto the events a document actually emits.
function subscribeWorkspaceEvent(event, cb) {
  let handler = null;
  let target = window;
  let type = event;
  switch (event) {
    case "css-change":
      handler = () => cb();
      break;
    case "layout-change":
      handler = () => cb();
      break;
    case "active-leaf-change":
      handler = () => cb();
      target = document;
      type = "selectionchange";
      break;
    case "resize":
      handler = () => cb();
      break;
    case "window-close":
      return { unload: () => {} };
    default:
      return { unload: () => {} };
  }
  target.addEventListener(type, handler, { passive: true });
  const entry = { target, type, handler };
  unsub.add(entry);
  return {
    unload() {
      target.removeEventListener(type, handler);
      unsub.delete(entry);
    },
  };
}

export function disposeHost() {
  for (const e of unsub) e.target.removeEventListener(e.type, e.handler);
  unsub.clear();
}

export const app = {
  workspace: new Workspace(),
  vault: new Vault(),
  lastEvent: null,
  loadLocalStorage: async (key) => {
    if (key === "cursor-smith-enabled-on-this-device") return (await loadDeviceEnabled()) ? null : "off";
    return null;
  },
  saveLocalStorage: async (key, value) => {
    if (key === "cursor-smith-enabled-on-this-device") await saveDeviceEnabled(value !== "off");
  },
  keymap: {},
  scope: {},
  FileView: FakeView,
  MarkdownView: FakeView,
};

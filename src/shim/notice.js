// Obsidian's Notice, as a toast.
//
// The engine raises these for things the user should know about but should not
// be interrupted by: preset cycled, mode switched, performance report done.
// Same contract - fire and forget, auto-dismiss, stack without overlap - in the
// page's own corner so it reads as part of the site rather than as chrome.

const HOLD_MS = 2600;
const MAX_VISIBLE = 3;
let host = null;

function ensureHost(doc) {
  if (host && host.isConnected) return host;
  host = doc.createElement("div");
  host.className = "cursor-smith-toasts";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  (doc.body || doc.documentElement).appendChild(host);
  return host;
}

export class Notice {
  constructor(message, timeout = HOLD_MS) {
    try {
      const doc = document;
      const root = ensureHost(doc);
      while (root.childElementCount >= MAX_VISIBLE) root.firstElementChild?.remove();

      const el = doc.createElement("div");
      el.className = "cursor-smith-toast";
      el.textContent = String(message);
      root.appendChild(el);

      requestAnimationFrame(() => el.classList.add("is-in"));
      const kill = () => {
        el.classList.remove("is-in");
        el.addEventListener("transitionend", () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 400);
      };
      const timer = setTimeout(kill, Math.max(500, timeout));
      el.addEventListener("click", () => {
        clearTimeout(timer);
        kill();
      });
    } catch {
      // A toast is never worth an exception.
    }
  }

  setMessage(message) {
    if (this.el) this.el.textContent = String(message);
    return this;
  }

  hide() {
    this.el?.remove();
  }
}

// Present so that any leftover call site resolves; the extension draws its own
// icons as inline SVG rather than through an icon registry.
export function addIcon() {}
export function setIcon(el) {
  el.textContent = "";
}
export class View {}
export class Modal {}
export class PluginSettingTab {}
export class Setting {}

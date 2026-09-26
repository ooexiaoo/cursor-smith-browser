// Obsidian's DOM helpers, for the engine's use on real web pages.
//
// The engine was written against Obsidian, which extends the DOM prototypes with
// createDiv/createEl/setCssStyles and friends. On a real page those do not exist,
// so the canvas container threw `createDiv is not a function` and the extension
// did nothing at all. This installs the handful the engine actually calls.
//
// Two rules keep this safe on someone else's site:
//
//   * Never replace a method that already exists. A page that defines its own
//     createDiv keeps it, and we do not break it.
//   * Patch per realm, not globally. A canvas drawn into an iframe's document
//     needs that realm's prototypes, and reaching across realms with a single
//     patched prototype does not work.

const PATCHED = Symbol.for("cursor-smith.dom-patched");

// Obsidian accepts { cls, text, attr, title, ... } and ignores the rest.
// The new element is appended to the parent, which is the whole point of the
// `appContainer.createEl(...)` shape the engine uses.
function build(parent, tag, o, callback) {
  const opts = typeof o === "string" ? { cls: o } : o || {};
  const node = parent.ownerDocument.createElement(tag);

  if (opts.cls) {
    const list = Array.isArray(opts.cls) ? opts.cls : String(opts.cls).split(/\s+/);
    for (const c of list) if (c) node.classList.add(c);
  }
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.title !== undefined) node.title = opts.title;
  if (opts.attr) {
    for (const [k, v] of Object.entries(opts.attr)) {
      if (v === null || v === false) node.removeAttribute(k);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  parent.appendChild(node);
  if (callback) callback(node);
  return node;
}

const DEFS = {
  // createEl(tag, opts?, callback?), but also tolerates createEl(opts) and
  // createEl(tag) since the engine uses both shapes.
  createEl: {
    value(tag, o, callback) {
      if (tag && typeof tag === "object") {
        callback = o;
        o = tag;
        tag = o.tag ?? "div";
      }
      return build(this, tag ?? "div", o, callback);
    },
  },
  createDiv: {
    value(o, callback) {
      return build(this, "div", o, callback);
    },
  },
  createSpan: {
    value(o, callback) {
      return build(this, "span", o, callback);
    },
  },
  // Obsidian's signature: the element itself is appended to the parent. That is
  // why the engine can write `appContainer.createDiv(...)` and get a child back.
  setCssStyles: {
    value(styles) {
      for (const [k, v] of Object.entries(styles || {})) {
        if (v === null || v === undefined) this.style.removeProperty(k);
        else this.style.setProperty(k, String(v));
      }
      return this;
    },
  },
  addClass: {
    value(...classes) {
      for (const c of classes.flat()) if (c) this.classList.add(c);
      return this;
    },
  },
  removeClass: {
    value(...classes) {
      for (const c of classes.flat()) if (c) this.classList.remove(c);
      return this;
    },
  },
  toggleClass: {
    value(classes, value) {
      for (const c of classes.flat()) if (c) this.classList.toggle(c, value);
      return this;
    },
  },
  hasClass: {
    value(cls) {
      return this.classList.contains(cls);
    },
  },
  setText: {
    value(val) {
      this.textContent = val == null ? "" : String(val);
      return this;
    },
  },
  setAttr: {
    value(name, value) {
      if (value === null || value === false) this.removeAttribute(name);
      else this.setAttribute(name, value === true ? "" : String(value));
      return this;
    },
  },
  appendText: {
    value(val) {
      this.appendChild(this.ownerDocument.createTextNode(String(val)));
      return this;
    },
  },
  empty: {
    value() {
      this.replaceChildren();
      return this;
    },
  },
  detach: {
    value() {
      this.remove();
      return this;
    },
  },
};

// Install into one realm. Safe to call repeatedly.
export function patchRealm(win) {
  const Element_ = win?.Element?.prototype;
  const Node_ = win?.Node?.prototype;
  if (!Element_ || Element_[PATCHED]) return;
  Object.defineProperty(Element_, PATCHED, { value: true });
  for (const [name, desc] of Object.entries(DEFS)) {
    if (name in Element_) continue; // the page has its own; leave it alone
    Object.defineProperty(Element_, name, { ...desc, configurable: true, writable: true });
  }
  if (Node_ && !("detach" in Node_)) {
    Object.defineProperty(Node_, "detach", { ...DEFS.detach, configurable: true, writable: true });
  }
}

// Patch whichever realm a document belongs to. The engine draws into iframes
// as well as the top frame, and a canvas in a foreign document needs that
// document's own prototypes, not ours.
export function prepareDocument(doc) {
  patchRealm(doc?.defaultView || doc?.ownerDocument?.defaultView);
  return doc;
}

// The realm the content script itself runs in.
patchRealm(globalThis);

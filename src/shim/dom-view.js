// A CodeMirror-6-shaped view over whatever text host the browser currently has
// focused.
//
// The upstream engine reaches for CodeMirror because Obsidian is built on it.
// On the web the interesting targets are the same idea wearing different
// clothes: CodeMirror 6 sites, Monaco, and plain <textarea>/<input> forms. So
// rather than nulling out the CM branches we give them a view that answers the
// same small API surface, and every measurement path in the engine keeps
// working instead of falling back to the cruder generic one.
//
// Implemented subset (everything the engine actually reads):
//   hasFocus, dom, contentDOM, contentEl, containerEl, scrollDOM,
//   defaultCharacterWidth,
//   state.doc            { length, sliceString, toString }  (stable identity)
//   state.selection      { main, mainIndex, ranges }
//   state.overwrite,
//   coordsAtPos(pos, side), domAtPos(pos)

import { prepareDocument } from "./dom.js";

const isTextControl = (el) =>
  !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|url|email|tel|password|number)$/i.test(el.type)));

const isContentEditable = (el) => {
  if (!el || !el.isContentEditable) return false;
  // Guard against the engine's own overlays, which are contenteditable=false
  // but sit inside editable subtrees on some sites.
  return !el.closest?.("[contenteditable='false']");
};

export const isTextHost = (el) => isTextControl(el) || isContentEditable(el);

// Nearest ancestor that actually scrolls, which is what the engine wants to
// watch for caret-clip changes.
const scrollParent = (el) => {
  let node = el;
  while (node && node.parentElement) {
    node = node.parentElement;
    const cs = getComputedStyle(node);
    const oy = cs.overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement || document.documentElement;
};

// Document-order walk that maps a flat character offset onto a DOM point. The
// engine's positions are document offsets, which is exactly what a text-node
// walk produces.
function pointAt(root, pos) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let seen = 0;
  let last = null;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (seen + len >= pos) return { node, offset: pos - seen };
    seen += len;
    last = node;
  }
  if (last) return { node: last, offset: last.nodeValue.length };
  return { node: root, offset: 0 };
}

function offsetOf(root, node, offset) {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return total + offset;
    total += n.nodeValue.length;
  }
  return total;
}

class DocSnapshot {
  constructor(text) {
    this.text = text;
    this.length = text.length;
  }
  sliceString(from, to) {
    return this.text.slice(from, to);
  }
  toString() {
    return this.text;
  }
}

export class DomView {
  constructor(host) {
    this.dom = host;
    this.contentDOM = host;
    this.contentEl = host;
    this.containerEl = host.parentElement || host;
    this.scrollDOM = scrollParent(host);
    this._doc = null;
    this._docText = null;
    this._charW = 0;
    this._mirror = null;
  }

  // Live rather than cached: the engine reads this every frame, and a stale
  // "true" would keep drawing a caret over an editor the user has left.
  get hasFocus() {
    const a = this.dom.ownerDocument.activeElement;
    return a === this.dom || !!(a && this.dom.contains && this.dom.contains(a));
  }

  get _isControl() {
    return isTextControl(this.dom);
  }

  get _rawText() {
    const el = this.dom;
    if (isTextControl(el)) return el.value ?? "";
    return el.textContent ?? "";
  }

  // state.doc identity has to be stable while the text is unchanged: the engine
  // memoises caret geometry against `doc === view.state.doc`, so handing back a
  // fresh object every tick would defeat the cache and cost a reflow per frame.
  get state() {
    const text = this._rawText;
    if (this._doc === null || this._docText !== text) {
      this._docText = text;
      this._doc = new DocSnapshot(text);
    }
    const sel = this._selection();
    return { doc: this._doc, selection: sel, overwrite: false };
  }

  _selection() {
    const el = this.dom;
    if (isTextControl(el)) {
      const head = el.selectionStart ?? 0;
      const anchor = el.selectionEnd ?? head;
      const main = { head, anchor, from: anchor, to: head, assoc: 0, empty: head === anchor };
      return { main, mainIndex: 0, ranges: [main] };
    }
    const win = prepareDocument(el.ownerDocument).defaultView || window;
    const s = win.getSelection();
    if (!s || !s.rangeCount) {
      const main = { head: 0, anchor: 0, from: 0, to: 0, assoc: 0, empty: true };
      return { main, mainIndex: 0, ranges: [main] };
    }
    const toMain = (r) => {
      const head = offsetOf(this.dom, r.endContainer, r.endOffset);
      const anchor = offsetOf(this.dom, r.startContainer, r.startOffset);
      return { head, anchor, from: anchor, to: head, assoc: 0, empty: head === anchor };
    };
    const ranges = [];
    for (let i = 0; i < s.rangeCount; i++) ranges.push(toMain(s.getRangeAt(i)));
    return { main: ranges[0], mainIndex: 0, ranges };
  }

  get defaultCharacterWidth() {
    if (this._charW) return this._charW;
    const cs = getComputedStyle(this.dom);
    this._charW = measureCharWidth("M", cs.fontFamily, parseFloat(cs.fontSize) || 14, cs.fontWeight, cs.fontStyle) || 8;
    return this._charW;
  }

  domAtPos(pos) {
    if (this._isControl) return { node: this.dom, offset: Math.max(0, Math.min(pos, this._rawText.length)) };
    return pointAt(this.dom, pos);
  }

  // Returns a viewport rect for the caret edge at `pos`, or null when the
  // position is not currently laid out (hidden input, collapsed subtree).
  coordsAtPos(pos, side = 1) {
    if (this._isControl) return this._controlCoords(pos);
    const p = pointAt(this.dom, pos);
    const doc = prepareDocument(this.dom.ownerDocument);
    const range = doc.createRange();
    try {
      range.setStart(p.node, p.offset);
      range.setEnd(p.node, p.offset);
    } catch {
      return null;
    }
    let rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      // A collapsed range at a line wrap reports nothing; widen by one
      // character and take that edge instead, matching CM's own fallback.
      const p2 = pointAt(this.dom, Math.min(pos + 1, this._rawText.length));
      try {
        range.setStart(p.node, p.offset);
        range.setEnd(p2.node, p2.offset);
      } catch {
        return null;
      }
      rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      if (side >= 0) rect = { ...rect.toJSON ? rect.toJSON() : rect, left: rect.right, right: rect.right };
      else return { left: rect.left, right: rect.left, top: rect.top, bottom: rect.bottom };
    }
    return { left: rect.left, right: rect.left, top: rect.top, bottom: rect.bottom };
  }

  // <textarea>/<input> have no text nodes of their own, so measure against an
  // off-screen mirror that copies the control's own box and typography. The
  // mirror is reused and only re-laid-out when the geometry key changes.
  _controlCoords(pos) {
    const el = this.dom;
    const len = el.value.length;
    pos = Math.max(0, Math.min(pos, len));
    const cs = getComputedStyle(el);
    const key = [cs.font, cs.letterSpacing, cs.padding, cs.border, cs.width, cs.textAlign, el.scrollTop].join("|");
    let m = this._mirror;
    if (!m) {
      m = document.createElement("div");
      m.setAttribute("aria-hidden", "true");
      m.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;top:0;left:-99999px;white-space:pre-wrap;word-break:break-word;overflow:hidden;box-sizing:border-box;";
      document.body.appendChild(m);
      this._mirror = m;
    }
    if (this._mirrorKey !== key) {
      this._mirrorKey = key;
      m.style.font = cs.font;
      m.style.letterSpacing = cs.letterSpacing;
      m.style.textAlign = cs.textAlign;
      m.style.padding = cs.padding;
      m.style.border = cs.border;
      m.style.width = `${el.clientWidth}px`;
    }
    m.textContent = el.value.slice(0, pos);
    const marker = document.createElement("span");
    m.appendChild(marker);
    const box = el.getBoundingClientRect();
    const mr = marker.getBoundingClientRect();
    const mRect = m.getBoundingClientRect();
    m.textContent = "";
    if (!mr || (mr.width === 0 && mr.height === 0) && mRect.height === 0) return null;
    // The mirror is parked at left:-99999px so it cannot affect the page, which
    // means nothing measured on it is in viewport coordinates yet. Take the
    // marker's offset *within the mirror* and re-anchor it on the control.
    // Using the marker's raw viewport left here put the caret at x = -99900, the
    // canvas region went off-screen, and nothing was ever drawn.
    const relLeft = mr.left - mRect.left;
    const relTop = mr.top - mRect.top;
    const relBottom = mr.bottom - mRect.top;
    // A zero-width marker sits exactly on the caret edge; for a wrapped line the
    // marker can land on the previous row, so prefer the row containing the
    // real selection when they disagree vertically. _rowOf is relative too.
    const selRow = el.selectionStart != null ? this._rowOf(el) : null;
    let top = box.top + relTop;
    let bottom = box.top + relBottom;
    if (selRow != null && Math.abs(selRow - relTop) > 2) {
      top = box.top + selRow;
      bottom = top + (mr.height || parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2);
    }
    const x = box.left + relLeft - el.scrollLeft;
    return { left: x, right: x, top, bottom };
  }

  _rowOf(el) {
    const m = this._mirror;
    if (!m) return null;
    // Re-measure at the live selection offset to learn the caret's row.
    m.textContent = el.value.slice(0, el.selectionStart ?? 0);
    const marker = document.createElement("span");
    m.appendChild(marker);
    const r = marker.getBoundingClientRect();
    const mRect = m.getBoundingClientRect();
    m.textContent = "";
    // Relative to the mirror, to match the offsets _controlCoords works in.
    return r && r.height ? r.top - mRect.top : null;
  }

  dispose() {
    this._mirror?.remove();
    this._mirror = null;
  }
}

// Shared canvas for glyph advance measurement, kept module-level so a hundred
// caret measurements a frame do not allocate a hundred contexts.
let _ctx = null;
export function measureCharWidth(char, fontFamily, fontSize, fontWeight, fontStyle) {
  try {
    if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
    if (!_ctx) return null;
    _ctx.font = `${fontStyle || "normal"} ${fontWeight || "normal"} ${fontSize}px ${fontFamily || "inherit"}`;
    return _ctx.measureText(char || "M").width;
  } catch {
    return null;
  }
}

// One view per host element, refreshed in place each time the engine asks, so
// the identity comparisons the engine makes against `view` stay stable.
const cache = new WeakMap();

export function activeView() {
  const el = document.activeElement;
  if (!isTextHost(el)) return null;
  let v = cache.get(el);
  if (!v) {
    v = new DomView(el);
    cache.set(el, v);
  }
  return v;
}

export function clearViewCache() {
  cache.get(document.activeElement)?.dispose();
}

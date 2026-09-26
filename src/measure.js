// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { isNeverDrawHost } from "./shim/editors.js";
import { View } from "./shim/notice.js";

import { CARET_COVERS, CARET_STYLE_TTL_MS, GEOMETRY_TTL_MS } from "./constants.js";
import { step } from "./demo.js";
import { isTextCaretHost } from "./motion.js";

export var measureMethods = {
  caretCoords() {
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (view && view.hasFocus) {
      return this.cmCaretCoords(view);
    }
    return this.genericCaretCoords();
  },
  cmCaretCoords(view) {
    try {
      const main = view.state.selection.main;
      const pos = main.head;
      const doc = view.dom.ownerDocument;
      const active = doc.activeElement;
      const activeIsEditable = isTextCaretHost(active);
      const inTable = !!active?.closest?.("table");
      const side = main.assoc || 1;
      const geoNow = performance.now();
      let gc = this._caretGeoCache;
      let c;
      if (!inTable && gc && gc.doc === view.state.doc && gc.pos === pos && gc.assoc === (main.assoc || 0) && gc.gen === (this._layoutGen | 0) && geoNow - gc.t < GEOMETRY_TTL_MS) {
        c = gc.c;
      } else {
        c = inTable ? null : view.coordsAtPos(pos, side) || view.coordsAtPos(pos, -side);
        if (c && !inTable) {
          this._caretGeoCache = { doc: view.state.doc, pos, assoc: main.assoc || 0, gen: this._layoutGen | 0, t: geoNow, c };
        }
      }
      if (!c) {
        c = this.selectionFallbackCoords(view);
        if (!c) return null;
      }
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1;
        const cBottom = c.bottom ?? c.top;
        if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) {
          return null;
        }
      }
      const rawChar = view.state.doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";
      const win = doc.defaultView || window;
      const assocKey = main.assoc || 0;
      const nowMs = performance.now();
      const styleGen = this._styleGen | 0;
      let sc = this._caretStyleCache;
      if (!(sc && sc.doc === view.state.doc && sc.pos === pos && sc.assoc === assocKey && sc.gen === styleGen && nowMs - sc.t < CARET_STYLE_TTL_MS)) {
        const contentStyle = win.getComputedStyle(view.contentDOM);
        const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
        const sampleY = (c.top + c.bottom) / 2;
        const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
        const lineEl = elAtCaret && elAtCaret.closest && elAtCaret.closest(".cm-line") || view.contentDOM.querySelector(".cm-line");
        const charStyle = elAtCaret && lineEl && lineEl.contains(elAtCaret) ? win.getComputedStyle(elAtCaret) : lineEl ? win.getComputedStyle(lineEl) : contentStyle;
        const _textColor = charStyle.color || contentStyle.color || "#ffffff";
        const _fontSize = parseFloat(charStyle.fontSize) || parseFloat(contentStyle.fontSize) || 14;
        const _fontFamily = charStyle.fontFamily || contentStyle.fontFamily || "monospace";
        const _fontWeight = charStyle.fontWeight || contentStyle.fontWeight || "normal";
        const _fontStyleCss = charStyle.fontStyle || contentStyle.fontStyle || "normal";
        const letterSpacingStr = charStyle.letterSpacing || contentStyle.letterSpacing;
        let _letterSpacing = 0;
        if (letterSpacingStr && letterSpacingStr.endsWith("px")) {
          _letterSpacing = parseFloat(letterSpacingStr) || 0;
        }
        const _lineHeightStr = charStyle.lineHeight || contentStyle.lineHeight || "";
        let _charWidth = view.defaultCharacterWidth || 8;
        if (char) {
          const measuredW = this.measureCharWidth(char, _fontFamily, _fontSize, _fontWeight, _fontStyleCss);
          if (measuredW) {
            _charWidth = measuredW + _letterSpacing;
          } else {
            try {
              const nextCoords = view.coordsAtPos(pos + 1, -1) || view.coordsAtPos(pos + 1, 1);
              if (nextCoords) {
                const measured = nextCoords.left - c.left;
                if (measured > 0.5 && measured < _charWidth * 6) _charWidth = measured;
              }
            } catch {
            }
          }
        }
        let _rowLeft = null, _rowRight = null;
        if (lineEl) {
          try {
            const rng = doc.createRange();
            rng.selectNodeContents(lineEl);
            const rects = rng.getClientRects();
            let best = null;
            let nearest = null, nearestD = Infinity;
            for (let ri = 0; ri < rects.length; ri++) {
              const r = rects[ri];
              if (r.width <= 0 && r.height <= 0) continue;
              const overlap = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
              if (overlap > 0) {
                if (!best) best = { left: r.left, right: r.right };
                else {
                  best.left = Math.min(best.left, r.left);
                  best.right = Math.max(best.right, r.right);
                }
              } else {
                const d = Math.abs((r.top + r.bottom) / 2 - (c.top + c.bottom) / 2);
                if (d < nearestD) {
                  nearestD = d;
                  nearest = r;
                }
              }
            }
            if (!best && nearest && nearestD < c.bottom - c.top) {
              best = { left: nearest.left, right: nearest.right };
            }
            if (best && best.right - best.left > 0.5) {
              _rowLeft = best.left;
              _rowRight = best.right;
            } else if (!(lineEl.textContent || "").trim()) {
              _rowLeft = c.left;
              _rowRight = c.left;
            } else {
              _rowLeft = null;
              _rowRight = null;
            }
          } catch {
            _rowLeft = null;
            _rowRight = null;
          }
        }
        sc = this._caretStyleCache = {
          doc: view.state.doc,
          pos,
          assoc: assocKey,
          gen: styleGen,
          t: nowMs,
          textColor: _textColor,
          fontSize: _fontSize,
          fontFamily: _fontFamily,
          fontWeight: _fontWeight,
          fontStyle: _fontStyleCss,
          letterSpacing: _letterSpacing,
          lineHeightStr: _lineHeightStr,
          charWidth: _charWidth,
          rowLeft: _rowLeft,
          rowRight: _rowRight
        };
      }
      const {
        textColor,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle: fontStyleCss,
        letterSpacing,
        lineHeightStr,
        charWidth,
        rowLeft,
        rowRight
      } = sc;
      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.styleFor("caretWidthPx");
      }
      let h = Math.max(4, c.bottom - c.top);
      const rawLineHeight = lineHeightStr;
      if (rawLineHeight && rawLineHeight.endsWith("px")) {
        h = parseFloat(rawLineHeight);
      } else if (rawLineHeight && !isNaN(parseFloat(rawLineHeight)) && rawLineHeight !== "normal") {
        h = fontSize * parseFloat(rawLineHeight);
      }
      const centerY = (c.top + c.bottom) / 2;
      const top = centerY - h / 2;
      const bottom = centerY + h / 2;
      return {
        x: c.left,
        top,
        bottom,
        h,
        w: finalWidth,
        actualCharWidth: charWidth,
        // Text extent of the caret's own visual row, in canvas coords (the
        // canvas is position:fixed at 0,0 so client coords map straight over).
        // Hot-head uses it to keep fire on the text and to spot row edges.
        rowLeft,
        rowRight,
        char,
        textColor,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle: fontStyleCss,
        // Carried so the glyph drawn inside a Box cursor can be centered on
        // the true glyph advance (charWidth minus this) rather than on the
        // letter-spacing-padded cell, which would push it right by half the
        // spacing on any theme that sets letter-spacing.
        letterSpacing,
        focused: view.hasFocus || inTable && activeIsEditable,
        pos,
        // The document length, for resolveHoldChar: with pos, an insertion
        // at the caret (typing) is told from a click or an arrow.
        docLen: view.state.doc.length,
        // Needed by updateActivePoint: an assoc flip at a wrap boundary is a
        // real cursor move (row1-end -> row2-start) even though pos is equal,
        // and must NOT be swallowed by the scroll-compensation branch.
        assoc: main.assoc
      };
    } catch (e) {
      this._reportOnce("cmCaretCoords", e);
      return null;
    }
  },
  // CodeMirror 6 supports multiple cursors: state.selection.ranges is an
  // array and state.selection.mainIndex points at the "primary" one that
  // this.* tracks. This returns one entry per OTHER range, in range order,
  // with the caret head's raw pixel coords - or `visible: false` for a range
  // that has scrolled out of the pane, which keeps the array aligned with
  // the per-caret state bundles in this._secondaries (see
  // updateSecondaryCarets; an off-screen entry there clears its caret the
  // way the primary clears when it scrolls out). Returns [] when there is
  // only one range or the view isn't focused.
  secondaryCaretCoords(view, states) {
    const out = [];
    if (!view || !view.hasFocus) return out;
    const gen = this._layoutGen | 0;
    const now = performance.now();
    const doc = view.state.doc;
    try {
      const sel = view.state.selection;
      const ranges = sel.ranges;
      if (!ranges || ranges.length <= 1) return out;
      const mainIndex = sel.mainIndex;
      const paneRect = this.getPaneRect(view);
      const margin = 1;
      for (let i = 0; i < ranges.length; i++) {
        if (i === mainIndex) continue;
        const head = ranges[i].head;
        const s = ranges[i].assoc || 1;
        const st = states && states[out.length];
        let c = null;
        const g = st && st._geo;
        if (g && g.doc === doc && g.pos === head && g.gen === gen && now - g.t < GEOMETRY_TTL_MS) {
          c = g.c;
        } else {
          c = view.coordsAtPos(head, s) || view.coordsAtPos(head, -s);
          if (st && c) st._geo = { doc, pos: head, gen, t: now, c };
        }
        let visible = !!c;
        if (c && paneRect) {
          const cBottom = c.bottom ?? c.top;
          if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) visible = false;
        }
        const empty = !!ranges[i].empty;
        out.push(visible && c ? { x: c.left, top: c.top, bottom: c.bottom, pos: head, assoc: ranges[i].assoc || 0, empty, visible: true } : { x: 0, top: 0, bottom: 0, pos: head, assoc: ranges[i].assoc || 0, empty, visible: false });
      }
    } catch (e) {
      this._reportOnce("secondaryCaretCoords", e);
    }
    return out;
  },
  // The full caret record for one secondary - what cmCaretCoords builds for
  // the primary - from its coordsAtPos geometry plus the style of the line it
  // sits on. No elementFromPoint: that is a layout hit-test per caret per
  // edit, and a column edit re-measures every caret on every keystroke. The
  // line element from domAtPos is cheap and right for everything but a
  // caret inside an inline span with its own font, which draws with the
  // line's metrics instead. Cached on the bundle the way the primary's
  // style is (doc identity + pos + a short TTL), and shared per line within
  // a frame through `lineStyles`.
  secondaryCaretRecord(view, c, state, lineStyles) {
    const doc = view.state.doc;
    const pos = c.pos;
    const now = performance.now();
    let st = state._style;
    if (!(st && st.doc === doc && st.pos === pos && now - st.t < 250)) {
      const win = view.dom.ownerDocument.defaultView || window;
      let lineEl = null;
      try {
        const d = view.domAtPos(pos);
        const n = d && d.node && d.node.nodeType === 3 ? d.node.parentElement : d && d.node;
        lineEl = n && n.closest ? n.closest(".cm-line") : null;
      } catch {
      }
      const key = lineEl || view.contentDOM;
      let ls = lineStyles.get(key);
      if (!ls) {
        const cs = win.getComputedStyle(key);
        const letterSpacingStr = cs.letterSpacing;
        ls = {
          textColor: cs.color || "#ffffff",
          fontSize: parseFloat(cs.fontSize) || 14,
          fontFamily: cs.fontFamily || "monospace",
          fontWeight: cs.fontWeight || "normal",
          fontStyle: cs.fontStyle || "normal",
          letterSpacing: letterSpacingStr && letterSpacingStr.endsWith("px") ? parseFloat(letterSpacingStr) || 0 : 0,
          lineHeightStr: cs.lineHeight || ""
        };
        lineStyles.set(key, ls);
      }
      const rawChar = doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";
      let charWidth = view.defaultCharacterWidth || 8;
      if (char) {
        const m = this.measureCharWidth(char, ls.fontFamily, ls.fontSize, ls.fontWeight, ls.fontStyle);
        if (m) charWidth = m + ls.letterSpacing;
      }
      st = state._style = Object.assign({ doc, pos, t: now, char, charWidth }, ls);
    }
    let h = Math.max(4, c.bottom - c.top);
    const lh = st.lineHeightStr;
    if (lh && lh.endsWith("px")) h = parseFloat(lh);
    else if (lh && !isNaN(parseFloat(lh)) && lh !== "normal") h = st.fontSize * parseFloat(lh);
    const centerY = (c.top + c.bottom) / 2;
    const w = this.styleFor("cursorStyle") === "Line" ? this.styleFor("caretWidthPx") : st.charWidth;
    return {
      x: c.x,
      top: centerY - h / 2,
      bottom: centerY + h / 2,
      h,
      w,
      actualCharWidth: st.charWidth,
      rowLeft: null,
      rowRight: null,
      char: st.char,
      textColor: st.textColor,
      fontSize: st.fontSize,
      fontFamily: st.fontFamily,
      fontWeight: st.fontWeight,
      fontStyle: st.fontStyle,
      letterSpacing: st.letterSpacing,
      focused: true,
      pos,
      assoc: c.assoc,
      docLen: view.state.doc.length
    };
  },
  selectionFallbackCoords(view) {
    const doc = view ? view.dom.ownerDocument : this.canvas?.ownerDocument ?? document;
    const active = doc.activeElement;
    if (!active) return null;
    if (!isTextCaretHost(active)) return null;
    const isFormField = active.tagName === "TEXTAREA" || active.tagName === "INPUT";
    if (isFormField) {
      const fieldRect = this.formFieldCaretCoords(active);
      if (fieldRect) return fieldRect;
    }
    const win = doc.defaultView || window;
    const sel = win.getSelection();
    if (sel && sel.rangeCount > 0 && sel.focusNode && active.isContentEditable) {
      const isDegenerate = (r) => !r || r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0;
      const spanRect = this.adjacentCharRect(doc, sel.focusNode, sel.focusOffset);
      if (spanRect) return spanRect;
      let range;
      try {
        range = doc.createRange();
        range.setStart(sel.focusNode, sel.focusOffset);
        range.collapse(true);
      } catch {
        range = sel.getRangeAt(0).cloneRange();
        range.collapse(true);
      }
      let rect2 = range.getClientRects()[0] || (range.getBoundingClientRect?.() ?? null);
      if (isDegenerate(rect2)) {
        let node = range.startContainer;
        let lineEl = node.nodeType === 1 ? node : node.parentElement;
        if (lineEl && lineEl !== active) {
          const lineRect = lineEl.getBoundingClientRect();
          if (!isDegenerate(lineRect)) rect2 = lineRect;
        }
      }
      if (!isDegenerate(rect2)) {
        return { left: rect2.left, top: rect2.top, bottom: rect2.bottom || rect2.top + rect2.height };
      }
    }
    const rect = active.getBoundingClientRect();
    if (!rect) return null;
    const style = win.getComputedStyle(active);
    const approxLineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
    if (rect.height > approxLineHeight * 3) return null;
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  },
  // Measures a real, rendered one-character span next to the caret (rather
  // than a collapsed point) so the resulting rect uses the browser's actual
  // line-box metrics - the same metrics it uses to paint text and selection
  // highlights - instead of a font's tight glyph metrics.
  adjacentCharRect(doc, node, offset) {
    if (!node || node.nodeType !== 3) return null;
    const text = node.data || "";
    const isDegenerate = (r) => !r || r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0;
    let caretX = null, caretTop = 0, caretBottom = 0;
    try {
      const c = doc.createRange();
      c.setStart(node, offset);
      c.collapse(true);
      const cr = c.getClientRects()[0] || c.getBoundingClientRect();
      if (!isDegenerate(cr)) {
        caretX = cr.left;
        caretTop = cr.top;
        caretBottom = Math.max(cr.bottom, cr.top + (cr.height || 0));
      }
    } catch {
    }
    const onLine = (rect) => caretX === null || caretTop < rect.bottom && caretBottom > rect.top;
    try {
      if (offset < text.length) {
        const r = doc.createRange();
        r.setStart(node, offset);
        r.setEnd(node, offset + 1);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX !== null && onLine(rect) ? caretX : rect.left, top: rect.top, bottom: rect.bottom };
      }
      if (offset > 0) {
        const r = doc.createRange();
        r.setStart(node, offset - 1);
        r.setEnd(node, offset);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX !== null && onLine(rect) ? caretX : rect.right, top: rect.top, bottom: rect.bottom };
      }
    } catch {
    }
    return null;
  },
  // Caret info for editable elements outside the note editor entirely -
  // file-tree rename input, Command Palette / Quick Switcher, Settings text
  // fields, other plugins' modals, etc. There's no CodeMirror here, so we
  // don't have real glyph metrics; approximate them from the focused
  // element's own computed style instead.
  // Stable opaque id for a DOM node, so a caret's location can be compared
  // across frames without holding a reference that would keep a detached node
  // alive (WeakMap - entries vanish with the node).
  _nodeKey(node) {
    if (!node) return "0";
    if (!this._nodeIds) {
      this._nodeIds = /* @__PURE__ */ new WeakMap();
      this._nodeIdSeq = 0;
    }
    let id = this._nodeIds.get(node);
    if (id === void 0) {
      id = ++this._nodeIdSeq;
      this._nodeIds.set(node, id);
    }
    return String(id);
  },
  // "Where is the caret", for a field that has no CodeMirror document. Two
  // frames reporting the same value mean the caret did not logically move, so
  // any change in its screen coordinates was a scroll or a layout shift.
  //
  // Deliberately built from the caret's position WITHIN its field, never from
  // its coordinates - coordinates are the very thing being tested against.
  genericCaretPos(active, doc) {
    try {
      const el = this._nodeKey(active);
      if (active.tagName === "TEXTAREA" || active.tagName === "INPUT") {
        const field = active;
        return el + ":" + (field.selectionStart ?? 0) + ":" + (field.selectionEnd ?? 0);
      }
      const win = doc && doc.defaultView || window;
      const sel = win.getSelection();
      if (sel && sel.focusNode) {
        return el + ":" + this._nodeKey(sel.focusNode) + ":" + sel.focusOffset;
      }
      return el + ":0";
    } catch (e) {
      this._reportOnce("genericCaretPos", e);
      return null;
    }
  },
  genericCaretCoords() {
    try {
      const doc = this.canvas?.ownerDocument ?? document;
      const active = doc.activeElement;
      if (!isTextCaretHost(active)) return null;
      // Password fields and controls that fake their own caret: leave them
      // completely alone rather than measuring something that is not a caret.
      if (isNeverDrawHost(active)) return null;
      if (this.isExcalidrawCaretHost(active)) return null;
      const c = this.selectionFallbackCoords(null);
      if (!c) return null;
      const win = doc.defaultView || window;
      const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
      const sampleY = (c.top + c.bottom) / 2;
      const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
      const styleSource = elAtCaret && active.contains?.(elAtCaret) ? elAtCaret : active;
      const style = win.getComputedStyle(styleSource);
      const fontSize = parseFloat(style.fontSize) || 14;
      const fontFamily = style.fontFamily || "inherit";
      const char = this.genericCaretChar(active);
      const measured = char ? this.measureCharWidth(char, fontFamily, fontSize, style.fontWeight, style.fontStyle) : null;
      const charWidth = measured || Math.max(4, fontSize * 0.55);
      const height = Math.max(4, c.bottom - c.top || fontSize * 1.2);
      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.styleFor("caretWidthPx");
      }
      return {
        x: c.left,
        top: c.top,
        bottom: c.top + height,
        h: height,
        w: finalWidth,
        actualCharWidth: charWidth,
        // No line-element geometry on this path (plain textarea /
        // contenteditable); null means "unknown", and Hot-head falls back to
        // burning around the caret without clamping.
        rowLeft: null,
        rowRight: null,
        char,
        textColor: style.color || "#ffffff",
        fontSize,
        fontFamily,
        fontWeight: style.fontWeight || "normal",
        fontStyle: style.fontStyle || "normal",
        // Generic inputs don't fold letter-spacing into the box width, so the
        // glyph is centered on its own advance directly.
        letterSpacing: 0,
        focused: true,
        // Logical identity of this caret, standing in for the document
        // position CodeMirror provides and a plain input doesn't.
        //
        // This used to be hardcoded null, which failed the `caret.pos !== null`
        // test in updateActivePoint and so disqualified every interface caret
        // from the scroll-shift path. Scrolling a Settings pane moves the
        // field on screen without moving the caret within it, but with no
        // identity to compare, each scrolled pixel looked like a genuine caret
        // move and went through commitMove() - pushing a trail point at every
        // step, which is why scrolling smeared a trail up and down the panel.
        // With a real identity, a pure scroll is recognised as one and the
        // cursor is translated instantly instead (no trail, no smear wiggle).
        pos: this.genericCaretPos(active, doc)
      };
    } catch (e) {
      this._reportOnce("genericCaretCoords", e);
      return null;
    }
  },
  // Measures the real rendered width of a single character in a given font,
  // used to size the Box/Underline cursor accurately for proportional
  // (non-monospace) fonts - a flat fontSize-based guess consistently under-
  // or over-shoots for anything but a true monospace font. Weight and style
  // matter: a bold glyph is meaningfully wider than its regular counterpart,
  // and measuring without them left the box visibly too narrow on bold or
  // italic text.
  // Build a canvas ctx.font string from resolved CSS font values. This lives
  // in ONE place on purpose: the character-in-box drift bug came from
  // drawBoxCursor building this string WITHOUT weight/style while
  // measureCharWidth built it WITH them - so the box was sized for a
  // bold/italic glyph and a regular upright one was drawn inside it. Every
  // site that measures OR draws a glyph must route through here so the two can
  // never diverge again.
  fontString(fontSize, fontFamily, fontWeight, fontStyle) {
    const w = fontWeight && fontWeight !== "normal" ? fontWeight + " " : "";
    const s = fontStyle && fontStyle !== "normal" ? fontStyle + " " : "";
    return `${s}${w}${fontSize}px ${fontFamily}`;
  },
  measureCharWidth(char, fontFamily, fontSize, fontWeight, fontStyle) {
    try {
      const ctx = this._measureCtx || (this._measureCtx = createEl("canvas").getContext("2d"));
      if (!ctx) return null;
      ctx.font = this.fontString(fontSize, fontFamily, fontWeight, fontStyle);
      const w = ctx.measureText(char).width;
      return w > 0 ? w : null;
    } catch {
      return null;
    }
  },
  // The character sitting immediately after the caret, for elements outside
  // the note editor - mirrors what cmCaretCoords does for CodeMirror. Used
  // to draw the "letter inside the cursor" effect in non-editor fields too.
  genericCaretChar(active) {
    try {
      if (active.tagName === "INPUT" || active.tagName === "TEXTAREA") {
        const field = active;
        const value = field.value != null ? String(field.value) : "";
        let selStart = value.length;
        try {
          const s = field.selectionStart, e = field.selectionEnd;
          if (typeof s === "number" && typeof e === "number") {
            selStart = field.selectionDirection === "backward" ? s : e;
          }
        } catch {
        }
        const ch = value.charAt(selStart);
        return ch && ch !== "\n" ? ch : "";
      }
      if (active.isContentEditable) {
        const doc = active.ownerDocument;
        const win = doc.defaultView || window;
        const sel = win.getSelection();
        if (sel && sel.focusNode && sel.focusNode.nodeType === 3) {
          const text = sel.focusNode.data || "";
          const ch = text.charAt(sel.focusOffset);
          return ch && ch !== "\n" ? ch : "";
        }
      }
    } catch {
    }
    return "";
  },
  // The letter just typed, for the letter pop and for the box that WAITS at
  // the old spot through a Move delay - the spot the letter now occupies.
  // Once the box moves it sits past the letter and shows the character
  // under the caret (nothing at the end of a line), so nothing holds it
  // there. Only for an insertion at the caret - the document grew by
  // exactly the distance the caret moved: a keystroke, a paste - and null
  // for every other move. A click or an arrow, forward or back, shows the
  // character under the caret, or nothing on an empty line.
  //
  // It used to hold the character before ANY forward move (a click ahead
  // held whatever preceded the click, a space at a word's start included,
  // and popped a letter particle for it) and, for every other move, the
  // previous position's character - so a click from a word onto an empty
  // line showed the word's letter in the empty box.
  resolveHoldChar(newCaret) {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      const last = this.lastActive;
      if (view && last && typeof newCaret.pos === "number" && typeof last.pos === "number" && typeof newCaret.docLen === "number" && typeof last.docLen === "number" && newCaret.pos > last.pos && newCaret.docLen - last.docLen === newCaret.pos - last.pos) {
        const justTyped = view.state.doc.sliceString(newCaret.pos - 1, newCaret.pos);
        if (justTyped && justTyped !== "\n") {
          if (this.look.popEffects && this.look.popLetters) {
            this.spawnLetterParticle(justTyped, last);
          }
          return justTyped;
        }
      }
    } catch {
    }
    return null;
  },
  // True when `el` is Excalidraw's own text editor.
  //
  // Excalidraw edits text through a <textarea> absolutely positioned over its
  // canvas and CSS-transformed to match the shape - scaled with the zoom, and
  // rotated with the element. isTextCaretHost says yes to any <textarea>, so
  // that editor fell straight through to genericCaretCoords and we drew on it.
  //
  // Which cannot work, because formFieldCaretCoords measures the caret offset
  // in an offscreen mirror div that carries none of those transforms, then
  // adds getBoundingClientRect() as the origin. Untransformed offsets on a
  // transformed origin: near-enough on the first character, drifting further
  // with every one after it, and meaningless the moment the shape is rotated.
  //
  // Excalidraw draws its own caret anyway, so there is nothing here for us to
  // replace - we just get out of the way. See also the caret-color carve-out
  // in styles.css: suppressing our drawing is only half the
  // job, because our global hide-native rule would otherwise leave the
  // textarea with no visible caret at all.
  //
  // The DOM check is the load-bearing one, NOT the view-type check below it:
  // Excalidraw also renders through a markdown post-processor, so a drawing
  // embedded in a note lives inside a leaf whose view type is "markdown", and
  // a view-type test alone would miss every embed.
  isExcalidrawCaretHost(el) {
    if (!el) return false;
    try {
      if (this._excaliHostFor !== el) {
        this._excaliHostFor = el;
        this._excaliHostVal = !!(el.closest?.(".excalidraw, .excalidraw-wrapper, .excalidraw-view") || el.classList?.contains("excalidraw-wysiwyg"));
      }
      if (this._excaliHostVal) return true;
      const view = this.app.workspace.getActiveViewOfType(View);
      if (view?.getViewType?.() !== "excalidraw") return false;
      if (view.contentEl) return view.contentEl.contains(el);
      return !!(view.containerEl && view.containerEl.contains(el) && !el.closest?.(".view-header"));
    } catch (e) {
      this._reportOnce("isExcalidrawCaretHost", e);
      return false;
    }
  },
  // Is the caret in the note editor itself, rather than somewhere else in the
  // app? This is the same question caretCoords() asks to choose between its
  // CodeMirror path and the generic interface one, asked of the same object -
  // and deliberately not a DOM or selector test.
  //
  // "Note Editor Only" has to stop drawing a caret and stop hiding the native
  // one in EXACTLY the same places, and the only way to guarantee two halves
  // agree is to derive both from one predicate. A selector-based version is
  // how issue #26 happened: we declined to draw in a field whose native caret
  // we were still hiding, and it had a caret from neither source.
  noteEditorFocused() {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      return !!(view && view.hasFocus);
    } catch (e) {
      this._reportOnce("noteEditorFocused", e);
      return false;
    }
  },
  // True when the element is actually painted (not display:none, hidden,
  // or fully transparent). Used by _chromeInsets to decide whether the
  // STATUS BAR should clamp the overlay: an invisible-but-in-flow status
  // bar (zen-mode themes hide it via opacity so it can reveal on hover)
  // shouldn't leave a dead unshaded strip. Deliberately NOT used for the
  // titlebar - see _chromeInsets for why the titlebar clamps regardless
  // of visibility.
  _isVisiblyRendered(el) {
    if (!el) return false;
    const win = el.ownerDocument.defaultView || window;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) <= 0.01) return false;
    return true;
  },
  // Cached top/bottom insets around Obsidian's window chrome, refreshed at
  // most every 500ms (or on window resize via _bumpChromeInsets). Both tick
  // loops need these every frame; uncached, that's 2 querySelectors + 2
  // getBoundingClientRects + 2 getComputedStyles per frame per loop, which
  // is measurable jank on weak GPUs (ChromeOS Crostini) - and Chromium has
  // a known slow path where layout reads get more expensive whenever any
  // app-region: drag element exists in the document, which is always true
  // in frameless Obsidian.
  //
  // Titlebar: clamps whenever it occupies layout space, VISIBLE OR NOT.
  // Drag hit-testing doesn't care about visibility - an opacity-0 titlebar
  // (zen-mode themes) still owns the window's drag region, and covering it
  // breaks dragging just the same. Drag correctness beats the cosmetic
  // cost of a few undarkened pixels.
  //
  // Status bar: clamps only when visibly rendered. It has no drag role, so
  // for an invisible-but-in-flow status bar the clamp would just leave a
  // dead unshaded strip for no benefit (the concern _isVisiblyRendered was
  // originally written for).
  _chromeInsets(doc) {
    const now = performance.now();
    const c = this._chromeCache;
    if (c && c.doc === doc && now - c.t < 500) return c;
    let top = 0;
    const titleBar = doc.querySelector(".titlebar");
    const isHiddenFrameless = doc.body.classList.contains("is-hidden-frameless");
    if (titleBar && !isHiddenFrameless) {
      const tb = titleBar.getBoundingClientRect();
      if (tb.height > 0 && tb.top <= tb.height) top = Math.max(top, tb.bottom);
    }
    let bottomInset = 0;
    let statusLeft = 0, statusRight = 0;
    const statusBar = doc.querySelector(".status-bar");
    if (statusBar && this._isVisiblyRendered(statusBar)) {
      const sb = statusBar.getBoundingClientRect();
      const win = doc.defaultView || window;
      if (sb.height > 0 && sb.bottom >= win.innerHeight - 1) {
        bottomInset = Math.max(0, win.innerHeight - sb.top);
        statusLeft = sb.left;
        statusRight = sb.right;
      }
    }
    let coverTop = 0;
    let coverBottom = Number.POSITIVE_INFINITY;
    const win2 = doc.defaultView || window;
    for (const el of Array.from(doc.querySelectorAll(CARET_COVERS))) {
      if (!this._isVisiblyRendered(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width < win2.innerWidth * 0.4) continue;
      if (r.top + r.height / 2 < win2.innerHeight / 2) coverTop = Math.max(coverTop, r.bottom);
      else coverBottom = Math.min(coverBottom, r.top);
    }
    this._chromeCache = { doc, t: now, top, bottomInset, statusLeft, statusRight, coverTop, coverBottom };
    return this._chromeCache;
  },
  // Full-window rect minus the window chrome. Never returns a rect that
  // overlaps the titlebar: a full-viewport fixed-position layer sitting
  // over the titlebar - even one with pointer-events: none - breaks
  // Electron's native window-drag hit-testing on frameless/custom-titlebar
  // windows (Electron composes drag regions in DOM order; z-index and
  // pointer-events don't participate). Seen in the wild on Linux X11 (KDE)
  // and ChromeOS Crostini: window resizes fine, refuses to move.
  // Note: when Obsidian runs with the NATIVE frame there's no .titlebar in
  // the DOM at all - and none is needed, because the OS titlebar lives
  // outside the web contents where nothing we render can cover it. The
  // zero inset we compute in that case is correct, not a missed clamp.
  getFullViewportRect(doc) {
    const win = doc.defaultView || window;
    const { top } = this._chromeInsets(doc);
    const bottom = win.innerHeight;
    if (bottom <= top) {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    }
    return {
      top,
      bottom,
      left: 0,
      right: win.innerWidth,
      width: win.innerWidth,
      height: bottom - top
    };
  },
  // Clip rect for a caret that isn't in the note editor: the Settings tab's
  // scroll frame, a modal body, the file tree, and so on. Returns the
  // intersection of every clipping ancestor of the focused field, or null when
  // it has none (then the caller falls back to the viewport, as before).
  //
  // The editor path clips the canvas to the pane so the cursor physically
  // cannot paint outside it; this path had no equivalent and handed back the
  // whole viewport, so a caret in a Settings text box was free to paint
  // anywhere. It only showed up while scrolling, because getBoundingClientRect
  // keeps reporting a position for an input that has scrolled out of its own
  // scroll container - the DOM clips the element, the geometry doesn't - so
  // the cursor was still drawn at that position: outside the settings frame,
  // over the main window, and over the titlebar.
  getCaretClipRect(doc) {
    const active = doc && doc.activeElement;
    if (!active || active === doc.body) return null;
    if (this._clipChainFor !== active) {
      this._clipChainFor = active;
      this._clipChain = this._resolveClipChain(active);
    }
    const chain = this._clipChain;
    if (!chain || !chain.length) return null;
    const win = doc.defaultView || window;
    const { top: chromeTop } = this._chromeInsets(doc);
    let top = chromeTop, left = 0;
    let bottom = win.innerHeight, right = win.innerWidth;
    for (const el of chain) {
      if (!el.isConnected) {
        this._clipChainFor = null;
        return null;
      }
      const b = el.getBoundingClientRect();
      if (b.top > top) top = b.top;
      if (b.left > left) left = b.left;
      if (b.bottom < bottom) bottom = b.bottom;
      if (b.right < right) right = b.right;
    }
    if (bottom <= top || right <= left) return null;
    return { top, bottom, left, right, width: right - left, height: bottom - top };
  },
  // Every ancestor of `el` that actually clips it, nearest first. Walking
  // stops short of <body>/<html>: those are covered by the viewport clamp in
  // getCaretClipRect, and their rects can legitimately exceed the viewport.
  //
  // "Actually clips" is not the same as "has overflow" - CSS positioning lets
  // an element escape its ancestors' overflow, and getting that wrong here
  // means clipping a cursor away to nothing, which is a worse bug than the one
  // this whole path exists to fix. So: a fixed-positioned element is clipped
  // by nothing above it, and an absolutely-positioned one is only clipped by
  // ancestors that are themselves positioned (its containing block and up).
  // Popovers, suggestion dropdowns and tooltips all rely on exactly this.
  _resolveClipChain(el) {
    const chain = [];
    try {
      const doc = el.ownerDocument;
      const win = doc.defaultView || window;
      let curPos = win.getComputedStyle(el).position;
      if (curPos === "fixed") return chain;
      let node = el.parentElement;
      let guard = 0;
      while (node && node !== doc.body && node !== doc.documentElement && guard++ < 24) {
        const st = win.getComputedStyle(node);
        const positioned = st.position !== "static";
        const clips = st.overflowX !== "visible" || st.overflowY !== "visible";
        if (clips && (curPos !== "absolute" || positioned)) chain.push(node);
        if (positioned) {
          if (st.position === "fixed") break;
          curPos = st.position;
        }
        node = node.parentElement;
      }
    } catch (e) {
      this._reportOnce("_resolveClipChain", e);
      return [];
    }
    return chain;
  },
  getPaneRect(view) {
    if (!view) return null;
    const now = performance.now();
    const pc = this._paneRectCache;
    if (pc && pc.view === view && pc.gen === (this._layoutGen | 0) && now - pc.t < GEOMETRY_TTL_MS) return pc.rect;
    const rootEl = view.dom.closest(".cm-editor") || view.dom.closest(".workspace-leaf");
    if (!rootEl) return null;
    const rect = rootEl.getBoundingClientRect();
    const out = this._paneRectFrom(rect, rootEl);
    this._paneRectCache = { view, gen: this._layoutGen | 0, t: now, rect: out };
    return out;
  },
  // The workspace's main area: the root split, which is every tab group
  // and nothing of the docks, the ribbon or the status bar - the torch
  // overlay's box with "Keep sidebars lit" on - and, within it, the NOTE
  // TABS: the rectangle of each tab group whose front tab is a note (a
  // markdown view; Obsidian hides the group's other tabs with an inline
  // display: none). Those are what the torch darkens: not the active
  // editor's pane (one lit tab beside a dark one undid the effect, and the
  // pane changed with focus), and not the views beside the notes either
  // (Word-Smith's History, Export and Organizer, a graph, an empty tab -
  // "not ok" dark). Both clamped below a visible titlebar like the pane.
  // The rect is null where there is no root split and no workspace (the
  // torch then dims the window). Cached like the pane, on the layout
  // generation and the geometry TTL.
  _mainArea(doc) {
    const now = performance.now();
    const mc = this._mainRectCache;
    if (mc && mc.doc === doc && mc.gen === (this._layoutGen | 0) && now - mc.t < GEOMETRY_TTL_MS) return mc;
    const rootEl = doc.querySelector(".workspace-split.mod-root") || doc.querySelector(".workspace");
    const box = rootEl ? this._paneRectFrom(rootEl.getBoundingClientRect(), rootEl) : null;
    const rect = box && box.width > 0 && box.height > 0 ? box : null;
    const notes = [];
    if (rootEl) {
      for (const group of Array.from(rootEl.querySelectorAll(".workspace-tabs"))) {
        let front = null;
        for (const leaf of Array.from(group.querySelectorAll(":scope > .workspace-tab-container > .workspace-leaf"))) {
          if (leaf.style.display !== "none") {
            front = leaf;
            break;
          }
        }
        const content = front && front.querySelector(":scope > .workspace-leaf-content");
        if (!content || content.getAttribute("data-type") !== "markdown") continue;
        const b = this._paneRectFrom(group.getBoundingClientRect(), group);
        if (b && b.width > 0 && b.height > 0) notes.push(b);
      }
    }
    this._mainRectCache = { doc, gen: this._layoutGen | 0, t: now, rect, notes };
    return this._mainRectCache;
  },
  getMainAreaRect(doc) {
    return this._mainArea(doc).rect;
  },
  // The note tabs' rectangles (client coordinates); empty when no note is
  // in front anywhere in the main area.
  getNoteTabRects(doc) {
    return this._mainArea(doc).notes;
  },
  _paneRectFrom(rect, rootEl) {
    const doc = rootEl.ownerDocument;
    const { top: chromeTop } = this._chromeInsets(doc);
    const top = Math.max(rect.top, chromeTop);
    const bottom = rect.bottom;
    if (bottom <= top) return rect;
    return {
      top,
      bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: bottom - top
    };
  },
  getActiveRect() {
    const active = this.animActive;
    if (!active) return null;
    if (this.styleFor("cursorStyle") === "Underline") {
      const uThickness = this.underlineThickness(active.h);
      return { x: active.x, y: active.top + active.h - uThickness, w: active.actualCharWidth, h: uThickness };
    }
    return { x: active.x, y: active.top, w: this.renderWidth(active), h: active.h };
  },
  renderWidth(active) {
    return active.w;
  },
  // Thickness of the Underline cursor's bar, in px.
  //
  // 0 (the default) means "auto": 15% of the line height, which is exactly
  // what this style did before the setting existed - so an existing setup, and
  // any Vim mode that never overrode the key, keeps the look it already had.
  // Anything else is a literal pixel thickness, clamped to the line height so
  // a large value on a small font degrades to a filled block rather than
  // painting outside the line.
  underlineThickness(lineHeight) {
    const h = Math.max(1, Math.round(lineHeight || 0));
    const px = this.look.underlineWidthPx || 0;
    if (px > 0) return Math.max(1, Math.min(Math.round(px), h));
    return Math.max(2, Math.round(h * 0.15));
  }
};

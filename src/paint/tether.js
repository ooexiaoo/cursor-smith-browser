// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hexToRgbTuple, hexToRgba } from "../color.js";
import { BLOCK_HEAD_MAX, BLOCK_LINE_LOOKBACK, BLOCK_PREFIX_MAX, BRACKET_CLOSE, BRACKET_OPEN, BRACKET_SCAN_LIMIT, CODE_FENCE_PREFIX, CURLY_QUOTE_OPEN, QUOTE_CHARS, QUOTE_LINE_SCAN, blockLineInfo, isBlockquoteMarker, isQuoteDelimiter } from "../text.js";

// ---- Bracket Tether ----------------------------------------------------
  // Find the position of the bracket matching the one at `at`, or -1.
  //
  // This is a plain depth count over the raw text, not a syntax-aware match:
  // CodeMirror's own bracket matching lives in @codemirror/language, which
  // isn't reachable from a plugin without bundling it. The practical
  // difference is that a bracket inside a string or comment still counts, so
  // the tether can occasionally point somewhere a compiler wouldn't. For a
  // decorative guide in a Markdown editor that's an acceptable trade; it is
  // NOT a good enough basis for anything that edits text.
  //
  // The one Markdown fact it does know is that a ">" opening a line is a
  // blockquote marker, not an angle bracket. Without that, every line of a
  // callout offers a fresh false partner to any "<" above it, which is the
  // most visible way this goes wrong in a real vault - and no boundary check
  // catches it, because the marker sits at the same quote depth as the "<".
export var paintTetherMethods = {
  matchingBracketPos(doc, at, ch) {
    const open = BRACKET_OPEN[ch] ? ch : BRACKET_CLOSE[ch];
    if (!open) return -1;
    const close = BRACKET_OPEN[open];
    const forward = ch === open;
    const len = doc.length;
    if (forward) {
      const end = Math.min(len, at + BRACKET_SCAN_LIMIT);
      const text = doc.sliceString(at, end);
      let depth = 0;
      let inPrefix = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\n") {
          inPrefix = true;
          continue;
        }
        if (inPrefix) {
          if (c === " " || c === "	" || c === ">") continue;
          inPrefix = false;
        }
        if (c === open) depth++;
        else if (c === close) {
          if (--depth === 0) return at + i;
        }
      }
    } else {
      const start = Math.max(0, at - BRACKET_SCAN_LIMIT + 1);
      const text = doc.sliceString(start, at + 1);
      const angles = close === ">";
      let depth = 0;
      for (let i = text.length - 1; i >= 0; i--) {
        const c = text[i];
        if (angles && c === ">" && isBlockquoteMarker(text, i, start)) continue;
        if (c === close) depth++;
        else if (c === open) {
          if (--depth === 0) return start + i;
        }
      }
    }
    return -1;
  },
  // Whether the character at `at` is a blockquote marker. Used to stop the
  // caret tethering FROM one - parking next to the ">" that opens a callout
  // line should do nothing, not hunt backwards for a "<".
  isQuoteMarkerAt(doc, at) {
    if (doc.sliceString(at, at + 1) !== ">") return false;
    const back = Math.max(0, at - BLOCK_PREFIX_MAX);
    return isBlockquoteMarker(doc.sliceString(back, at + 1), at - back, back);
  },
  // The text of the line containing `pos`, plus that line's start offset.
  // Capped rather than using doc.lineAt so this works on any doc-like object
  // exposing length/sliceString, and so a pathological single-line file can't
  // turn one frame into a megabyte read.
  lineBoundsAt(doc, pos) {
    const from = Math.max(0, pos - QUOTE_LINE_SCAN);
    const to = Math.min(doc.length, pos + QUOTE_LINE_SCAN);
    const chunk = doc.sliceString(from, to);
    const rel = pos - from;
    const s = rel <= 0 ? 0 : chunk.lastIndexOf("\n", rel - 1) + 1;
    let e = chunk.indexOf("\n", rel);
    if (e < 0) e = chunk.length;
    return { start: from + s, text: chunk.slice(s, e) };
  },
  // The innermost quoted run on this line that contains (or touches) the
  // caret. Straight quotes are taken left to right - 1st with 2nd, 3rd with
  // 4th - among the quotes that qualify as delimiters. Curly quotes are
  // directional, so an opener is matched to its own nearest closer instead.
  quoteSpanAt(doc, pos) {
    const { start, text } = this.lineBoundsAt(doc, pos);
    const rel = pos - start;
    let best = null;
    const consider = (a, b) => {
      if (rel < a || rel > b + 1) return;
      if (!best || a > best.from) best = { from: start + a, to: start + b };
    };
    for (const q of QUOTE_CHARS) {
      const marks = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === q && isQuoteDelimiter(text, i)) marks.push(i);
      }
      for (let i = 0; i + 1 < marks.length; i += 2) consider(marks[i], marks[i + 1]);
    }
    for (const openCh in CURLY_QUOTE_OPEN) {
      const closeCh = CURLY_QUOTE_OPEN[openCh];
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== openCh) continue;
        let depth = 1;
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] === openCh) depth++;
          else if (text[j] === closeCh && isQuoteDelimiter(text, j)) {
            if (--depth === 0) {
              consider(i, j);
              break;
            }
          }
        }
      }
    }
    return best;
  },
  // The innermost bracket pair the caret sits *inside*, for when it isn't
  // touching a bracket at all. Walks back looking for an opener that hasn't
  // already been closed, tracking each bracket type separately so an unrelated
  // `]` in the middle of a `(...)` doesn't derail the count.
  enclosingBracketSpan(doc, pos) {
    const start = Math.max(0, pos - BRACKET_SCAN_LIMIT);
    const text = doc.sliceString(start, pos);
    const depth = {};
    for (const closer in BRACKET_CLOSE) depth[closer] = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      const c = text[i];
      if (BRACKET_CLOSE[c]) {
        if (c === ">" && isBlockquoteMarker(text, i, start)) continue;
        depth[c]++;
        continue;
      }
      const closer = BRACKET_OPEN[c];
      if (!closer) continue;
      if (depth[closer] > 0) {
        depth[closer]--;
        continue;
      }
      const from = start + i;
      const to = this.matchingBracketPos(doc, from, c);
      return to >= 0 ? { from, to } : null;
    }
    return null;
  },
  // True when a structural block boundary falls between two offsets - i.e. the
  // pair runs into, out of, or clean across a code block, blockquote or
  // callout. See blockLineInfo for why fences and quotes are detected
  // differently but resolved in one walk.
  //
  // The line the span BEGINS on sets the baseline depth and is exempt from the
  // fence test: a bracket sitting on a fence line must not cut its own tether,
  // and only lines that actually begin inside the span can introduce a fence.
  crossesBlockBoundary(doc, from, to) {
    if (!(to > from)) return false;
    const back = Math.max(0, from - BLOCK_LINE_LOOKBACK);
    const text = doc.sliceString(back, Math.min(doc.length, to + CODE_FENCE_PREFIX));
    const rel = from - back;
    const relTo = to - back;
    let ls = rel <= 0 ? 0 : text.lastIndexOf("\n", rel - 1) + 1;
    let base = -1;
    while (ls <= relTo) {
      let le = text.indexOf("\n", ls);
      if (le < 0) le = text.length;
      const info = blockLineInfo(text.slice(ls, Math.min(le, ls + BLOCK_HEAD_MAX)));
      if (base < 0) {
        base = info.depth;
      } else {
        if (info.fence) return true;
        if (info.depth !== base) return true;
      }
      if (le >= text.length) break;
      ls = le + 1;
    }
    return false;
  },
  // What the tether should join, as { from, to } document offsets with
  // from <= to, or null.
  //
  // Order matters: a bracket the caret is actually touching wins over anything
  // it merely sits inside, because that's the one you just typed or arrowed
  // onto. Failing that, the innermost enclosing run wins - whichever of the
  // quote or bracket candidates opens closest to the caret.
  tetherSpan(doc, pos) {
    const len = doc.length;
    const adjacent = [];
    if (pos > 0) adjacent.push(pos - 1);
    if (pos < len) adjacent.push(pos);
    for (const at of adjacent) {
      const ch = doc.sliceString(at, at + 1);
      if (!BRACKET_OPEN[ch] && !BRACKET_CLOSE[ch]) continue;
      if (ch === ">" && this.isQuoteMarkerAt(doc, at)) continue;
      const m = this.matchingBracketPos(doc, at, ch);
      if (m < 0) continue;
      const from = Math.min(at, m), to = Math.max(at, m);
      if (this.crossesBlockBoundary(doc, from, to)) continue;
      return { from, to };
    }
    const q = this.quoteSpanAt(doc, pos);
    let b = this.enclosingBracketSpan(doc, pos);
    if (b && this.crossesBlockBoundary(doc, b.from, b.to)) b = null;
    if (q && b) return q.from > b.from ? q : b;
    return q || b || null;
  },
  // The tether for this frame, as an array of horizontal rules ordered top to
  // bottom - one per line the pair covers - in viewport pixels (the canvas is
  // fixed at 0,0, so viewport coords ARE canvas coords, the same assumption
  // cmCaretCoords and secondaryCaretCoords make). Returns null when there's
  // nothing to draw.
  // With no head this is the primary's tether, at the main selection. A
  // secondary passes its own head (and whether its range is empty), with its
  // bundle swapped in so the caches below are its own.
  bracketTetherCoords(view, head, empty) {
    if (!view || !view.hasFocus) return null;
    try {
      const state = view.state;
      const main = state.selection.main;
      if (head === void 0) {
        head = main.head;
        empty = main.empty;
      }
      if (!empty) return null;
      const doc = state.doc;
      const pos = head;
      const len = doc.length;
      const key = pos + ":" + len;
      let from, to;
      if (this._tetherKey === key) {
        from = this._tetherFrom;
        to = this._tetherTo;
      } else {
        const span = this.tetherSpan(doc, pos);
        from = span ? span.from : -1;
        to = span ? span.to : -1;
        this._tetherKey = key;
        this._tetherFrom = from;
        this._tetherTo = to;
      }
      if (from < 0 || to < 0) return null;
      const a = view.coordsAtPos(from, 1) || view.coordsAtPos(from, -1);
      const b = view.coordsAtPos(to, 1) || view.coordsAtPos(to, -1);
      if (!a || !b) return null;
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1;
        for (const c of [a, b]) {
          const cBottom = c.bottom ?? c.top;
          if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) return null;
        }
      }
      const segs = this.tetherSegments(view, from, to, a, b);
      return segs && segs.length ? segs : null;
    } catch (e) {
      this._reportOnce("bracketTetherCoords", e);
      return null;
    }
  },
  // The tether as one or more horizontal rules, ordered top to bottom, each
  // { x1, y1, x2, y2 } in viewport pixels.
  //
  // A pair that fits on one line is a single rule from the opener to the
  // closer. A pair that does NOT - because the text is long enough to soft-wrap
  // or because it genuinely spans several lines - used to be that same single
  // rule, which meant one long diagonal drawn from the opening bracket down and
  // across to the closing one: it sloped through the middle of everything in
  // between, struck out text it had nothing to say about, and gave no sense of
  // what the pair actually contained. So a multi-line span is now measured
  // per line instead, and each covered line gets its own level rule beneath
  // just the part of that line the pair spans - the whole span underlined,
  // rather than a chord cut across it.
  //
  // `a` and `b` are the already-resolved coordinates of the two brackets.
  tetherSegments(view, from, to, a, b) {
    const drop = 1.5;
    const glyph = Math.max(3, (b.bottom - b.top) * 0.42);
    const flat = [{
      x1: a.left,
      y1: a.bottom + drop,
      x2: b.left + glyph,
      y2: b.bottom + drop
    }];
    if (Math.abs(a.bottom - b.bottom) < 1) return flat;
    const key = from + ":" + to + ":" + view.state.doc.length;
    const cached = this._tetherSegs;
    if (cached && this._tetherSegKey === key && this._tetherAnchorA && this._tetherAnchorB) {
      const dx = a.left - this._tetherAnchorA.x;
      const dy = a.bottom - this._tetherAnchorA.y;
      if (Math.abs(b.left - this._tetherAnchorB.x - dx) < 0.5 && Math.abs(b.bottom - this._tetherAnchorB.y - dy) < 0.5) {
        if (dx === 0 && dy === 0) return cached;
        return cached.map((s) => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }));
      }
    }
    const rects = this.rangeLineRects(view, from, Math.min(view.state.doc.length, to + 1));
    const segs = rects.length >= 2 ? rects.map((r) => ({ x1: r.left, y1: r.bottom + drop, x2: r.right, y2: r.bottom + drop })) : flat;
    this._tetherSegKey = key;
    this._tetherSegs = segs;
    this._tetherAnchorA = { x: a.left, y: a.bottom };
    this._tetherAnchorB = { x: b.left, y: b.bottom };
    return segs;
  },
  // The line boxes a document range occupies, as { left, right, bottom } in
  // viewport pixels, one entry per line, top to bottom.
  //
  // Measured through a DOM Range rather than through coordsAtPos because only
  // the DOM knows where a soft-wrapped line actually breaks: getClientRects
  // hands back one rect per line box, so a span that wraps comes back already
  // split at its wrap points, with proportional glyph widths and bidi runs
  // accounted for. CodeMirror can only answer "where is offset N", which would
  // find the hard line breaks and miss every soft one - i.e. exactly the case
  // this is here for.
  //
  // One Range per logical line, rather than one Range for the whole span, on
  // purpose: a Range that FULLY contains a .cm-line element also reports that
  // element's own border box, which is the full width of the editor, so every
  // middle line would measure as a full-width rule running way past the end of
  // its text. Keeping each Range strictly inside one line means only the text
  // within it is ever measured.
  rangeLineRects(view, from, to) {
    const doc = view.state.doc;
    const out = [];
    if (to <= from) return out;
    const first = doc.lineAt(from);
    const last = doc.lineAt(to);
    if (last.number - first.number > 300) return out;
    const ownerDoc = view.dom.ownerDocument;
    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n);
      const s = Math.max(from, line.from);
      const e = Math.min(to, line.to);
      if (e <= s) continue;
      let rects;
      try {
        const ds = view.domAtPos(s);
        const de = view.domAtPos(e);
        if (!ds || !de || !ds.node || !de.node) continue;
        const range = ownerDoc.createRange();
        range.setStart(ds.node, ds.offset);
        range.setEnd(de.node, de.offset);
        rects = range.getClientRects();
      } catch {
        continue;
      }
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r || r.width < 0.5 || r.height < 0.5) continue;
        let merged = false;
        for (const o of out) {
          if (Math.abs(o.bottom - r.bottom) < 1.5) {
            o.left = Math.min(o.left, r.left);
            o.right = Math.max(o.right, r.right);
            merged = true;
            break;
          }
        }
        if (!merged) out.push({ left: r.left, right: r.right, bottom: r.bottom });
      }
    }
    out.sort((p, q) => p.bottom - q.bottom || p.left - q.left);
    return out;
  },
  // Stroke for one rule of the tether, where that rule covers t0..t1 (as
  // fractions) of the whole run.
  //
  // With the gradient on, the ramp is spread across the entire span rather than
  // restarted on each line: the canvas gradient is anchored at the virtual
  // points where fractions 0 and 1 would land on this rule's own axis, so
  // consecutive lines pick up consecutive slices of one ramp and the tether
  // still reads as a single object, the way it does with the cursor.
  tetherStroke(ctx, s, t0, t1, alpha) {
    if (!this.look.gradientEnabled) return hexToRgba(this.getActiveColor(), alpha);
    const span = Math.max(1e-4, t1 - t0);
    const ux = (s.x2 - s.x1) / span;
    const uy = (s.y2 - s.y1) / span;
    const g = ctx.createLinearGradient(
      s.x1 - ux * t0,
      s.y1 - uy * t0,
      s.x1 + ux * (1 - t0),
      s.y1 + uy * (1 - t0)
    );
    const stops = this.gradientStops();
    for (let i = 0; i < stops.length; i++) {
      const [r, gg, b] = hexToRgbTuple(stops[i]);
      g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, `rgba(${r}, ${gg}, ${b}, ${alpha})`);
    }
    return g;
  },
  drawBracketTether() {
    const segs = this.bracketTether;
    if (!segs || !segs.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const strength = Math.max(0, Math.min(1, this.look.bracketTetherStrength ?? 0.35));
    const alpha = strength * opacity;
    if (alpha <= 0.01) return;
    const lens = [];
    let total = 0;
    for (const s of segs) {
      const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      lens.push(l);
      total += l;
    }
    if (total < 2) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    const tick = 4;
    const last = segs.length - 1;
    let run = 0;
    for (let i = 0; i <= last; i++) {
      const s = segs[i];
      const len = lens[i];
      if (len < 0.5) continue;
      ctx.strokeStyle = this.tetherStroke(ctx, s, run / total, (run + len) / total, alpha);
      run += len;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      if (i === 0) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x1, s.y1 - tick);
      }
      if (i === last) {
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2, s.y2 - tick);
      }
      ctx.stroke();
    }
    ctx.restore();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of segs) {
      minX = Math.min(minX, s.x1, s.x2);
      maxX = Math.max(maxX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2);
      maxY = Math.max(maxY, s.y1, s.y2);
    }
    const pad = tick + 4;
    this._markDirty(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  },
  // The primary's tether segments plus every secondary's, as one list for
  // drawBracketTether; null when nobody has one.
  mergeTethers(primary) {
    let out = primary && primary.length ? primary : null;
    const states = this._secondaries;
    if (states && states.length) {
      for (const st of states) {
        const t = st._tetherOut;
        if (t && t.length) out = out ? out.concat(t) : t.slice();
      }
    }
    return out;
  }
};

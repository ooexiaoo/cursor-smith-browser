// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { DIRTY_RECT_CLEAR, SERIF_MAX_SPAN_RATIO, SERIF_MIN_SPAN_PX } from "../constants.js";

export var paintFrameMethods = {
  // The cursor's own damage bounds, in client coordinates: the interpolated
  // caret, the entire smear quad (which overshoots well past the caret on a
  // fast move), any held character and the serifs, padded for glow
  // (shadowBlur maxes at 10), outline width, antialiasing and a Signal Glitch
  // throw. Marked dirty once from draw() rather than threaded through every
  // branch of drawBoxCursor/drawGenericCaret - and read by _frameNeed to place
  // the canvas, so the region and the damage rect cannot disagree.
  // Null when there is no caret.
  _cursorBounds() {
    const a = this.animActive;
    if (!a) return null;
    let x0 = a.x, y0 = a.top;
    let x1 = a.x + Math.max(a.w || 0, a.actualCharWidth || 0);
    let y1 = a.top + (a.h || 0);
    for (const src of [this.smearQuad, this.smearShape]) {
      if (!src) continue;
      for (const k of Object.keys(src)) {
        if (src[k].x < x0) x0 = src[k].x;
        if (src[k].y < y0) y0 = src[k].y;
        if (src[k].x > x1) x1 = src[k].x;
        if (src[k].y > y1) y1 = src[k].y;
      }
    }
    if (this.styleFor("cursorStyle") === "Line" && this.look.lineSerifs) {
      const halfSpan = Math.max(
        SERIF_MIN_SPAN_PX,
        Math.min(a.actualCharWidth || 0, (a.h || 0) * SERIF_MAX_SPAN_RATIO)
      ) / 2;
      const cx = a.x + (a.w || 0) / 2;
      if (cx - halfSpan < x0) x0 = cx - halfSpan;
      if (cx + halfSpan > x1) x1 = cx + halfSpan;
    }
    let pad = 24 + Math.max(0, this.look.caretWidthPx || 0);
    if (this.look.crtEffect && this.look.glow) {
      pad += 10 * (this.glowHeatScale() - 1);
    }
    if (this.glitch) {
      const st = Math.max(0, Math.min(2.5, this.look.crtGlitchStrength ?? 1));
      const abr = Math.max(0, Math.min(3, this.look.crtGlitchAberration ?? 1));
      pad += 14 * st * 2.2 + 3.2 * abr + (a.w || 0) * 0.3 + 4;
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  },
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = this._canvasRect;
    if (!r) return;
    const rx0 = r.x, ry0 = r.y, rx1 = r.x + r.w, ry1 = r.y + r.h;
    if (!DIRTY_RECT_CLEAR || this._dirtyFull) {
      ctx.clearRect(rx0, ry0, r.w, r.h);
      this._dirtyFull = false;
    } else if (this._dirtyPrev) {
      const p = this._dirtyPrev;
      ctx.clearRect(p.x, p.y, p.w, p.h);
    }
    this._dirty = null;
    this.drawLettersParticles();
    this.drawBracketTether();
    this.drawStardust();
    this.drawFlamePixels();
    this.drawHotHead();
    this.drawThunderbolts();
    this.drawFireworks();
    const a = this.animActive;
    const cb = this._cursorBounds();
    const breath = a ? this.breathScale(performance.now()) : 1;
    const breathing = breath < 0.999;
    if (breathing && a) {
      const cx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
      const cy = a.top + (a.h || 0) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breath, breath);
      ctx.translate(-cx, -cy);
    }
    this.applyCanvasBlend();
    switch (this.styleFor("cursorStyle")) {
      case "Line":
        this.drawGenericCaret(false);
        break;
      case "Underline":
        this.drawGenericCaret(true);
        break;
      case "Box":
        this.drawBoxCursor();
        break;
    }
    if (breathing) ctx.restore();
    const secBounds = this.drawFullSecondaries();
    this.drawSecondaryCarets();
    const e = this._dirty;
    this._dirtyRaw = e ? { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 } : null;
    if (cb) this._markDirty(cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0);
    for (const b of secBounds) this._markDirty(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    const d = this._dirty;
    if (!d) {
      this._dirtyPrev = null;
      return;
    }
    const cx0 = Math.max(rx0, Math.floor(d.x0) - 2);
    const cy0 = Math.max(ry0, Math.floor(d.y0) - 2);
    const cx1 = Math.min(rx1, Math.ceil(d.x1) + 2);
    const cy1 = Math.min(ry1, Math.ceil(d.y1) + 2);
    this._dirtyPrev = cx1 > cx0 && cy1 > cy0 ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null;
  },
  // Puts the canvas layer into (or back out of) a blend mode, which is what
  // cursorTranslucent actually is.
  //
  // This CANNOT be done with ctx.globalCompositeOperation. The cursor canvas
  // is its own layer stacked over the editor, so a canvas-level "multiply"
  // blends against what this canvas has already painted this frame - nothing,
  // it was just cleared - not against the text underneath. Real backdrop
  // blending has to come from CSS.
  //
  // And it has to go on the WRAPPER, not the canvas. The wrapper is
  // position:fixed with a z-index, which makes it a stacking context, and a
  // stacking context confines its descendants' blending to itself: a
  // mix-blend-mode on the canvas inside would blend against the wrapper's own
  // empty background and produce no visible change at all. On the wrapper the
  // blend applies to the whole group against its parent's content - i.e. the
  // editor. (Which also means an `isolation: isolate` anywhere between the
  // wrapper and .app-container would silently turn this feature off. Don't
  // add one, in either file.)
  //
  // Multiply darkens and screen lightens, so which of the two reads as ink on
  // the page depends on what's behind it: multiply on a light theme, screen
  // on a dark one. Picking by theme keeps the cursor legible in both instead
  // of sinking into the background in one of them.
  //
  // Called from the draw dispatch, before the per-style branch, so it runs on
  // every frame regardless of style - including the frames that have to CLEAR
  // it. Writes only on change: a blend-mode style write forces the compositor
  // to re-evaluate the layer, so doing it per frame would cost real work to
  // set the value it already had.
  applyCanvasBlend() {
    const el = this.canvasWrapper;
    if (!el) return;
    const want = this.styleFor("cursorTranslucent") ? this.isDarkTheme() ? "screen" : "multiply" : "normal";
    if (this._canvasBlend === want) return;
    this._canvasBlend = want;
    el.style.mixBlendMode = want;
  }
};

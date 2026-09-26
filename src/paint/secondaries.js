// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hexToRgbTuple, hexToRgba } from "../color.js";
import { SECONDARY_FULL_MAX } from "../constants.js";
import { blinkAlpha } from "../demo.js";

export var paintSecondariesMethods = {
  // The plain fallback: a solid 2px vertical line for every non-primary caret
  // PAST SECONDARY_FULL_MAX. The first SECONDARY_FULL_MAX get the primary's
  // whole pipeline instead (drawFullSecondaries); this is what the rest
  // are, and what every secondary was before that. Blinks in sync with the
  // main cursor so all carets fade together.
  //
  // Colour follows the primary cursor, including its Gradient: with Gradient
  // on, each secondary caret gets the whole ramp down its own height, the same
  // way cursorPaint() paints the primary one. It used to take getActiveColor()
  // in every case, which for a gradient cursor is the ramp's FIRST STOP - so a
  // multi-cursor edit put one caret in full colour and the rest in a flat slice
  // of it, which reads as the extra carets being a different, wrong colour.
  //
  // The ramp is resolved ONCE per frame, not once per caret. A CanvasGradient
  // is tied to absolute canvas coordinates, so each caret does need its own
  // object - but the expensive part (walking the stops, applying Speed Demon's
  // heat, building an rgba() string per stop) does not depend on position, and
  // multi-cursor edits are exactly where the caret count can run into the
  // hundreds. Same reasoning as the firework sparks' baked palette.
  drawSecondaryCarets() {
    const carets = this.secondaryCarets;
    if (!carets || carets.length === 0) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const alpha = this.blinkAlpha(performance.now()) * opacity;
    if (alpha <= 0.01) return;
    const strokeAlpha = 0.9 * alpha;
    let ramp = null;
    if (this.look.gradientEnabled) {
      ramp = this.gradientStops().map((hex) => {
        const [r, g, b] = hexToRgbTuple(hex);
        return `rgba(${r}, ${g}, ${b}, ${strokeAlpha})`;
      });
    }
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = this.styleFor("cursorRounded") ? "round" : "butt";
    if (!ramp) ctx.strokeStyle = hexToRgba(this.getActiveColor(), strokeAlpha);
    for (const c of carets) {
      const x = Math.round(c.x) + 0.5;
      const h = c.bottom - c.top;
      if (ramp) {
        if (h > 0) {
          const grad = ctx.createLinearGradient(x, c.top, x, c.bottom);
          for (let i = 0; i < ramp.length; i++) {
            grad.addColorStop(i / (ramp.length - 1), ramp[i]);
          }
          ctx.strokeStyle = grad;
        } else {
          ctx.strokeStyle = ramp[0];
        }
      }
      this._markDirty(x - 3, c.top - 2, 6, h + 4);
      ctx.beginPath();
      ctx.moveTo(x, c.top);
      ctx.lineTo(x, c.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
  // Draw every full-effect secondary with the primary's own painters, and
  // return each one's damage bounds for draw() to mark after its snapshot
  // (see the note on _dirtyRaw there: a cursor's own bounds must not be in
  // the effects-only union).
  drawFullSecondaries() {
    const states = this._secondaries;
    const bounds = [];
    if (!states || states.length === 0) return bounds;
    const ctx = this.ctx;
    if (!ctx) return bounds;
    const style = this.styleFor("cursorStyle");
    for (const st of states) {
      if (!st.animActive) continue;
      this._withCaret(st, () => {
        const a = this.animActive;
        if (!a) return;
        const cb = this._cursorBounds();
        if (cb) bounds.push(cb);
        const breath = this.breathScale(performance.now());
        const breathing = breath < 0.999;
        if (breathing) {
          const cx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
          const cy = a.top + (a.h || 0) / 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(breath, breath);
          ctx.translate(-cx, -cy);
        }
        switch (style) {
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
      });
    }
    return bounds;
  }
};

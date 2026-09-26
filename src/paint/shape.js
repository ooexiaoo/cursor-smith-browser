// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { readableGlyphColor } from "../color.js";
import { ROUNDED_BLOCK_FRACTION, ROUNDED_THIN_PX, SERIF_HEIGHT_RATIO, SERIF_MAX_SPAN_RATIO, SERIF_MIN_SPAN_PX, SERIF_STEM_RATIO, SERIF_TAPER, TRANSLUCENT_ALPHA } from "../constants.js";
import { blinkAlpha } from "../demo.js";

export var paintShapeMethods = {
  // The corner radius for a shape whose narrow axis is `minor` px.
  //
  // Rounding is a toggle, not a dial, so this decides the radius - and it is
  // deliberately NOT one constant. "Rounded" means different things for a
  // 3px Line stem and a 8x24 Box: a quarter of the minor axis is a pleasant
  // soft corner on a block and invisible on a bar, while a full capsule is
  // right for a bar and turns a block into a stadium. So thin shapes (the
  // Line stem, the Underline bar, serifs) go fully round and blocks get the
  // softer quarter.
  //
  // ROUNDED_THIN_PX is the width below which a shape reads as a bar rather
  // than a block. Anything at or under it is basically all edge, so there is
  // no flat middle for a partial radius to preserve.
  cornerRadius(minor) {
    if (!this.styleFor("cursorRounded")) return 0;
    const m = Math.max(0, minor);
    if (m <= 0) return 0;
    const r = m <= ROUNDED_THIN_PX ? m / 2 : m * ROUNDED_BLOCK_FRACTION;
    return Math.min(r, m / 2);
  },
  // Trace a quad - optionally with rounded corners - WITHOUT filling it.
  //
  // Split out from fillCursorShape so the hollow outline can stroke exactly
  // the shape the solid style fills. Those two used to be separate bodies of
  // code with a comment admitting the duplication, which is precisely why
  // rounding had to touch both or neither.
  //
  // arcTo does the rounding rather than roundRect, for two reasons. The
  // shape is NOT always an axis-aligned rect: with Motion Smear on it is an
  // arbitrary quad from the smear spring, which roundRect cannot express at
  // all. And roundRect needs Chromium 99 / iOS 16.4, while this plugin ships
  // with isDesktopOnly false - arcTo has been universal for a decade.
  traceQuad(ctx, corners, radius = 0) {
    const pts = [corners.tl, corners.tr, corners.br, corners.bl];
    if (!(radius > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }
    let r = radius;
    for (let i = 0; i < 4; i++) {
      const prev = pts[(i + 3) % 4], cur = pts[i], next = pts[(i + 1) % 4];
      const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
      const v2x = next.x - cur.x, v2y = next.y - cur.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (!(l1 > 1e-6) || !(l2 > 1e-6)) {
        r = 0;
        break;
      }
      const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
      const theta = Math.acos(cos);
      const lim = Math.min(l1, l2) / 2 * Math.tan(theta / 2);
      if (lim < r) r = lim;
    }
    if (!(r > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const seed = mid(pts[3], pts[0]);
    ctx.moveTo(seed.x, seed.y);
    for (let i = 0; i < 4; i++) {
      const corner = pts[i];
      const next = pts[(i + 1) % 4];
      ctx.arcTo(corner.x, corner.y, next.x, next.y, r);
    }
    ctx.closePath();
  },
  // The caret's body as a set of corner points: the smear quad while Motion
  // Smear is deforming it, otherwise the plain rect.
  cursorCorners(rx, ry, rw, rh) {
    return this.smearCorners() || {
      tl: { x: rx, y: ry },
      tr: { x: rx + rw, y: ry },
      br: { x: rx + rw, y: ry + rh },
      bl: { x: rx, y: ry + rh }
    };
  },
  fillCursorShape(ctx, rx, ry, rw, rh) {
    const corners = this.cursorCorners(rx, ry, rw, rh);
    ctx.beginPath();
    this.traceQuad(ctx, corners, this.cornerRadius(Math.min(rw, rh)));
    ctx.fill();
  },
  // An axis-aligned rect as a rounded subpath, for the trail ghosts and the
  // neon tube. These never smear (a trail ghost is a snapshot of where the
  // caret WAS, so it has no spring state of its own), so they don't need the
  // quad machinery - but they do need to match the live caret's rounding, or
  // a rounded cursor drags a tail of little sharp boxes behind it.
  traceRoundedRect(ctx, x, y, w, h, radius) {
    const r = Math.min(Math.max(0, radius), Math.min(w, h) / 2);
    if (!(r > 0.01)) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },
  fillTrailRect(ctx, x, y, w, h) {
    const r = this.cornerRadius(Math.min(w, h));
    if (!(r > 0.01)) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    this.traceRoundedRect(ctx, x, y, w, h, r);
    ctx.fill();
  },
  // The two serif brackets of an I-beam caret, as corner quads ready to add
  // to the stem's path.
  //
  // Two things this fixes over the pair of fillRects it replaces.
  //
  // ANCHORING. fillCursorShape ignores the rect it is handed whenever Motion
  // Smear is on and fills the spring's quad instead - but the serifs were
  // positioned from `active`, the RESTING geometry. So the moment the caret
  // moved, the stem leaned and stretched away while the serifs stayed nailed
  // to where it had been, leaving two horizontal bars floating next to a
  // detached stem. With smear on by default that was the common case, not an
  // edge case. Here they take their centres from the smeared quad's own top
  // and bottom edges, so they travel with the stem.
  //
  // They stay AXIS-ALIGNED while doing it. Shearing a serif with the quad
  // makes it read as a broken glyph, which is what the original comment was
  // rightly worried about - but the answer to that is to keep them level,
  // not to leave them behind.
  //
  // SHAPE. A real I-beam's serifs are brackets: they thin as they approach
  // the stem rather than butting into it at full weight. Each one is a
  // trapezoid, widest at its outer edge, narrowing by SERIF_TAPER where it
  // meets the stem. Returns the union bounds too, so the caller can size a
  // gradient or pattern over the whole glyph rather than the stem alone.
  serifQuads(active, rx, rw) {
    const stem = rw;
    const lineH = active.h;
    const thickness = Math.max(
      1,
      Math.round(Math.min(stem * SERIF_STEM_RATIO, lineH * SERIF_HEIGHT_RATIO))
    );
    const charW = active.actualCharWidth;
    const raw = charW && charW > 0 ? charW : stem * 7;
    const span = Math.max(SERIF_MIN_SPAN_PX, Math.min(raw, lineH * SERIF_MAX_SPAN_RATIO));
    const c = this.cursorCorners(rx, active.top, rw, lineH);
    const dir = this._smearDir;
    const anchor = (a, b) => {
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (!(len > 1e-3)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const aLeads = !!dir && ex * dir.x + ey * dir.y < 0;
      const lead = aLeads ? a : b;
      const sign = aLeads ? -1 : 1;
      const back = Math.min(len, stem) / 2;
      return {
        x: lead.x - sign * (ex / len) * back,
        y: lead.y - sign * (ey / len) * back
      };
    };
    const top = anchor(c.tl, c.tr), bot = anchor(c.bl, c.br);
    const topCx = top.x, topCy = top.y;
    const botCx = bot.x, botCy = bot.y;
    const half = span / 2;
    const inset = half * SERIF_TAPER;
    const quads = [
      {
        tl: { x: topCx - half, y: topCy },
        tr: { x: topCx + half, y: topCy },
        br: { x: topCx + half - inset, y: topCy + thickness },
        bl: { x: topCx - half + inset, y: topCy + thickness }
      },
      {
        tl: { x: botCx - half + inset, y: botCy - thickness },
        tr: { x: botCx + half - inset, y: botCy - thickness },
        br: { x: botCx + half, y: botCy },
        bl: { x: botCx - half, y: botCy }
      }
    ];
    return {
      quads,
      left: Math.min(topCx, botCx) - half,
      right: Math.max(topCx, botCx) + half,
      // A serif is a thin bar, so it rounds on its own thickness rather than
      // on the stem's width - otherwise a rounded Box-sized radius would eat
      // the whole bracket.
      radius: this.cornerRadius(thickness)
    };
  },
  // The steps the two caret painters share (drawGenericCaret for Line and
  // Underline, drawBoxCursor for Box): the trail pass, arming the CRT glow,
  // the glitch state, the body's paint. They were two parallel copies of the
  // same structure, which is how the two could drift apart at all. The
  // goldens hold the two painters' ops identical to before the extraction.
  //
  // The trail: one save/restore round the ghosts, and only with a trail to
  // paint - the pair exists to undo the shadow the neon ghosts arm, and
  // with CRT off (or every ghost faded) it undid nothing. A neon ghost is
  // the caret's own footprint as a glowing tube (the bar for Underline, the
  // char box for Box, filled even when the box is hollow - a hollow outline
  // of a glowing tail reads as noise); a plain ghost is the flat trail
  // paint, built from the bar's own rect for Underline (a ramp spanning the
  // whole line height would show only the sliver that falls across the
  // bar), stroked as an inset outline for a hollow Box (canvas strokes
  // straddle the path, so the outline lands inside the footprint the filled
  // dot would occupy), filled otherwise.
  _paintTrail(ctx, style, color, bodyOpacity, strokeW) {
    const settings = this.look;
    if (!settings.crtEffect || !this.trail.length) return;
    ctx.save();
    this.forEachTrailPoint((p, alpha, age) => {
      const a = alpha * bodyOpacity;
      if (settings.crtNeon) {
        if (style === "Underline") {
          const uThickness = this.underlineThickness(p.h);
          const ty = p.y + p.h - uThickness;
          this.drawNeonGhost(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, a, age, color);
        } else {
          this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, a, age, color);
        }
      } else if (style === "Underline") {
        const uThickness = this.underlineThickness(p.h);
        const ty = p.y + p.h - uThickness;
        ctx.fillStyle = this.trailPaint(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, a, age, color);
        this.fillTrailRect(ctx, p.x, ty, p.w, uThickness);
      } else if (style === "Box" && strokeW > 0) {
        ctx.strokeStyle = this.trailPaint(ctx, p, a, age, color);
        ctx.lineWidth = strokeW;
        const inset = strokeW / 2;
        const iw = Math.max(0, p.w - strokeW), ih = Math.max(0, p.h - strokeW);
        const rr = this.cornerRadius(Math.min(iw, ih));
        if (rr > 0.01) {
          ctx.beginPath();
          this.traceRoundedRect(ctx, p.x + inset, p.y + inset, iw, ih, rr);
          ctx.stroke();
        } else {
          ctx.strokeRect(p.x + inset, p.y + inset, iw, ih);
        }
      } else {
        ctx.fillStyle = this.trailPaint(ctx, p, a, age, color);
        this.fillTrailRect(ctx, p.x, p.y, p.w, p.h);
      }
    });
    ctx.restore();
  },
  // The CRT glow: a shadow in the caret's colour, its blur scaled by the
  // blink (it fades with the caret) and by Speed demon's heat. `blur` is
  // the style's base blur times the blink alpha.
  _armGlow(ctx, color, blur) {
    const settings = this.look;
    if (settings.crtEffect && settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * this.glowHeatScale();
    }
  },
  // A live Signal Glitch burst, or null. Resolved before the body's paint is
  // built, so a burst skips the (possibly expensive) beam paint it would
  // discard.
  _glitchNow(now) {
    const settings = this.look;
    return settings.crtEffect && settings.crtGlitch ? this.glitchState(now) : null;
  },
  // The paint for the caret's body over the rect it will actually cover: the
  // energy beam when it is on, otherwise the flat colour or the gradient.
  _bodyPaint(x, y, w, h, color, alpha) {
    return this.look.energyEffect ? this.energyPaint(x, y, w, h, color, alpha) : this.cursorPaint(x, y, w, h, color, alpha);
  },
  drawGenericCaret(isUnderline = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const active = this.animActive;
    const now = performance.now();
    const trailColor = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const bodyOpacity = this.styleFor("cursorTranslucent") ? opacity * TRANSLUCENT_ALPHA : opacity;
    this._paintTrail(ctx, isUnderline ? "Underline" : "Line", trailColor, bodyOpacity, 0);
    if (!active) return;
    const blinkAlpha2 = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";
    ctx.save();
    this._armGlow(ctx, color, 8 * blinkAlpha2);
    let rx, ry, rw, rh;
    if (isUnderline) {
      const uThickness = this.underlineThickness(active.h);
      rx = active.x;
      ry = active.top + active.h - uThickness;
      rw = active.actualCharWidth;
      rh = uThickness;
    } else {
      rx = active.x;
      ry = active.top;
      rw = this.renderWidth(active);
      rh = active.h;
    }
    const gsGen = this._glitchNow(now);
    const wantSerifs = !isUnderline && settings.lineSerifs && !gsGen;
    const serifs = wantSerifs ? this.serifQuads(active, rx, rw) : null;
    if (gsGen) {
      this.paintGlitchRect(ctx, rx, ry, rw, rh, color, 0.9 * blinkAlpha2 * bodyOpacity, gsGen);
    } else {
      let px = rx, pw = rw;
      if (serifs) {
        px = Math.min(rx, serifs.left);
        pw = Math.max(rx + rw, serifs.right) - px;
      }
      ctx.fillStyle = this._bodyPaint(px, ry, pw, rh, color, 0.9 * blinkAlpha2 * bodyOpacity);
      ctx.beginPath();
      this.traceQuad(
        ctx,
        this.cursorCorners(rx, ry, rw, rh),
        this.cornerRadius(Math.min(rw, rh))
      );
      if (serifs) {
        for (const q of serifs.quads) this.traceQuad(ctx, q, serifs.radius);
      }
      ctx.fill();
    }
    ctx.restore();
  },
  drawBoxCursor() {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const now = performance.now();
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const hollow = this.styleFor("boxHollow");
    const strokeW = hollow ? Math.max(1, Math.min(6, settings.boxHollowWidth || 2)) : 0;
    const translucent = !!this.styleFor("cursorTranslucent");
    const bodyOpacity = translucent ? opacity * TRANSLUCENT_ALPHA : opacity;
    this._paintTrail(ctx, "Box", color, bodyOpacity, strokeW);
    const active = this.animActive;
    if (active) {
      const blinkAlpha2 = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);
      ctx.save();
      this._armGlow(ctx, color, 10 * blinkAlpha2);
      const gsBox = this._glitchNow(now);
      if (gsBox) {
        this.paintGlitchRect(
          ctx,
          active.x,
          active.top,
          renderW,
          active.h,
          color,
          0.9 * blinkAlpha2 * bodyOpacity,
          gsBox
        );
      } else {
        const paintStyle = this._bodyPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha2 * bodyOpacity);
        if (hollow) {
          ctx.strokeStyle = paintStyle;
          ctx.lineWidth = strokeW;
          ctx.lineJoin = "miter";
          ctx.beginPath();
          this.traceQuad(
            ctx,
            this.cursorCorners(active.x, active.top, renderW, active.h),
            this.cornerRadius(Math.min(renderW, active.h))
          );
          ctx.stroke();
        } else {
          ctx.fillStyle = paintStyle;
          this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
        }
      }
      ctx.restore();
      const displayChar = this.pending ? this.pending.holdChar : active.char;
      const glyphAlpha = Math.min(1, bodyOpacity * blinkAlpha2);
      if (!hollow && !translucent && !gsBox && settings.showChar && displayChar && glyphAlpha >= 0.01) {
        ctx.save();
        ctx.globalAlpha = glyphAlpha;
        const glyphMode = this.styleFor("glyphColorMode") || "contrast";
        if (this._glyphColorFor !== color || this._glyphColorMode !== glyphMode) {
          this._glyphColorFor = color;
          this._glyphColorMode = glyphMode;
          this._glyphColorVal = readableGlyphColor(color, glyphMode);
        }
        ctx.fillStyle = this._glyphColorVal;
        ctx.font = this.fontString(active.fontSize, active.fontFamily, active.fontWeight, active.fontStyle);
        const metricKey = ctx.font + "|" + displayChar;
        let gm = this._glyphMetrics;
        if (!gm || this._glyphMetricKey !== metricKey) {
          const metrics = ctx.measureText(displayChar);
          gm = this._glyphMetrics = {
            ascent: metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? active.fontSize * 0.8,
            descent: metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? active.fontSize * 0.2
          };
          this._glyphMetricKey = metricKey;
        }
        const { ascent, descent } = gm;
        const glyphBoxHeight = ascent + descent;
        const leading = active.h - glyphBoxHeight;
        const baselineY = active.top + ascent + leading / 2;
        const glyphAdvance = Math.max(1, (active.actualCharWidth ?? renderW) - (active.letterSpacing || 0));
        const dpr = this._canvasDpr || 1;
        const region = this._canvasRect;
        const ox = region ? region.x : 0, oy = region ? region.y : 0;
        const snapX = (v) => Math.round((v - ox) * dpr) / dpr + ox;
        const snapY = (v) => Math.round((v - oy) * dpr) / dpr + oy;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(displayChar, snapX(active.x + glyphAdvance / 2), snapY(baselineY));
        ctx.restore();
      }
    }
  }
};

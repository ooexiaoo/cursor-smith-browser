// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hexToRgbTuple, hsvToRgb, lerpHsv, rgbToHsv, rgbTupleToHex } from "../color.js";
import { heatColor, step } from "../demo.js";
import { FLAME_BUOYANCY, FLAME_DAMPING, FLAME_INITIAL_VELOCITY, FLAME_LEVELS, FLAME_LIFETIME_EXP, FLAME_MAX_LIFETIME, FLAME_MAX_NUM, FLAME_PER_LENGTH, FLAME_PER_SECOND, FLAME_RANDOM_VELOCITY, FLAME_SPREAD, HOT_ALPHA_LEVELS, HOT_BLOCK_SHAPES, HOT_BUDGET_CARETS, HOT_BURN_LINGER_MS, HOT_BURN_MAX, HOT_COLOR_LEVELS, HOT_ENGULF_PAD_X, HOT_ENGULF_RATE, HOT_FINE_CHANCE, HOT_FINE_SCALE, HOT_FLAT_HUE_SPAN, HOT_FLAT_LIGHTEN, HOT_HEAD_JITTER_DOWN, HOT_HEAD_JITTER_UP, HOT_HEAD_LIFT, HOT_HSV, HOT_LIFE_FLOOR, HOT_PX_DIVISOR, HOT_PX_MAX, HOT_PX_MIN, HOT_SHAPE_EASE, HOT_SPARKS_PER_CHUNK, HOT_SPARK_LIFT, HOT_SPARK_MAX, HOT_SPARK_RISE, HOT_SPECK_SCALE, HOT_STAGE_PIXEL, HOT_START_CONE, HOT_STOP_POS, HOT_SWAY_CW, HOT_SWAY_GROW_MS, HOT_SWAY_HZ, HOT_TEMP_GAMMA, HOT_TEMP_MAX, HOT_TRAIL_EMIT_MAX, HOT_TRAIL_FADE_POW, HOT_TRAIL_PATH_AGE, HOT_TRAIL_PATH_MAX, HOT_TRAIL_STEP_CW, HOT_TURB_X, HOT_TURB_Y, hotQuant, hotShapeStage } from "../fire.js";
import { easeInOutSine } from "../motion.js";

export function hotKick(mag) {
  const ang = -Math.PI / 2 + (Math.random() * 2 - 1) * HOT_START_CONE;
  return {
    vx: mag * Math.cos(ang),
    vy: mag * Math.sin(ang),
    age: 0,
    sw: HOT_SWAY_CW * (0.6 + 0.4 * Math.random()),
    sf: HOT_SWAY_HZ * (0.75 + 0.5 * Math.random()),
    sp: Math.random() * Math.PI * 2,
    so: 0
  };
}
export var effectsFireMethods = {
  // Everything Hot-head holds - live particles, burn marks, the caret samples
  // it measures travel against - is stored in viewport coordinates, because
  // that's what the canvas draws in. Scrolling moves the text under those
  // coordinates without changing them, which broke the effect in two ways at
  // once: fire that was sitting on a word stayed pinned to the screen while the
  // word slid away from under it, and the caret's viewport position changed
  // without the caret having actually gone anywhere, so the emitter read the
  // scroll as travel and laid a streak of fire across the screen.
  //
  // Shifting everything by the scroll delta fixes both: the fire is attached to
  // the text, so it scrolls with the text, and the caret's apparent movement
  // cancels out to roughly zero, so no spurious trail.
  hotSyncScroll() {
    if (!this.styleFor("hotHead")) {
      this._hotScroll = null;
      return;
    }
    const view = this.app.workspace.activeEditor?.editor?.cm;
    let el = null;
    const chain = this._clipChainFor && this._clipChain;
    if (chain && chain.length && !(view && view.hasFocus)) {
      for (const c of chain) {
        if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) {
          el = c;
          break;
        }
      }
    }
    if (!el) el = view && view.scrollDOM || null;
    if (!el) {
      this._hotScroll = null;
      return;
    }
    const prev = this._hotScroll;
    let ox, oy;
    if (this._caretPass === "secondary") {
      const sh = this._hotShift;
      if (!sh || sh.tick !== this._tickNo) return;
      if (this._hotShiftTick === sh.tick) return;
      this._hotShiftTick = sh.tick;
      if (!sh.ox && !sh.oy) return;
      ox = sh.ox;
      oy = sh.oy;
    } else {
      const gen = this._layoutGen | 0;
      if (prev && prev.el === el && prev.gen === gen) return;
      const sx = el.scrollLeft || 0;
      const sy = el.scrollTop || 0;
      if (!prev || prev.el !== el) {
        this._hotScroll = { el, x: sx, y: sy, gen };
        return;
      }
      prev.gen = gen;
      const dx = sx - prev.x;
      const dy = sy - prev.y;
      prev.x = sx;
      prev.y = sy;
      this._hotShift = { ox: -dx, oy: -dy, tick: this._tickNo };
      if (!dx && !dy) return;
      ox = -dx;
      oy = -dy;
      for (const p of this.flameEmbers) {
        p.x += ox;
        p.y += oy;
      }
    }
    const nEmbers = this.flameEmbers.length;
    const nBurns = this.hotBurns ? this.hotBurns.length : 0;
    if (!nEmbers && !nBurns && !this._hotPrev && !this._hotEmitFrom) return;
    for (const b of this.hotBurns) {
      b.x += ox;
      b.y += oy;
      if (b.rowLeft != null) b.rowLeft += ox;
      if (b.rowRight != null) b.rowRight += ox;
    }
    if (this._hotPrev) {
      this._hotPrev.x += ox;
      this._hotPrev.y += oy;
    }
    if (this._hotEmitFrom) {
      this._hotEmitFrom.x += ox;
      this._hotEmitFrom.y += oy;
    }
    if (nEmbers) this._dirtyFull = true;
  },
  // Hot-head: track the caret between frames, and remember where it has been.
  //
  // The burn marks: each is a patch of text the caret has occupied, with an
  // intensity that decays over time. (The caret's smoothed velocity was
  // tracked here too, for the share of it new particles inherited; nothing
  // inherits it since 1.6.4 - the fire rises where it was lit.) Fire is emitted from ALL live
  // marks, not just the caret, so text the caret has moved off keeps burning
  // for a moment afterwards - the point being that the text was set alight,
  // rather than that a flame is following the cursor around.
  updateHotHeadInertia() {
    this.hotSyncScroll();
    const now = performance.now();
    const active = this.animActive;
    if (!active) {
      this._hotPrev = null;
      this._hotEmitFrom = null;
      this.hotBurns = [];
      return;
    }
    const cx = active.x + (active.w || 0) / 2;
    const cy = active.top + (active.h || 0) / 2;
    if (!this._hotPrev) {
      this._hotPrev = { x: cx, y: cy, t: now };
      this._hotEmitFrom = { x: cx, y: cy };
      this.hotBurns = [];
      return;
    }
    if (Math.abs(cx - this._hotPrev.x) > 0.5 || Math.abs(cy - this._hotPrev.y) > 0.5) {
      this._hotActiveT = now;
    }
    const prevX = this._hotPrev.x, prevY = this._hotPrev.y;
    this._hotPrev.x = cx;
    this._hotPrev.y = cy;
    this._hotPrev.t = now;
    if (!this._hotEmitFrom) this._hotEmitFrom = { x: cx, y: cy };
    if (!this.hotBurns) this.hotBurns = [];
    const cwHere = Math.max(4, active.actualCharWidth || active.w || 8);
    const la = this.lastActive;
    const markY = la && Math.abs(la.top - active.top) > 0.5 ? la.top : active.top;
    const prevRow = this._hotPrev.row ?? prevY - (active.h || 0) / 2;
    this._hotPrev.row = markY;
    const last = this.hotBurns[this.hotBurns.length - 1];
    if (last && Math.abs(last.x - cx) < cwHere * 0.5 && Math.abs(last.y - markY) < 2) {
      last.t = now;
      last.rowLeft = active.rowLeft;
      last.rowRight = active.rowRight;
    } else {
      const dxp = cx - prevX;
      const dist = Math.abs(dxp);
      const step2 = cwHere * HOT_TRAIL_STEP_CW;
      const n = Math.abs(markY - prevRow) < 2 ? Math.min(HOT_TRAIL_PATH_MAX, Math.floor(dist / step2)) : 0;
      if (n >= 1) {
        const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
        const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
        for (let i = n; i >= 1; i--) {
          const s = i * step2 / dist;
          this.hotBurns.push({
            x: cx - dxp * s,
            y: markY,
            t: now - s * HOT_TRAIL_PATH_AGE * linger,
            rowLeft: active.rowLeft,
            rowRight: active.rowRight,
            lh: active.h || 16,
            fs: active.fontSize || 0
          });
        }
      }
      this.hotBurns.push({
        x: cx,
        y: markY,
        t: now,
        rowLeft: active.rowLeft,
        rowRight: active.rowRight,
        lh: active.h || 16,
        // Needed to place the fire relative to the GLYPHS rather than to the
        // line box - see topY in maybeSpawnHotHead. Stored per mark because a
        // mark left on a previous line has to keep that line's metrics, not
        // whatever the caret has since moved onto.
        fs: active.fontSize || 0
      });
      while (this.hotBurns.length > HOT_BURN_MAX) this.hotBurns.shift();
    }
  },
  // Whether the fire is currently being fed, i.e. the caret has moved recently
  // enough to count as working. Shared by the emitter and the frame governor:
  // the governor has to agree, or a fire that has burnt out would still pin the
  // render loop at full rate forever on the grounds that the effect is enabled.
  hotHeadFeeding(nowT) {
    return this._hotFeedingAt(this._hotActiveT, nowT);
  },
  // The same test for a caret whose state is not swapped in (a secondary's
  // bundle, read from _isAnimating without a swap).
  _hotFeedingAt(activeT, nowT) {
    const idleMs = Math.max(0, this.styleFor("hotHeadIdleMs") ?? 0);
    if (idleMs <= 0) return true;
    return nowT - (activeT || 0) <= idleMs;
  },
  // Emit fire from every patch of text that is currently alight.
  //
  // Particles are points with no size of their own - see drawHotHead, where how
  // big they look is decided by their age.
  maybeSpawnHotHead() {
    const active = this.animActive;
    const from = this._hotEmitFrom;
    if (!active || !from) return;
    const now = performance.now();
    const cw = Math.max(4, active.actualCharWidth || active.w || 8);
    const lh = Math.max(8, active.h || 16);
    const cx = active.x + (active.w || 0) / 2;
    const cy = active.top + lh / 2;
    let dx = cx - from.x;
    let dy = cy - from.y;
    const segLen = Math.hypot(dx, dy);
    const maxSeg = cw * 12;
    if (segLen > maxSeg) {
      const k = maxSeg / segLen;
      dx *= k;
      dy *= k;
    }
    from.x = cx;
    from.y = cy;
    const dt = Math.max(0, Math.min(0.1, (now - (this._lastHotT || now)) / 1e3));
    this._lastHotT = now;
    const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
    const fadeMs = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);
    const heightMul = Math.max(0.05, this.styleFor("hotHeadHeight") ?? 0.55);
    const perLength = FLAME_PER_LENGTH * ((this.styleFor("hotHeadTrail") ?? 0) / 10);
    const qtyEarly = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);
    if (qtyEarly > 0 && this._hotEngulfUntil && now < this._hotEngulfUntil) {
      const land = this.lastActive || active;
      const shapeN = HOT_BLOCK_SHAPES.length;
      const n2 = HOT_ENGULF_RATE * dt * qtyEarly;
      const count2 = Math.floor(n2) + (Math.random() < n2 % 1 ? 1 : 0);
      const w = Math.max(cw, land.w || 0);
      const x0 = land.x - cw * HOT_ENGULF_PAD_X, x1 = land.x + w + cw * HOT_ENGULF_PAD_X;
      const lfs = land.fontSize || lh * 0.62;
      const baseY = land.top + Math.max(0, (land.h || lh) - lfs) / 2 - lfs * HOT_HEAD_LIFT;
      for (let i = 0; i < count2; i++) {
        const spark = Math.random() < 0.5;
        const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul * 0.8;
        const life0 = fadeMs * (spark ? 0.15 + 0.45 * Math.random() : 0.3 + 0.5 * Math.pow(Math.random(), 2));
        const kick = hotKick(mag);
        this.flameEmbers.push({
          spark,
          fine: spark && Math.random() < HOT_FINE_CHANCE,
          x: x0 + Math.random() * (x1 - x0),
          y: baseY + (HOT_HEAD_JITTER_DOWN - Math.random() * (HOT_HEAD_JITTER_UP + HOT_HEAD_JITTER_DOWN)) * lh,
          ...kick,
          vy: kick.vy - (spark ? HOT_SPARK_RISE * 0.6 : 1) * cw * heightMul,
          shape0: Math.min(shapeN - 1, 5 + Math.floor(Math.random() * (shapeN - 6))),
          flip: Math.random() < 0.5,
          life: life0,
          life0,
          maxLife: fadeMs,
          temp: 0.6 + Math.random() * 0.4,
          cw,
          lift: heightMul * (spark ? HOT_SPARK_LIFT : 1)
        });
      }
    }
    const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
    const halfSpan = spreadCw * cw * 0.5;
    const burns = (this.hotBurns || []).filter((b) => now - b.t < linger);
    this.hotBurns = burns;
    if (!burns.length) return;
    if (!this.hotHeadFeeding(now)) return;
    const carets = 1 + Math.min(HOT_BUDGET_CARETS - 1, this._secondaries && this._secondaries.length || 0);
    const chunkCap = FLAME_MAX_NUM * carets;
    this._hotSparkCap = HOT_SPARK_MAX * carets;
    let live = 0, sparks = 0;
    for (const p of this.flameEmbers) {
      if (p.spark) sparks++;
      else live++;
    }
    this._hotSparks = sparks;
    if (live >= chunkCap) return;
    const qty = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);
    if (qty <= 0) return;
    let weightSum = 0;
    const weights = burns.map((b) => {
      const w = 1 - (now - b.t) / linger;
      const v = Math.pow(w, HOT_TRAIL_FADE_POW);
      weightSum += v;
      return v;
    });
    if (weightSum <= 0) return;
    const travelCw = Math.hypot(dx, dy) / cw;
    const spanScale = 1 + halfSpan * 2 / (cw * 6);
    const n = (FLAME_PER_SECOND * dt * spanScale * Math.min(HOT_TRAIL_EMIT_MAX, 0.55 + weightSum * 0.45) + travelCw * perLength) * qty;
    let count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    count = Math.max(0, Math.min(count, chunkCap - live));
    if (count <= 0) return;
    for (let i = 0; i < count; i++) {
      let r = Math.random() * weightSum;
      let bi = 0;
      while (bi < burns.length - 1 && (r -= weights[bi]) > 0) bi++;
      const burn = burns[bi];
      const strength = Math.max(0, 1 - (now - burn.t) / linger);
      const fs = burn.fs || lh * 0.62;
      const halfLeading = Math.max(0, (burn.lh || lh) - fs) / 2;
      const topY = burn.y + halfLeading - fs * HOT_HEAD_LIFT;
      const across = (Math.random() * 2 - 1) * halfSpan;
      const s = Math.random();
      const alongX = bi === burns.length - 1 ? -dx * (1 - s) : 0;
      let px = burn.x + alongX + across + (Math.random() - 0.5) * FLAME_SPREAD * cw;
      const py = topY + (HOT_HEAD_JITTER_DOWN - Math.random() * (HOT_HEAD_JITTER_UP + HOT_HEAD_JITTER_DOWN)) * lh;
      const rl = burn.rowLeft, rr = burn.rowRight;
      if (rl != null && rr != null) {
        const pad = cw * 0.5;
        const lo = Math.min(rl - pad, burn.x - cw * 0.5);
        const hi = Math.max(rr + pad, burn.x + cw * 0.5);
        if (hi - lo < cw * 2) {
          px = Math.min(Math.max(px, burn.x - cw * 0.5), burn.x + cw * 0.5);
        } else if (px < lo || px > hi) {
          continue;
        }
      }
      const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul;
      const life0 = fadeMs * (HOT_LIFE_FLOOR + (1 - HOT_LIFE_FLOOR) * Math.pow(Math.random(), FLAME_LIFETIME_EXP)) * (0.7 + 0.3 * strength);
      const lifeShare = Math.max(0, Math.min(1, life0 / fadeMs));
      const shapeN = HOT_BLOCK_SHAPES.length;
      const shape0 = Math.max(0, Math.min(
        shapeN - 1,
        Math.round((1 - lifeShare) * (shapeN - 1) + (Math.random() - 0.5) * 3)
      ));
      this.flameEmbers.push({
        x: px,
        y: py,
        ...hotKick(mag),
        shape0,
        flip: Math.random() < 0.5,
        // Upstream is a bare max*rand^n. The floor is ours: with no floor a
        // large share of particles are born with a percent or two of max life
        // and die inside a frame, spending the budget on specks nobody sees.
        // The exponent still shapes the distribution; the floor just makes
        // every particle last long enough to be drawn.
        life: life0,
        life0,
        maxLife: fadeMs,
        // Older patches burn cooler, so a trail of lingering fire fades down
        // the ramp as well as thinning out.
        temp: Math.min(1, (0.55 + Math.random() * 0.45) * (0.45 + 0.55 * strength)),
        cw,
        // Buoyancy is per-particle so a change to Flame Height doesn't yank
        // everything already in the air.
        lift: heightMul
      });
      if (this._hotSparks < this._hotSparkCap) {
        const nSp = HOT_SPARKS_PER_CHUNK + (Math.random() < HOT_FINE_CHANCE ? 1 : 0);
        for (let k = 0; k < nSp; k++) {
          const fine = k >= HOT_SPARKS_PER_CHUNK;
          const kick = hotKick(FLAME_INITIAL_VELOCITY * Math.random() * cw * heightMul);
          this.flameEmbers.push({
            spark: true,
            fine,
            x: px + (Math.random() - 0.5) * cw * 0.6,
            y: py - Math.random() * lh * 0.15,
            ...kick,
            vy: kick.vy - HOT_SPARK_RISE * cw * heightMul,
            life: fadeMs * (0.15 + 0.65 * Math.random()) * (0.5 + 0.5 * strength),
            maxLife: fadeMs,
            temp: 0.5 + Math.random() * 0.5,
            cw,
            lift: heightMul * HOT_SPARK_LIFT
          });
          this._hotSparks = (this._hotSparks | 0) + 1;
        }
      }
    }
  },
  // Hot-head's fire colour for a given temperature (0..1):
  //
  //   0.00  the cursor's own colour - the coolest fire is the colour of
  //         whatever lit it, so the effect stays in the cursor's family
  //   0.28  yellow
  //   0.55  orange
  //   0.80  red-orange
  //   1.00  white-hot
  //
  // Separate from Speed Demon's heatColor, which drives the caret's own colour
  // and has its own ramp. Interpolation is per-segment in HSV, not RGB: an RGB
  // lerp from a cool cursor colour to yellow passes through grey, and fire is
  // never desaturated. The ignition segment forces hues past 180 to climb, so a
  // blue or violet cursor reddens on its way to yellow through magenta rather
  // than flashing lime through cyan and green - shortest is not the same as
  // most like fire.
  hotFireColor(temp, baseHex) {
    const h = Math.max(0, Math.min(1, temp));
    const base = rgbToHsv(hexToRgbTuple(baseHex));
    let i = 0;
    while (i < HOT_STOP_POS.length - 2 && h > HOT_STOP_POS[i + 1]) i++;
    const t0 = HOT_STOP_POS[i];
    const t1 = HOT_STOP_POS[i + 1];
    const t = t1 > t0 ? (h - t0) / (t1 - t0) : 0;
    const f = t * 0.7 + easeInOutSine(t) * 0.3;
    const from = i === 0 ? base : HOT_HSV[i - 1];
    const to = HOT_HSV[i];
    const arc = i === 0 && from[0] > 180 ? 1 : 0;
    return rgbTupleToHex(hsvToRgb(lerpHsv(from, to, f, arc)));
  },
  // Hot-head's fire.
  //
  // Particles are points. They're binned into a fine square lattice, and how
  // big each one is drawn is decided by its remaining life, not by any radius
  // it carries: fresh ones cover a 2x2 patch of squares, middle-aged ones a
  // single square, old ones a small dot inside one. Then they fade through
  // discrete shade levels. Big blocks, then specks, then gone.
  //
  // The lattice is square and sized off the FONT, not off the character cell,
  // and each square decides its own size stage and colour from the particles
  // in it. Upstream bins into character cells and gives every sub-cell of a
  // cell one shared glyph and colour, because a terminal can only put one
  // character in one cell - reproducing that on a canvas made the grid far too
  // legible, a lattice of character-sized rectangles that read as a tiling
  // artefact instead of as fire.
  //
  // The lattice is anchored to absolute canvas coordinates, not to the caret.
  // Particles move continuously but can only light whole squares, so they
  // appear to step from square to square; anchor it to the caret and the whole
  // fire slides smoothly with it, which just looks like a scaled-up bitmap.
  drawHotHead() {
    if (!this.flameEmbers.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const active = this.animActive;
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1)) * Math.max(0, Math.min(1, this.styleFor("hotHeadOpacity") ?? 1));
    const maxLife = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);
    const dtMs = Math.max(1, Math.min(100, now - (this._hotDrawT || now - 17)));
    this._hotDrawT = now;
    const dt = dtMs / 1e3;
    const damp = Math.exp(Math.log(1 - FLAME_DAMPING) * (dtMs / 17));
    const fontSize = active && active.fontSize || 16;
    const px = Math.max(HOT_PX_MIN, Math.min(HOT_PX_MAX, Math.round(fontSize / HOT_PX_DIVISOR)));
    const speck = Math.max(1, Math.round(px * HOT_SPECK_SCALE));
    const speckOff = Math.floor((px - speck) / 2);
    const fineSz = Math.max(1, Math.round(px * HOT_FINE_SCALE));
    const fineOff = Math.floor((px - fineSz) / 2);
    const flatMode = !!this.styleFor("hotHeadFlat");
    const heatTheFire = flatMode && this.styleFor("hotHeadSpeedHeat") && this.look.speedDemon;
    const heatQ = heatTheFire ? Math.round(Math.max(0, Math.min(1, this.heat || 0)) * 32) : -1;
    const base = heatTheFire ? this.heatColor(heatQ / 32, this.getBaseColor()) : this.getBaseColor();
    const paletteKey = base + (flatMode ? "|flat" : "");
    let palette = this._hotPalette;
    if (!palette || this._hotPaletteKey !== paletteKey) {
      this._hotPaletteKey = paletteKey;
      palette = this._hotPalette = [];
      this._hotFill = null;
      const baseHsv = rgbToHsv(hexToRgbTuple(base));
      for (let j = 0; j <= FLAME_LEVELS; j++) {
        const u = j / FLAME_LEVELS;
        if (flatMode) {
          const tinted = hsvToRgb([baseHsv[0] + u * HOT_FLAT_HUE_SPAN * 0.5, baseHsv[1], baseHsv[2]]);
          const k = u * HOT_FLAT_LIGHTEN;
          palette.push([
            Math.round(tinted[0] + (255 - tinted[0]) * k),
            Math.round(tinted[1] + (255 - tinted[1]) * k),
            Math.round(tinted[2] + (255 - tinted[2]) * k)
          ]);
        } else {
          palette.push(hexToRgbTuple(this.hotFireColor(u, base)));
        }
      }
    }
    const pal = palette;
    const fills = this._hotFill || (this._hotFill = /* @__PURE__ */ new Map());
    const fillFor = (pi, alpha) => {
      const key = pi * 1e5 + Math.round(alpha * 1e3);
      let s = fills.get(key);
      if (s === void 0) {
        const [r, g, b] = pal[pi];
        s = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        fills.set(key, s);
      }
      return s;
    };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x0, y0, w, h) => {
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x0 + w > maxX) maxX = x0 + w;
      if (y0 + h > maxY) maxY = y0 + h;
    };
    const shapeN = HOT_BLOCK_SHAPES.length;
    ctx.save();
    if (active && ctx.clip) {
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      ctx.rect(active.x, active.top, Math.max(active.w || 0, active.actualCharWidth || 0), active.h || 0);
      ctx.clip("evenodd");
    }
    this.flameEmbers = this.flameEmbers.filter((p) => {
      p.life -= dtMs;
      if (p.life <= 0) return false;
      const pcw = p.cw || 8;
      const lift = p.lift || 1;
      p.vy = (p.vy + (FLAME_BUOYANCY * lift + FLAME_RANDOM_VELOCITY * HOT_TURB_Y * (Math.random() - 0.5)) * pcw * dt) * damp;
      p.vx = p.vx * damp + FLAME_RANDOM_VELOCITY * HOT_TURB_X * (Math.random() - 0.5) * pcw * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.sw) {
        const age = (p.age || 0) + dtMs;
        p.age = age;
        const reach = p.sw * pcw * Math.min(1, age / HOT_SWAY_GROW_MS);
        const so = reach * Math.sin(2 * Math.PI * (p.sf || HOT_SWAY_HZ) * age / 1e3 + (p.sp || 0));
        p.x += so - (p.so || 0);
        p.so = so;
      }
      const frac = Math.max(0, Math.min(1, p.life / (p.maxLife || maxLife)));
      const temp = hotQuant((p.temp || 1) * Math.pow(frac, HOT_TEMP_GAMMA), HOT_COLOR_LEVELS) * HOT_TEMP_MAX;
      const pi = Math.round(temp * FLAME_LEVELS);
      if (p.spark) {
        const q2 = hotQuant(frac, HOT_ALPHA_LEVELS);
        if (q2 <= 0) return true;
        const alpha2 = (p.fine ? 0.15 + 0.35 * q2 : 0.2 + 0.5 * q2) * opacity;
        ctx.fillStyle = fillFor(pi, alpha2);
        const sz = p.fine ? fineSz : speck, off = p.fine ? fineOff : speckOff;
        const sx = Math.floor(p.x / px) * px + off, sy = Math.floor(p.y / px) * px + off;
        ctx.fillRect(sx, sy, sz, sz);
        grow(sx, sy, sz, sz);
        return true;
      }
      if (frac <= HOT_STAGE_PIXEL) {
        const q2 = hotQuant(frac / HOT_STAGE_PIXEL, HOT_ALPHA_LEVELS);
        if (q2 <= 0) return true;
        const alpha2 = (0.15 + 0.25 * q2) * opacity;
        ctx.fillStyle = fillFor(pi, alpha2);
        const dx0 = Math.floor(p.x / px) * px + speckOff, dy0 = Math.floor(p.y / px) * px + speckOff;
        ctx.fillRect(dx0, dy0, speck, speck);
        grow(dx0, dy0, speck, speck);
        return true;
      }
      const gone = Math.pow(1 - Math.max(0, Math.min(1, p.life / (p.life0 || p.maxLife || maxLife))), HOT_SHAPE_EASE);
      const shape0 = p.shape0 ?? 0;
      const idx = Math.min(shapeN - 1, shape0 + Math.floor(gone * (shapeN - shape0)));
      const rows = HOT_BLOCK_SHAPES[idx];
      const h = rows.length;
      let area = 0;
      for (const row of rows) for (let i = 0; i < row.length; i++) if (row[i] === "1") area++;
      const stage = hotShapeStage(area);
      const q = hotQuant((frac - HOT_STAGE_PIXEL) / (1 - HOT_STAGE_PIXEL), HOT_ALPHA_LEVELS);
      if (q <= 0) return true;
      const alpha = (stage >= 3 ? 0.7 + 0.25 * q : stage >= 2 ? 0.6 + 0.25 * q : 0.45 + 0.25 * q) * opacity;
      ctx.fillStyle = fillFor(pi, alpha);
      const gx = Math.floor(p.x / px);
      const gy = Math.floor(p.y / px);
      ctx.beginPath();
      for (let ri = 0; ri < h; ri++) {
        const row = rows[ri];
        const w = row.length;
        let i = 0;
        while (i < w) {
          if (row[i] !== "1") {
            i++;
            continue;
          }
          let j = i;
          while (j < w && row[j] === "1") j++;
          const c0 = p.flip ? w - j : i;
          const x0 = (gx + c0) * px;
          const y0 = (gy - (h - 1 - ri)) * px;
          ctx.rect(x0, y0, (j - i) * px, px);
          grow(x0, y0, (j - i) * px, px);
          i = j;
        }
      }
      ctx.fill();
      return true;
    });
    ctx.restore();
    if (minX <= maxX) {
      const pad = px * 2;
      this._markDirty(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
    }
  }
};

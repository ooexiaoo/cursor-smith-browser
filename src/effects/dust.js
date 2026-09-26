// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hslToRgbTuple } from "../color.js";
import { JUMP_TRAIL_MAX_PUFFS, JUMP_TRAIL_MIN_DIST, JUMP_TRAIL_STEP, STARDUST_MAX_PER_CARET } from "../constants.js";
import { step } from "../demo.js";

export var effectsDustMethods = {
  // The colour for one trail pixel, as an "rgb(...)" string.
  //
  // Normally every pixel in a burst is a small random nudge off the flat cursor
  // colour. When Gradient Colours is on AND a gradient is active, each pixel
  // instead samples a RANDOM point along the cursor's gradient, so a burst comes
  // out multi-hued - the same trick Stardust uses via sampleRamp - and then gets
  // the same small nudge on top for grain. `disintegrate` inverts the result so
  // the deletion burst keeps its "wrong colour" look whichever mode is on.
  //
  // `baseRGB` is the pre-computed [r,g,b] of the flat path (already inverted for
  // disintegrate by the caller), passed in so the common case doesn't re-parse
  // the hex for every pixel.
  //
  // `forceBase` makes that base authoritative and skips the gradient sample
  // entirely. It's set when Pop Effects' Rainbow is driving a deletion burst:
  // Rainbow outranks Gradient throughout Pop Effects, and without this the
  // gradient branch would quietly win for anyone running both.
  flamePixelColor(baseRGB, disintegrate, forceBase = false) {
    let r, g, b;
    if (!forceBase && this.look.flameTrailGradientColors && this.look.gradientEnabled) {
      [r, g, b] = this.sampleRamp(Math.random());
      if (disintegrate) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }
    } else {
      [r, g, b] = baseRGB;
    }
    const varR = Math.max(0, Math.min(255, Math.round(r + (Math.random() - 0.5) * 70)));
    const varG = Math.max(0, Math.min(255, Math.round(g + (Math.random() - 0.5) * 70)));
    const varB = Math.max(0, Math.min(255, Math.round(b + (Math.random() - 0.5) * 70)));
    return `rgb(${varR}, ${varG}, ${varB})`;
  },
  spawnFlamePixels(anchor, disintegrate = false) {
    if (!disintegrate && !this.look.flameTrail) return;
    const density = Math.max(0, this.look.flameTrailDensity ?? 1);
    if (density <= 0 && !disintegrate) return;
    const baseCount = disintegrate ? Math.floor(10 + Math.random() * 8) : Math.floor(6 + Math.random() * 6);
    const count = disintegrate ? baseCount : Math.round(baseCount * density);
    if (count <= 0) return;
    const lifeSec = Math.max(0.05, (this.look.flameTrailLifeMs ?? 400) / 1e3);
    let baseHex = this.getActiveColor() || "#39ff14";
    let h = baseHex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    let r = parseInt(h, 16) >> 16 & 255;
    let g = parseInt(h, 16) >> 8 & 255;
    let b = parseInt(h, 16) & 255;
    const popRainbow = disintegrate && !!this.look.popEffects && !!this.look.popRainbow;
    if (popRainbow) {
      [r, g, b] = hslToRgbTuple(this.nextRainbowHue(), 0.85, 0.6);
    }
    if (disintegrate) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    const baseRGB = [r, g, b];
    const pxBase = Math.max(1, this.look.flameTrailPixelSize ?? 4);
    const anchorW = anchor.w || anchor.actualCharWidth || 8;
    const cx = anchor.x + anchorW / 2;
    const cy = anchor.top + anchor.h / 2;
    for (let i = 0; i < count; i++) {
      const pX = anchor.x + Math.random() * anchorW;
      const pY = anchor.top + Math.random() * anchor.h;
      const color = this.flamePixelColor(baseRGB, disintegrate, popRainbow);
      let vx, vy;
      if (disintegrate) {
        const dx = pX - cx;
        const dy = pY - cy;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 30 + Math.random() * 25;
        vx = dx / len * speed;
        vy = dy / len * speed - 10;
      } else {
        vx = (Math.random() - 0.5) * 20;
        vy = 0;
      }
      this.flamePixels.push({
        x: pX,
        y: pY,
        vx,
        vy,
        size: pxBase * (0.65 + Math.random() * 0.7),
        color,
        alpha: 1,
        start: performance.now(),
        // Per-particle lifetime (drawFlamePixels reads this instead of a
        // hardcoded constant), plus a marker so the gravity physics applies
        // ONLY to Pixel Trail particles and leaves Speed Demon sparks and
        // Thunderstrike debris - which share this pool - moving as before.
        life: lifeSec,
        trail: true
      });
    }
  },
  spawnJumpTrail(from, to) {
    if (!this.look.flameTrail || !from || !to) return;
    const density = Math.max(0, this.look.flameTrailDensity ?? 1);
    if (density <= 0) return;
    const fw = from.w || from.actualCharWidth || 8;
    const tw = to.w || to.actualCharWidth || 8;
    const x0 = from.x + fw / 2, y0 = from.top + (from.h || 16) / 2;
    const x1 = to.x + tw / 2, y1 = to.top + (to.h || 16) / 2;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < JUMP_TRAIL_MIN_DIST) return;
    const puffs = Math.min(JUMP_TRAIL_MAX_PUFFS, Math.floor(dist / JUMP_TRAIL_STEP));
    if (puffs <= 0) return;
    let baseHex = this.getActiveColor() || "#39ff14";
    let h = baseHex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const int = parseInt(h, 16);
    const baseRGB = [int >> 16 & 255, int >> 8 & 255, int & 255];
    const lifeSec = Math.max(0.05, (this.look.flameTrailLifeMs ?? 400) / 1e3);
    const now = performance.now();
    const perPuff = Math.max(1, Math.round(2 * Math.min(1.5, density)));
    const lineH = ((from.h || 16) + (to.h || 16)) / 2;
    const pxBase = Math.max(1, this.look.flameTrailPixelSize ?? 4) * 0.8;
    for (let i = 1; i <= puffs; i++) {
      const s = i / (puffs + 1);
      const px = x0 + (x1 - x0) * s;
      const py = y0 + (y1 - y0) * s;
      for (let j = 0; j < perPuff; j++) {
        const color = this.flamePixelColor(baseRGB, false);
        this.flamePixels.push({
          x: px + (Math.random() - 0.5) * 6,
          y: py + (Math.random() - 0.5) * lineH * 0.7,
          // Gentle sideways drift, same as a resting trail puff - the streak
          // should sit where the caret passed, not fly off on its own.
          vx: (Math.random() - 0.5) * 14,
          vy: 0,
          size: pxBase * (0.65 + Math.random() * 0.7),
          color,
          alpha: 1,
          start: now,
          life: lifeSec,
          trail: true
        });
      }
    }
  },
  drawFlamePixels() {
    if (!this.flamePixels.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const trailAmt = Math.max(0, this.styleFor("speedDemonSparkTrail") || 0);
    const gStrength = Math.max(0, Math.min(1, this.look.flameTrailGravity ?? 0));
    let gx = 0, gy = 0;
    if (gStrength > 0) {
      const mag = gStrength * 900;
      const rad = (this.look.flameTrailGravityAngle ?? 0) * Math.PI / 180;
      gx = Math.sin(rad) * mag;
      gy = Math.cos(rad) * mag;
    }
    ctx.save();
    this.flamePixels = this.flamePixels.filter((p) => {
      const life = p.life || 0.4;
      const elapsed = (now - p.start) / 1e3;
      if (elapsed > life) return false;
      const t = elapsed / life;
      p.alpha = 1 - Math.pow(t, 2);
      const pgx = p.trail ? gx : 0;
      const pgy = p.trail ? gy : 0;
      const curX = p.x + p.vx * elapsed + pgx * 0.5 * elapsed * elapsed;
      const curY = p.y + p.vy * elapsed + pgy * 0.5 * elapsed * elapsed;
      ctx.globalAlpha = Math.max(0, p.alpha);
      if (p.spark && trailAmt > 0) {
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const dirX = p.vx / speed;
        const dirY = p.vy / speed;
        const tailLen = trailAmt * (0.5 + Math.min(1, speed / 45) * 0.5);
        const tailX = curX - dirX * tailLen;
        const tailY = curY - dirY * tailLen;
        const lw = Math.max(1, p.size * 0.85);
        this._markDirty(
          Math.min(curX, tailX) - lw,
          Math.min(curY, tailY) - lw,
          Math.abs(tailX - curX) + lw * 2,
          Math.abs(tailY - curY) + lw * 2
        );
        const grad = ctx.createLinearGradient(curX, curY, tailX, tailY);
        grad.addColorStop(0, `rgba(${p.r}, ${p.g}, ${p.b}, 0.9)`);
        grad.addColorStop(1, `rgba(${p.r}, ${p.g}, ${p.b}, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1, p.size * 0.85);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(curX, curY);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(curX, curY, p.size, p.size);
      this._markDirty(curX - 1, curY - 1, (p.size || 1) + 2, (p.size || 1) + 2);
      return true;
    });
    ctx.restore();
  },
  // ---- Stardust ----------------------------------------------------------
  // Whether the effect is switched on AND currently emitting. Split out from
  // maybeSpawnStardust() because the frame governor needs the same answer: an
  // armed-but-not-yet-emitting cursor still has to be woken often enough to
  // emit on time, or the first mote would wait out an idle heartbeat.
  stardustArmed() {
    const s = this.look;
    if (!s.stardustEnabled) return false;
    if (!this.animActive) return false;
    if (s.stardustAlwaysOn) return true;
    const idleFor = performance.now() - (this._lastActivityT || 0);
    return idleFor >= Math.max(0, s.stardustDelayMs ?? 2e3);
  },
  // Emit a slow stream of drifting motes from the caret while it sits idle.
  //
  // Rate-limited by wall clock rather than per frame: the governor runs this
  // at ~30fps while stardust is alive but drops to ~5fps in the gaps, so a
  // per-frame probability would quietly change density with the gear.
  maybeSpawnStardust() {
    if (!this.stardustArmed()) return;
    if (this.stardust.length >= STARDUST_MAX_PER_CARET * (1 + (this._secondaries ? this._secondaries.length : 0))) return;
    const now = performance.now();
    const rate = Math.max(0.1, this.look.stardustRate ?? 1);
    if (now - (this._lastStardustT || 0) < 320 / rate) return;
    this._lastStardustT = now;
    const active = this.animActive;
    if (!active) return;
    const anchorW = active.w || active.actualCharWidth || 8;
    const [sr, sg, sb] = this.sampleRamp(Math.random());
    const vary = (c) => Math.max(0, Math.min(255, Math.round(c + (Math.random() - 0.5) * 50)));
    const orbit = !!this.look.stardustOrbit;
    const meanRadius = Math.max(6, this.look.stardustOrbitRadius ?? 22);
    this.stardust.push({
      // Spawn across the caret's width, biased to its upper half - the motes
      // read as coming off the cursor rather than out of the line below it.
      x: active.x + Math.random() * anchorW,
      y: active.top + Math.random() * active.h * 0.6,
      vy: -8 - Math.random() * 14,
      // px/sec: slow upward drift
      sway: 2 + Math.random() * 5,
      // px of horizontal wander
      swaySpeed: 0.6 + Math.random() * 0.9,
      // rad/sec of that wander
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 2 + Math.random() * 3,
      size: 1 + Math.random() * 1.5,
      life: 2.2 + Math.random() * 2.2,
      // seconds
      color: `rgb(${vary(sr)}, ${vary(sg)}, ${vary(sb)})`,
      start: now,
      // Which caret this mote belongs to: the bundle when spawned in a
      // secondary's pass, null for the primary. An orbiting mote re-anchors
      // to its own caret every frame (drawStardust).
      owner: this._caretOwner || null,
      // --- orbit mode ---
      orbit,
      // Anchor, refreshed from the live caret every frame so the swarm follows
      // the cursor. Seeded here so a mote outliving its caret keeps circling
      // the last known spot instead of jumping to the origin.
      ax: active.x + anchorW / 2,
      ay: active.top + active.h / 2,
      radius: meanRadius * (0.55 + Math.random() * 0.75),
      // Random direction, and slower the wider the orbit, so the swarm doesn't
      // look like a rigid disc rotating as one piece. Kept deliberately
      // unhurried - a fast orbit reads as agitated rather than ambient.
      angSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.32 + Math.random() * 0.55) * (22 / meanRadius),
      wobbleSpeed: 0.5 + Math.random() * 1.2,
      // Flattened orbits read as perspective rather than as flat rings, and
      // suit a caret that's taller than it is wide.
      squash: 0.45 + Math.random() * 0.4
    });
  },
  // Age and paint the idle motes.
  //
  // All motion is derived from `elapsed` rather than integrated per frame, the
  // same way flame pixels work, which matters more here than anywhere else in
  // the file: stardust is the one effect that routinely runs at the WARM gear
  // (~30fps) and lives for seconds, so a per-frame step would visibly change
  // both drift speed and lifetime with the gear.
  drawStardust() {
    if (!this.stardust.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    ctx.save();
    this.stardust = this.stardust.filter((p) => {
      const elapsed = (now - p.start) / 1e3;
      if (elapsed > p.life) return false;
      const t = elapsed / p.life;
      const envelope = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      const twinkle = 0.72 + 0.28 * Math.sin(elapsed * p.twinkleSpeed + p.phase);
      const alpha = Math.max(0, envelope * twinkle * opacity);
      if (alpha <= 0.01) return true;
      if (p.orbit) {
        const anchor = p.owner ? p.owner.animActive : this.animActive;
        if (anchor) {
          p.ax = anchor.x + (anchor.w || anchor.actualCharWidth || 8) / 2;
          p.ay = anchor.top + anchor.h / 2;
        }
        const ang = p.phase + elapsed * p.angSpeed;
        const r = p.radius * (1 + Math.sin(elapsed * p.wobbleSpeed + p.phase) * 0.15);
        return this.paintMote(p, p.ax + Math.cos(ang) * r, p.ay + Math.sin(ang) * r * p.squash, alpha);
      }
      const curX = p.x + Math.sin(elapsed * p.swaySpeed + p.phase) * p.sway;
      const curY = p.y + p.vy * elapsed;
      return this.paintMote(p, curX, curY, alpha);
    });
    ctx.restore();
  },
  // Shared tail of drawStardust for both motion modes: paint one mote and
  // report the pixels it touched.
  paintMote(p, x, y, alpha) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, p.size, p.size);
    this._markDirty(x - 1, y - 1, p.size + 2, p.size + 2);
    return true;
  }
};

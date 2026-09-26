// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hexToRgbTuple, hslToRgbString, hslToRgbTuple, lighten, thunderColorAt, thunderRamp } from "../color.js";
import { FIREWORK_ALPHA, FIREWORK_CELL, FIREWORK_DRIFT, FIREWORK_FALL_MS, FIREWORK_GRAVITY, FIREWORK_MAX_LIVE, FIREWORK_MIN_GAP_MS, FIREWORK_PALETTE_MAX, FIREWORK_PRESSURE, FIREWORK_RISE_JITTER, FIREWORK_RISE_LINES, FIREWORK_RISE_MS, FIREWORK_SECOND_AT, FIREWORK_SECOND_MAX, FIREWORK_SECOND_SPARKS, FIREWORK_SPARK_BUDGET, FIREWORK_SPARK_MIN, FIREWORK_TRAIL_LEN, FIREWORK_TWINKLE_AT, JUMP_TRAIL_MIN_DIST, THUNDER_BANDS, THUNDER_LIFE_MS, THUNDER_MAX_ANGLE, THUNDER_MAX_LIVE, THUNDER_MIN_REACH, THUNDER_PASSES } from "../constants.js";
import { step } from "../demo.js";
import { glitchNoise } from "../motion.js";

export var effectsPopsMethods = {
  spawnLetterParticle(char, anchor) {
    if (!char.trim()) return;
    let color = this.getActiveColor() || anchor.textColor;
    if (this.styleFor("popRainbow")) {
      color = hslToRgbString(this.nextRainbowHue(), 0.85, 0.6);
    }
    this.particles.push({
      char,
      x: anchor.x + (anchor.w || anchor.actualCharWidth) / 2,
      y: anchor.top,
      vx: (Math.random() - 0.5) * 120,
      vy: -150 - Math.random() * 130,
      rotation: (Math.random() - 0.5) * 4,
      alpha: 1,
      fontSize: anchor.fontSize,
      fontFamily: anchor.fontFamily,
      color,
      start: performance.now()
    });
  },
  drawLettersParticles() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    this.particles = this.particles.filter((p) => {
      const elapsed = (now - p.start) / 1e3;
      if (elapsed > 0.45) return false;
      const t = elapsed / 0.45;
      p.alpha = 1 - t;
      const curX = p.x + p.vx * elapsed;
      const curY = p.y + p.vy * elapsed + 0.5 * 320 * elapsed * elapsed;
      const curRot = p.rotation * elapsed * 5;
      const ext = (p.fontSize || 16) * 1.4;
      this._markDirty(curX - ext, curY - ext, ext * 2, ext * 2);
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.fontSize * 0.9}px ${p.fontFamily}`;
      ctx.translate(curX, curY);
      ctx.rotate(curRot);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.char, 0, 0);
      ctx.restore();
      return true;
    });
  },
  // Lay a line of small pixel puffs along the path between two caret positions,
  // for Trail On Jump. `from`/`to` are caret snapshots (the old and new
  // positions). Does nothing for a short move - that's just typing, which the
  // per-commit puff in spawnFlamePixels already handles.
  // Arm a Signal Glitch burst, if this move was far enough to count as a jump.
  //
  // Jump-only is a deliberate design constraint, not a limitation: a glitch on
  // every keystroke would strobe the caret continuously while typing, which is
  // unreadable and a genuine photosensitivity concern. A jump (click, search
  // result, Vim motion, fold toggle) is rare enough that a ~200ms break-up
  // reads as punctuation on the movement instead of ambient noise.
  spawnGlitch(from, to) {
    if (!from || !to) return;
    const dist = Math.hypot(to.x - from.x, to.top - from.top);
    if (dist < JUMP_TRAIL_MIN_DIST) return;
    const dur = Math.max(60, Math.min(600, this.look.crtGlitchMs ?? 220));
    const reach = Math.min(2.2, 0.7 + dist / 420);
    this.glitch = {
      start: performance.now(),
      dur,
      reach,
      seed: Math.random() * 2147483647 | 0
    };
  },
  // Resolve the live glitch into per-frame drawing parameters, or null when no
  // burst is running. Also retires an expired burst, which is what lets the
  // frame governor drop back out of the hot gear.
  glitchState(now) {
    const g = this.glitch;
    if (!g) return null;
    const p = (now - g.start) / g.dur;
    if (p >= 1 || p < 0) {
      this.glitch = null;
      return null;
    }
    const env = (1 - p) * (1 - p);
    const bucket = Math.floor((now - g.start) / 45);
    const strength = Math.max(0, Math.min(2.5, this.look.crtGlitchStrength ?? 1));
    const aberr = Math.max(0, Math.min(3, this.look.crtGlitchAberration ?? 1));
    return {
      seed: g.seed,
      bucket,
      env,
      // Peak sideways throw of a slice, in px.
      amp: 14 * strength * g.reach * env,
      // RGB channel separation, in px. Kept smaller than amp: past a few px
      // the fringes stop reading as chromatic aberration and start reading as
      // three separate coloured cursors.
      ab: 3.2 * aberr * env,
      strength
    };
  },
  // Paint one axis-aligned cursor rect as a broken-up signal.
  //
  // Three things combine here, which is what keeps it from looking like a
  // simple shake:
  //   1. The rect is cut into horizontal slices that slip sideways by
  //      different amounts, so the FORM tears rather than translating.
  //   2. Each slice is independently squashed/stretched horizontally, so
  //      edges stop lining up and the outline warps.
  //   3. Each slice is drawn three times - once per RGB channel, offset - and
  //      composited additively, so overlapping areas sum back to the original
  //      colour while the edges fringe hard red and cyan.
  //
  // The smear quad is intentionally ignored while glitching: a spring-deformed
  // quad sliced and channel-split at the same time is visual mud, and the
  // glitch is brief enough that dropping the smear for its duration reads as
  // part of the effect.
  paintGlitchRect(ctx, x, y, w, h, baseColor, alpha, gs) {
    const rgb = hexToRgbTuple(baseColor) || [255, 255, 255];
    const R = Math.round(rgb[0]), G = Math.round(rgb[1]), B = Math.round(rgb[2]);
    const slices = Math.max(3, Math.min(12, Math.round(h / 3)));
    const sh = h / slices;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < slices; i++) {
      const n1 = glitchNoise(gs.seed, i, gs.bucket);
      const n2 = glitchNoise(gs.seed + 101, i, gs.bucket);
      const n3 = glitchNoise(gs.seed + 977, i, gs.bucket);
      if (n3 < 0.13 * gs.env) continue;
      const d = (n1 - 0.5) * 2;
      const dx = d * d * d * gs.amp;
      const wScale = 1 + (n2 - 0.5) * 0.55 * gs.strength * gs.env;
      const sw = Math.max(1, w * wScale);
      const sx = x + dx - (sw - w) / 2;
      const sy = y + i * sh;
      const drawH = sh + 0.5;
      if (gs.ab > 0.05) {
        ctx.fillStyle = `rgba(${R}, 0, 0, ${alpha})`;
        ctx.fillRect(sx - gs.ab, sy, sw, drawH);
        ctx.fillStyle = `rgba(0, ${G}, 0, ${alpha})`;
        ctx.fillRect(sx, sy, sw, drawH);
        ctx.fillStyle = `rgba(0, 0, ${B}, ${alpha})`;
        ctx.fillRect(sx + gs.ab, sy, sw, drawH);
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(${R}, ${G}, ${B}, ${alpha})`;
        ctx.fillRect(sx, sy, sw, drawH);
        ctx.globalCompositeOperation = "lighter";
      }
    }
    if (glitchNoise(gs.seed + 5501, 0, gs.bucket) < 0.55) {
      const ly = y + glitchNoise(gs.seed + 31, 1, gs.bucket) * h;
      const lw = w * (1.2 + glitchNoise(gs.seed + 77, 2, gs.bucket) * 1.6);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.55 * gs.env})`;
      ctx.fillRect(x - (lw - w) / 2, ly, lw, Math.max(1, h * 0.06));
    }
    ctx.restore();
  },
  // ---- Pop Effects: shared colour --------------------------------------
  // Hand out the next hue in the group's rainbow sweep and advance it.
  //
  // Every pop effect draws from this ONE counter, which is the whole point of
  // Rainbow being a group-level option rather than a per-effect one: letters,
  // bolts and fireworks fired in the same burst of typing come out as
  // consecutive steps of a single sweep instead of three sweeps at unrelated
  // phases that happen to share a palette.
  //
  // 33° is coprime-ish with 360 (they share only 3), so the sweep takes ~120
  // pops to repeat a hue rather than cycling visibly every handful of keys.
  nextRainbowHue(step2 = 33) {
    const hue = this._popRainbowHue;
    this._popRainbowHue = (hue + step2) % 360;
    return hue;
  },
  // One firework spark's colour, as an [r,g,b] tuple.
  //
  // Precedence is Rainbow, then Gradient, then the flat cursor colour, and it
  // is resolved by the CALLER passing (or not passing) a base: `base` is
  // non-null only when Rainbow is on, in which case every spark in the burst
  // varies around that one hue. With Rainbow off this samples a random point
  // along the gradient per spark, which is what gives a burst the cursor's own
  // colours - and sampleRamp already collapses to the flat cursor colour when
  // no gradient is set, so the no-gradient case needs no branch of its own.
  //
  // The nudge afterwards is what "slight variations" means: enough that no two
  // sparks in a burst are the same pixel colour, small enough that the burst
  // still reads as the gradient (or the hue) it came from.
  fireworkSparkRGB(base) {
    const [r, g, b] = base || this.sampleRamp(Math.random());
    return [
      Math.max(0, Math.min(255, Math.round(r + (Math.random() - 0.5) * 76))),
      Math.max(0, Math.min(255, Math.round(g + (Math.random() - 0.5) * 76))),
      Math.max(0, Math.min(255, Math.round(b + (Math.random() - 0.5) * 76)))
    ];
  },
  // ---- Fireworks ---------------------------------------------------------
  // Space or Enter sends one or more pixelated shells climbing out of the
  // caret; each bursts above it and the sparks arc back down under gravity.
  //
  // Like the thunderbolt, a whole firework is generated ONCE here - launch
  // point, apex, every spark's angle, speed, size and colour - and the draw
  // call only advances it along a closed-form path. Rolling any of that per
  // frame would make the spray boil instead of fly, and would tie the shape of
  // the effect to the frame rate the governor happened to pick.
  // Total sparks in flight, which is what actually costs anything to draw.
  // Walked rather than kept as a running total: shells are removed by a filter
  // inside drawFireworks, so a counter would need decrementing from the draw
  // path and would drift the first time that changed.
  _liveSparkCount() {
    let n = 0;
    for (const fw of this.fireworks) n += fw.sparks.length;
    return n;
  },
  spawnFireworks(target) {
    if (!this.look.popEffects || !this.look.fireworks) return;
    if (!target) return;
    const now = performance.now();
    if (now - this._lastFireworkT < FIREWORK_MIN_GAP_MS) return;
    const q = Math.max(0.2, Math.min(3, this.look.fireworksQuantity ?? 1));
    const shells = Math.max(1, Math.min(3, Math.round(q)));
    const wanted = Math.max(4, Math.round(12 * q));
    const liveSparks = this._liveSparkCount();
    const roomTotal = FIREWORK_SPARK_BUDGET - liveSparks;
    if (roomTotal < FIREWORK_SPARK_MIN) return;
    this._lastFireworkT = now;
    const pressure = liveSparks / FIREWORK_SPARK_BUDGET;
    const rich = pressure < FIREWORK_PRESSURE;
    const lh = target.h || 16;
    const w = target.w || target.actualCharWidth || 8;
    const x0 = target.x + w / 2;
    const y0 = target.top;
    const clipTop = this._clipTop ?? 0;
    const fallSec = FIREWORK_FALL_MS / 1e3;
    const base = this.styleFor("popRainbow") ? hslToRgbTuple(this.nextRainbowHue(), 0.85, 0.62) : null;
    for (let i = 0; i < shells; i++) {
      if (this.fireworks.length >= FIREWORK_MAX_LIVE) break;
      const share = Math.floor((FIREWORK_SPARK_BUDGET - this._liveSparkCount()) / (shells - i));
      if (share < FIREWORK_SPARK_MIN) break;
      const sparkCount = Math.max(FIREWORK_SPARK_MIN, Math.min(wanted, share));
      const rise = lh * (FIREWORK_RISE_LINES + (Math.random() - 0.5) * 2 * FIREWORK_RISE_JITTER);
      const bx = x0 + (Math.random() - 0.5) * 2 * FIREWORK_DRIFT;
      const by = Math.min(
        y0 - lh * 0.9,
        Math.max(y0 - rise, clipTop + lh * 0.5)
      );
      const palN = Math.max(2, Math.min(FIREWORK_PALETTE_MAX, Math.ceil(sparkCount / 3)));
      const palette = [];
      for (let c = 0; c < palN; c++) {
        const [r, g, b] = this.fireworkSparkRGB(base);
        palette.push(`rgb(${r}, ${g}, ${b})`);
      }
      const sparks = [];
      let maxReach = 0;
      for (let s = 0; s < sparkCount; s++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = lh * (3.4 + Math.random() * 6.2);
        const size = FIREWORK_CELL * (Math.random() < 0.22 ? 2 : 1);
        sparks.push({
          ang,
          speed,
          size,
          ci: Math.random() * palN | 0,
          // Twinkle phase and rate, rolled once. Rolling per frame would be
          // noise rather than a flicker, for the same reason the thunderbolt
          // generates its jitter once.
          tw: Math.random() * Math.PI * 2,
          tr: 9 + Math.random() * 14
        });
        if (speed > maxReach) maxReach = speed;
      }
      sparks.sort((a, b) => a.ci - b.ci);
      const secondaries = [];
      if (rich && sparkCount >= 8) {
        const nSec = Math.min(FIREWORK_SECOND_MAX, Math.max(1, Math.round(sparkCount / 10)));
        for (let n = 0; n < nSec; n++) {
          const parent = sparks[Math.random() * sparks.length | 0];
          const at = FIREWORK_SECOND_AT[0] + Math.random() * (FIREWORK_SECOND_AT[1] - FIREWORK_SECOND_AT[0]);
          const kids = [];
          for (let s = 0; s < FIREWORK_SECOND_SPARKS; s++) {
            kids.push({
              ang: Math.random() * Math.PI * 2,
              speed: lh * (1.1 + Math.random() * 2),
              size: FIREWORK_CELL,
              ci: Math.random() * palN | 0,
              tw: Math.random() * Math.PI * 2,
              tr: 12 + Math.random() * 16
            });
          }
          kids.sort((a, b) => a.ci - b.ci);
          secondaries.push({ ang: parent.ang, speed: parent.speed, at, sparks: kids });
        }
      }
      const spread = maxReach * fallSec;
      const drop = 0.5 * FIREWORK_GRAVITY * fallSec * fallSec;
      const secReach = secondaries.length ? maxReach * fallSec + lh * 3.1 * fallSec : 0;
      const reach = Math.max(spread, secReach);
      this.fireworks.push({
        x0,
        y0,
        bx,
        by,
        sparks,
        palette,
        secondaries,
        // Trails are the first thing dropped when the air is already full.
        trail: rich ? FIREWORK_TRAIL_LEN : 0,
        riseMs: FIREWORK_RISE_MS * (0.85 + Math.random() * 0.3),
        fallMs: FIREWORK_FALL_MS,
        // Stagger, so a volley goes up as a volley instead of as one lump.
        // Shell 0 is always immediate: the first pop has to land on the
        // keystroke that caused it or the whole effect feels laggy.
        delay: i === 0 ? 0 : i * (70 + Math.random() * 60),
        flash: Math.max(FIREWORK_CELL * 2, lh * 0.32),
        minX: Math.min(x0, bx - reach),
        maxX: Math.max(x0, bx + reach),
        minY: by - reach,
        maxY: Math.max(y0, by + reach + drop),
        start: now
      });
    }
  },
  drawFireworks() {
    if (!this.fireworks.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const cell = FIREWORK_CELL;
    const snap = (v) => Math.round(v / cell) * cell;
    const fallSec = FIREWORK_FALL_MS / 1e3;
    this.fireworks = this.fireworks.filter((fw) => {
      const age = now - fw.start;
      if (age < fw.delay) return true;
      const t = age - fw.delay;
      if (t >= fw.riseMs + fw.fallMs) return false;
      ctx.save();
      if (t < fw.riseMs) {
        const p = t / fw.riseMs;
        const e = 1 - (1 - p) * (1 - p);
        const cx = snap(fw.x0 + (fw.bx - fw.x0) * e);
        const cy = snap(fw.y0 + (fw.by - fw.y0) * e);
        const a = FIREWORK_ALPHA * opacity * Math.min(1, p * 5);
        const dx = (fw.bx - fw.x0) / (fw.riseMs || 1);
        const dy = (fw.by - fw.y0) / (fw.riseMs || 1);
        const len = Math.hypot(dx, dy) || 1;
        for (let k = 2; k >= 1; k--) {
          ctx.fillStyle = `rgba(255, 255, 255, ${a * (0.18 / k)})`;
          ctx.fillRect(
            snap(cx - dx / len * cell * 2 * k),
            snap(cy - dy / len * cell * 2 * k),
            cell,
            cell
          );
        }
        ctx.fillStyle = `rgba(255, 245, 220, ${a})`;
        ctx.fillRect(cx, cy, cell, cell);
      } else {
        const u = (t - fw.riseMs) / fw.fallMs;
        const el = u * fallSec;
        const a = FIREWORK_ALPHA * opacity * Math.max(0, 1 - u * u);
        if (a > 0.01) {
          const tw = u > FIREWORK_TWINKLE_AT;
          const drawSet = (list, ox, oy, sc, alpha) => {
            let ci = -1;
            for (const s of list) {
              if (tw && Math.sin(s.tw + u * s.tr) < -0.35) continue;
              if (s.ci !== ci) {
                ci = s.ci;
                ctx.fillStyle = fw.palette[ci];
              }
              const vx = Math.cos(s.ang) * s.speed;
              const vy = Math.sin(s.ang) * s.speed;
              const tail = s.size > FIREWORK_CELL ? fw.trail : 0;
              for (let k = tail; k >= 1; k--) {
                const bt = Math.max(0, sc - k * 0.035);
                ctx.globalAlpha = alpha * (0.3 / k);
                ctx.fillRect(
                  snap(ox + vx * bt),
                  snap(oy + vy * bt + 0.5 * FIREWORK_GRAVITY * bt * bt),
                  FIREWORK_CELL,
                  FIREWORK_CELL
                );
              }
              ctx.globalAlpha = alpha;
              ctx.fillRect(
                snap(ox + vx * sc),
                snap(oy + vy * sc + 0.5 * FIREWORK_GRAVITY * sc * sc),
                s.size,
                s.size
              );
            }
          };
          drawSet(fw.sparks, fw.bx, fw.by, el, a);
          for (const sec of fw.secondaries) {
            if (u <= sec.at) continue;
            const pt = sec.at * fallSec;
            const px = fw.bx + Math.cos(sec.ang) * sec.speed * pt;
            const py = fw.by + Math.sin(sec.ang) * sec.speed * pt + 0.5 * FIREWORK_GRAVITY * pt * pt;
            const ct = el - pt;
            const cu = (u - sec.at) / Math.max(1e-3, 1 - sec.at);
            const ca = a * Math.max(0, 1 - cu);
            if (ca > 0.01) drawSet(sec.sparks, px, py, ct, ca);
          }
          ctx.globalAlpha = 1;
        }
        const flash = 1 - Math.min(1, u / 0.18);
        if (flash > 0) {
          const size = fw.flash * (0.4 + flash);
          ctx.fillStyle = `rgba(255, 252, 240, ${FIREWORK_ALPHA * opacity * flash * 0.5})`;
          ctx.fillRect(snap(fw.bx - size / 2), snap(fw.by - size / 2), size, size);
        }
      }
      ctx.restore();
      const pad = cell * 3 + fw.flash;
      this._markDirty(
        fw.minX - pad,
        fw.minY - pad,
        fw.maxX - fw.minX + pad * 2,
        fw.maxY - fw.minY + pad * 2
      );
      return true;
    });
  },
  // ---- Thunderstrike -----------------------------------------------------
  // A bolt of pixelated lightning that drops out of the top of the pane onto
  // the caret's new position when Enter is pressed.
  //
  // The whole bolt - its path, its forks, the grid cells it occupies and its
  // flicker pattern - is generated ONCE here and then only faded by the
  // draw call. Regenerating the jitter per frame is the obvious way to write
  // this and it looks wrong: the channel boils rather than holds, and at 60fps
  // the noise aliases into a shimmer instead of reading as one discharge.
  spawnThunderbolt(target) {
    if (!this.look.popEffects || !this.look.thunderstrike) return;
    if (!target) return;
    while (this.thunderbolts.length >= THUNDER_MAX_LIVE) this.thunderbolts.shift();
    const w = target.w || target.actualCharWidth || 8;
    const tx = target.x + w / 2;
    const ty = target.top;
    const angle = (Math.random() - 0.5) * 2 * THUNDER_MAX_ANGLE;
    const clipTop = this._clipTop ?? 0;
    const rise = Math.max(THUNDER_MIN_REACH, ty - clipTop + 80);
    const reach = rise / Math.max(0.35, Math.cos(angle));
    const ox = tx + Math.sin(angle) * reach;
    const oy = ty - Math.cos(angle) * reach;
    const cell = Math.max(1, Math.round(this.look.thunderstrikeSize ?? 2));
    const jitter = reach * 0.09;
    const seen = /* @__PURE__ */ new Set();
    const main = this.boltPath(ox, oy, tx, ty, jitter);
    let cells = this.pixelateBolt(main, cell, seen, 0, 1);
    const forks = (Math.random() < 0.75 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
    for (let f = 0; f < forks; f++) {
      const ft = 0.15 + Math.random() * 0.4;
      const at = main[Math.floor(main.length * ft)];
      if (!at) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      const spread = Math.max(-1.1, Math.min(1.1, angle + side * (0.45 + Math.random() * 0.55)));
      const len = reach * (0.15 + Math.random() * 0.18);
      const fx = at.x + Math.sin(spread) * len;
      const fy = at.y + Math.cos(spread) * len;
      cells = cells.concat(this.pixelateBolt(
        this.boltPath(at.x, at.y, fx, fy, len * 0.16),
        cell,
        seen,
        ft,
        Math.min(1, ft + 0.3)
      ));
    }
    cells = cells.filter((c) => c.y >= clipTop - cell);
    if (!cells.length) return;
    const ramp = thunderRamp(this.styleFor("popRainbow") ? this.nextRainbowHue() : null);
    const bands = [];
    for (let i = 0; i < THUNDER_BANDS; i++) {
      const [br, bg, bb] = thunderColorAt(ramp, i / (THUNDER_BANDS - 1));
      bands.push({
        r: br,
        g: bg,
        b: bb,
        cr: lighten(br, 0.45),
        cg: lighten(bg, 0.45),
        cb: lighten(bb, 0.45),
        cells: []
      });
    }
    for (const c of cells) {
      const i = Math.max(0, Math.min(THUNDER_BANDS - 1, Math.round(c.t * (THUNDER_BANDS - 1))));
      bands[i].cells.push(c);
    }
    const usedBands = bands.filter((x) => x.cells.length > 0);
    const [er, eg, eb] = thunderColorAt(ramp, 1);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    this.thunderbolts.push({
      bands: usedBands,
      cell,
      tx,
      ty,
      minX,
      minY,
      maxX,
      maxY,
      // The impact flash is sized off the caret, not off the block size: at the
      // finest setting a flash a few blocks wide would be invisible, and the
      // strike has to be seen to land.
      flash: Math.max(cell * 2, (target.h || 16) * 0.4),
      er,
      eg,
      eb,
      // Real lightning is several discharges down the same channel, so the
      // bolt steps between discrete brightness levels instead of fading
      // smoothly. Rolled at spawn, because a per-frame random would beat
      // against the frame rate and turn a strobe into mush. The first step is
      // forced to full: the moment of the strike is the brightest. The floor is
      // high (0.6 rather than near-zero) so the strobe reads as a shimmer down
      // the channel rather than as the bolt switching on and off.
      flicker: Array.from({ length: 8 }, (_, i) => i === 0 ? 1 : 0.6 + Math.random() * 0.4),
      start: performance.now()
    });
    const sparks = 3 + Math.floor(Math.random() * 3);
    const sparkColor = `rgb(${lighten(er, 0.45)}, ${lighten(eg, 0.45)}, ${lighten(eb, 0.45)})`;
    for (let i = 0; i < sparks; i++) {
      const dir = (Math.random() - 0.5) * Math.PI;
      const speed = 30 + Math.random() * 45;
      this.flamePixels.push({
        x: tx + (Math.random() - 0.5) * w,
        y: ty + Math.random() * (target.h || 16) * 0.4,
        vx: Math.sin(dir) * speed,
        vy: -Math.abs(Math.cos(dir)) * speed * 0.8,
        size: Math.max(1, cell * (0.5 + Math.random() * 0.5)),
        color: sparkColor,
        alpha: 1,
        start: performance.now()
      });
    }
  },
  // Fractal midpoint displacement: start with the straight line from the sky to
  // the caret, then repeatedly split every segment and shove the new midpoint
  // sideways by a shrinking random amount. Displacement is across the segment
  // rather than in a fixed axis, so the jaggedness looks the same whatever
  // angle the bolt comes in at.
  boltPath(x0, y0, x1, y1, jitter) {
    let pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    let amp = jitter;
    for (let pass = 0; pass < THUNDER_PASSES; pass++) {
      const next = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = (Math.random() - 0.5) * 2 * amp;
        next.push({ x: (a.x + b.x) / 2 + -dy / len * off, y: (a.y + b.y) / 2 + dx / len * off });
        next.push(b);
      }
      pts = next;
      amp *= 0.55;
    }
    return pts;
  },
  // Stamp a polyline onto a fixed grid so the bolt is built from aligned blocks
  // instead of a smooth stroke - the same chunky look as the rest of the
  // plugin's pixel work, and the reason this is a Pixel Trail sub-option.
  //
  // Deduped, and that matters: a near-horizontal run lands in the same cell
  // dozens of times, and every restamp of a semi-transparent block compounds
  // into a bright blob exactly where the bolt should be at its thinnest.
  //
  // `seen` is passed in by the caller and shared between the trunk and its
  // forks: a fork that crosses back over the channel it came from would
  // otherwise restamp those cells, and every overlapping block compounds in the
  // halo pass into a bright knot right where the two should simply meet.
  // Each block also records `t`, its position along the ramp: t0 at the start of
  // this path and t1 at the end. The trunk spans the whole ramp; a fork spans
  // only the part of it from where the fork branched off.
  pixelateBolt(pts, cell, seen, t0, t1) {
    const out = [];
    const segs = pts.length - 1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / (cell * 0.7)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const gx = Math.round((a.x + (b.x - a.x) * t) / cell) * cell;
        const gy = Math.round((a.y + (b.y - a.y) * t) / cell) * cell;
        const key = gx + "," + gy;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: gx, y: gy, t: t0 + (i - 1 + t) / segs * (t1 - t0) });
      }
    }
    return out;
  },
  drawThunderbolts() {
    if (!this.thunderbolts.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const strength = Math.max(0.1, Math.min(1, this.look.thunderstrikeStrength ?? 0.5));
    const halo = !!this.look.glow;
    this.thunderbolts = this.thunderbolts.filter((b) => {
      const t = (now - b.start) / THUNDER_LIFE_MS;
      if (t >= 1) return false;
      const fade = t < 0.12 ? 1 : 1 - (t - 0.12) / 0.88;
      const step2 = Math.min(b.flicker.length - 1, Math.floor(t * b.flicker.length));
      const alpha = Math.max(0, fade * b.flicker[step2] * opacity * strength);
      if (alpha <= 0.02) return true;
      const cell = b.cell;
      ctx.save();
      if (halo) {
        const pad2 = Math.max(1, cell * 0.75);
        for (const band of b.bands) {
          ctx.fillStyle = `rgba(${band.r}, ${band.g}, ${band.b}, ${alpha * 0.16})`;
          for (const c of band.cells) ctx.fillRect(c.x - pad2, c.y - pad2, cell + pad2 * 2, cell + pad2 * 2);
        }
      }
      for (const band of b.bands) {
        ctx.fillStyle = `rgba(${band.cr}, ${band.cg}, ${band.cb}, ${alpha})`;
        for (const c of band.cells) ctx.fillRect(c.x, c.y, cell, cell);
      }
      const flash = 1 - Math.min(1, t / 0.4);
      if (flash > 0) {
        const size = b.flash * (0.5 + flash);
        ctx.fillStyle = `rgba(${lighten(b.er, 0.45)}, ${lighten(b.eg, 0.45)}, ${lighten(b.eb, 0.45)}, ${alpha * flash * 0.4})`;
        ctx.fillRect(b.tx - size / 2, b.ty - size / 2, size, size);
      }
      ctx.restore();
      const pad = Math.max(8, cell * 3) + b.flash;
      this._markDirty(
        b.minX - pad,
        b.minY - pad,
        b.maxX - b.minX + cell + pad * 2,
        b.maxY - b.minY + cell + pad * 2
      );
      return true;
    });
  }
};

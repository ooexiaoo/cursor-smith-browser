// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hexToRgbTuple, readableGlyphColor, rgbTupleToHex } from "./color.js";
import { blinkAlphaAt } from "./motion.js";

export var TRANSLUCENT_ALPHA2 = 0.95;
export var ROUNDED_THIN_PX2 = 6;
export var ROUNDED_BLOCK_FRACTION2 = 0.25;
export function shapeOf(look, color, stops, px) {
  const style = String(look.cursorStyle || "Box").toLowerCase();
  const gradientOn = !!look.gradientEnabled && stops.length >= 2;
  const angle = style === "underline" ? 90 : 180;
  const gradient = gradientOn ? `linear-gradient(${angle}deg, ${stops.map((c, i) => `${c} ${Math.round(i / (stops.length - 1) * 100)}%`).join(", ")})` : null;
  const thick = style === "line" ? Math.max(1, Math.min(5, Math.round((look.caretWidthPx ?? 2) * 0.75))) : style === "underline" ? (look.underlineWidthPx ?? 0) > 0 ? Math.max(1, Math.min(4, Math.round((look.underlineWidthPx ?? 0) * 0.75))) : 2 : Math.max(1, px - 1);
  const hollowWidth = style === "box" && look.boxHollow ? Math.max(1, Math.min(3, Math.round((look.boxHollowWidth ?? 2) * 0.75))) : 0;
  let radius = 0;
  if (look.cursorRounded) {
    const minor = style === "box" ? Math.min(px - 1, 12) : thick;
    radius = minor <= ROUNDED_THIN_PX2 ? minor / 2 : Math.min(minor * ROUNDED_BLOCK_FRACTION2, minor / 2);
  }
  return {
    fill: gradientOn ? stops[0] : color,
    gradient,
    thick,
    hollowWidth,
    radius,
    serifs: style === "line" && !!look.lineSerifs,
    alphaScale: (look.cursorOpacity ?? 1) * (look.cursorTranslucent ? TRANSLUCENT_ALPHA2 : 1)
  };
}
export var TYPE_MS = 170;
export var HOLD_END_MS = 650;
export var HOLD_START_MS = 450;
export var POOL = 18;
export var DEMO_CYCLES = 2;
export function initialState(now) {
  return { target: 0, lead: 0, trail: 0, phase: "type", phaseMs: 0, lastKeyMs: now, heat: 0, ghosts: [] };
}
export var idleAt = (n) => n + 1;
export function step(s, look, n, dt, now, frozen = false) {
  const dtS = Math.min(0.1, dt / 1e3);
  s.phaseMs += dt;
  const move = (to) => {
    if (look.crtEffect && (look.trailLength ?? 0) > 0) {
      s.ghosts.push({ at: s.lead, t0: now });
      if (s.ghosts.length > (look.trailLength ?? 0)) s.ghosts.shift();
    }
    s.target = to;
    s.lastKeyMs = now;
  };
  if (frozen) {
  } else if (s.phase === "type") {
    if (s.phaseMs >= TYPE_MS) {
      s.phaseMs = 0;
      if (s.target < n) move(s.target + 1);
      else s.phase = "holdEnd";
    }
  } else if (s.phase === "holdEnd") {
    if (s.phaseMs >= HOLD_END_MS) {
      s.phaseMs = 0;
      move(0);
      s.phase = "holdStart";
    }
  } else if (s.phaseMs >= HOLD_START_MS) {
    s.phaseMs = 0;
    s.phase = "type";
  }
  if (look.smoothEnabled) {
    const rate = Math.max(0.5, (look.catchUpSpeed ?? 0.5) * (1 - (look.smoothness ?? 0.15)) * 40);
    s.lead += (s.target - s.lead) * (1 - Math.exp(-rate * dtS));
  } else if (look.smear) {
    const rate = 14 + (look.smearStiffness ?? 0.6) * 40;
    s.lead += (s.target - s.lead) * (1 - Math.exp(-rate * dtS));
  } else {
    s.lead = s.target;
  }
  if (Math.abs(s.target - s.lead) < 0.01) s.lead = s.target;
  if (look.smear) {
    const rate = 9 + (look.smearTrailingStiffness ?? 0.4) * 40;
    s.trail += (s.lead - s.trail) * (1 - Math.exp(-rate * dtS));
    if (Math.abs(s.lead - s.trail) < 0.01) s.trail = s.lead;
  } else {
    s.trail = s.lead;
  }
  if (look.speedDemon) {
    s.heat = s.phase === "type" ? Math.min(1, s.heat + dtS * 0.45) : Math.max(0, s.heat - dtS * 0.6);
  }
  const fade = look.trailFadeMs ?? 300;
  s.ghosts = s.ghosts.filter((g) => now - g.t0 < fade);
  return s;
}
export function blinkAlpha(s, look, now) {
  if (!look.blinkingEnabled) return 1;
  if (look.smoothStopBlinking && now - s.lastKeyMs < (look.blinkDelayMs ?? 0) + TYPE_MS * 1.5) return 1;
  return blinkAlphaAt(now, look.blinkSpeed ?? 1, look.blinkOnOffBalance ?? 0.5, look.blinkFade ?? 0.15);
}
export function heatColor(base, stops, heat) {
  if (heat <= 0 || stops.length < 3) return base;
  const seq = [base, ...stops];
  const pos = heat * (seq.length - 1);
  const i = Math.min(seq.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgbTuple(seq[i]);
  const b = hexToRgbTuple(seq[i + 1]);
  return rgbTupleToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f].map(Math.round));
}
export var DemoStrip = class {
  constructor() {
    this.demos = [];
    this.raf = 0;
    this.last = 0;
    this.win = null;
    this.tick = (now) => {
      const dt = this.last ? Math.min(100, now - this.last) : 16;
      this.last = now;
      this.demos = this.demos.filter((d) => d.el.isConnected && !(d.done && d.stepPx > 0 && d.particles.length === 0 && d.state.lead === d.state.target && d.state.trail === d.state.lead));
      for (const d of this.demos) {
        if (!d.stepPx) {
          const doc = d.text.ownerDocument;
          const range = doc.createRange();
          range.selectNodeContents(d.text);
          const w = range.getBoundingClientRect().width;
          if (w > 0 && d.n > 0) d.stepPx = w / d.n;
          else continue;
        }
        if (!d.done) {
          const before = d.state.target;
          const phaseBefore = d.state.phase;
          step(d.state, d.look, d.n, dt, now);
          if (d.state.target !== before) this.onMove(d, before, now);
          if (phaseBefore === "type" && d.state.phase === "holdEnd" && ++d.cycles >= DEMO_CYCLES) {
            d.done = true;
            d.state.target = idleAt(d.n);
          }
          this.emit(d, dt, now);
        } else {
          step(d.state, d.look, d.n, dt, now, true);
        }
        this.moveParticles(d, dt, now);
        const heat = d.look.speedDemon && !d.look.speedDemonNoCursorHeat ? d.state.heat : 0;
        this.paint(d, blinkAlpha(d.state, d.look, now), 1 - heat);
      }
      this.raf = this.demos.length && this.win ? this.win.requestAnimationFrame(this.tick) : 0;
    };
  }
  // Builds the demo into `host` and starts it. `color` is the preset's
  // color for the current theme; `heatStops` its four heat stops for it.
  add(host, name, look, color, heatStops, gradientStops, reduced, play) {
    const demo = host.createSpan({ cls: "cursor-smith-pcard-demo" });
    const text = demo.createSpan({ cls: "cursor-smith-pcard-text cursor-smith-pcard-name", text: name });
    const style = String(look.cursorStyle || "Box").toLowerCase();
    const shape = shapeOf(look, color, gradientStops, 8);
    const dress = (el, alpha) => {
      const st = { opacity: alpha, borderRadius: `${shape.radius}px` };
      if (shape.hollowWidth) {
        st.backgroundColor = "transparent";
        st.backgroundImage = "";
        st.border = `${shape.hollowWidth}px solid ${shape.fill}`;
        if (shape.gradient) {
          st.borderImage = `${shape.gradient} 1`;
          st.borderRadius = "0";
        }
      } else {
        st.backgroundColor = shape.fill;
        st.backgroundImage = shape.gradient ?? "";
      }
      if (style === "line") st.width = `${shape.thick}px`;
      if (style === "underline") {
        st.height = `${shape.thick}px`;
        st.top = `${18 - shape.thick}px`;
      }
      el.setCssStyles(st);
    };
    const ghosts = [];
    if (look.crtEffect && (look.trailLength ?? 0) > 0) {
      for (let i = 0; i < Math.min(30, look.trailLength ?? 0); i++) {
        const g = demo.createSpan({ cls: `cursor-smith-pcard-ghost cursor-smith-pcard-caret-${style}`, attr: { "aria-hidden": "true" } });
        dress(g, "0");
        ghosts.push(g);
      }
    }
    const caret = demo.createSpan({ cls: `cursor-smith-pcard-caret cursor-smith-pcard-caret-${style}` + (shape.serifs ? " is-serif" : ""), attr: { "aria-hidden": "true" } });
    dress(caret, String(shape.alphaScale));
    if (look.crtEffect && look.glow) caret.setCssStyles({ boxShadow: `0 0 6px ${shape.fill}` });
    let inner = null;
    if (style === "box" && look.showChar !== false && !shape.hollowWidth && !look.cursorTranslucent) {
      inner = caret.createSpan({ cls: "cursor-smith-pcard-caret-text", text: name });
      inner.setCssStyles({ color: readableGlyphColor(shape.fill, look.glyphColorMode ?? "contrast") });
    }
    const d = { el: demo, shape, cycles: 0, done: false, particles: [], pool: [], spawnAcc: 0, lastTarget: 0, text, caret, inner, ghosts, look, color, heatStops, n: name.length, style, state: initialState(0), stepPx: 0 };
    const win = host.ownerDocument?.defaultView ?? null;
    if (!play || reduced) {
      d.state.target = d.state.lead = d.state.trail = idleAt(d.n);
      d.done = true;
    }
    this.paint(d, 1, 1);
    if (!win || typeof win.requestAnimationFrame !== "function") return;
    this.demos.push(d);
    this.win = win;
    if (!this.raf) this.raf = win.requestAnimationFrame(this.tick);
  }
  // A particle from the pool, or none when the card has its share.
  spawn(d, x, y, vx, vy, life, size, color, now) {
    if (d.particles.length >= POOL) return;
    let el = d.pool.pop() ?? null;
    if (!el) el = d.el.createSpan({ cls: "cursor-smith-pcard-particle", attr: { "aria-hidden": "true" } });
    el.setCssStyles({ width: `${size}px`, height: `${size}px`, backgroundColor: color, opacity: "1" });
    d.particles.push({ el, x, y, vx, vy, t0: now, life, size, color });
  }
  // On a keystroke (or the jump back): Pixel trail throws pixels from the
  // spot the caret leaves; Hot-head lays a little fire along the way.
  onMove(d, from, now) {
    const px = d.stepPx;
    const look = d.look;
    const x0 = from * px;
    if (look.flameTrail) {
      const count = Math.round(3 * (look.flameTrailDensity ?? 1));
      const size = Math.max(2, Math.min(3, Math.round((look.flameTrailPixelSize ?? 4) / 2)));
      const g = (look.flameTrailGravity ?? 0) * 60;
      const ang = (look.flameTrailGravityAngle ?? 0) * Math.PI / 180;
      for (let i = 0; i < count; i++) {
        this.spawn(d, x0 + Math.random() * px, 6 + Math.random() * 10, (Math.random() - 0.5) * 30 + Math.sin(ang) * g * 0.3, (Math.random() - 0.5) * 30 + Math.cos(ang) * g * 0.3, Math.min(700, look.flameTrailLifeMs ?? 400), size, d.color, now);
      }
    }
    if (look.hotHead) {
      const count = Math.round(2 * (look.hotHeadQuantity ?? 1));
      for (let i = 0; i < count; i++) this.spawnFlame(d, x0 + Math.random() * px, now);
    }
  }
  // Over time: Stardust while the caret rests, flames while it types (and
  // embers while it is hot), each at its preset's rate.
  emit(d, dt, now) {
    const look = d.look;
    const st = d.state;
    const x = st.lead * d.stepPx;
    d.spawnAcc += dt;
    const resting = st.phase !== "type";
    if (look.stardustEnabled && (resting || look.stardustAlwaysOn)) {
      const every = 220 / (look.stardustRate ?? 1);
      if (d.spawnAcc >= every) {
        d.spawnAcc = 0;
        this.spawn(d, x + (Math.random() - 0.5) * 12, 12 + Math.random() * 6, (Math.random() - 0.5) * 8, -(10 + Math.random() * 12), 900, 1, d.color, now);
      }
    } else if (look.hotHead && !resting) {
      const every = 70 / (look.hotHeadQuantity ?? 1);
      if (d.spawnAcc >= every) {
        d.spawnAcc = 0;
        this.spawnFlame(d, x + Math.random() * Math.max(2, d.stepPx - 2), now);
      }
    } else if (look.speedDemon && look.speedDemonSparks && st.heat > 0.6) {
      if (d.spawnAcc >= 90) {
        d.spawnAcc = 0;
        this.spawn(d, x + Math.random() * d.stepPx, 6, (Math.random() - 0.5) * 40, -(30 + Math.random() * 30), 450, 1, heatColor(d.color, d.heatStops, 0.9), now);
      }
    }
  }
  // One flame: a pixel that climbs and fades, in the fire's colors (or
  // the cursor's, with Fire in cursor color on).
  spawnFlame(d, x, now) {
    const look = d.look;
    const rise = 24 * (look.hotHeadHeight ?? 0.55);
    const color = look.hotHeadFlat ? d.color : ["#ff6a1a", "#ffa62b", "#ffd166", "#fff1b8"][Math.floor(Math.random() * 4)];
    this.spawn(d, x, 4 + Math.random() * 4, (Math.random() - 0.5) * 6, -(rise + Math.random() * rise * 0.5) * 2, Math.min(600, look.hotHeadFade ?? 620) * 0.6, 2, color, now);
  }
  moveParticles(d, dt, now) {
    const dtS = dt / 1e3;
    const keep = [];
    for (const p of d.particles) {
      const age = (now - p.t0) / p.life;
      if (age >= 1) {
        p.el.setCssStyles({ opacity: "0" });
        d.pool.push(p.el);
        continue;
      }
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.el.setCssStyles({ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`, opacity: (1 - age).toFixed(2) });
      keep.push(p);
    }
    d.particles = keep;
  }
  // Puts the caret (and the ghosts) where the state says. `cold` is 1 - heat.
  paint(d, alpha, cold) {
    const px = d.stepPx || 8;
    const s = d.state;
    const from = Math.min(s.lead, s.trail) * px;
    const to = Math.max(s.lead, s.trail) * px;
    const stretch = Math.min(to - from, px * 2);
    const base = d.style === "line" ? d.shape.thick : Math.max(1, px - 1);
    const width = base + stretch;
    const heated = cold < 1 && !d.shape.gradient;
    const color = heated ? heatColor(d.color, d.heatStops, 1 - cold) : d.shape.fill;
    const styles = {
      transform: `translateX(${from.toFixed(2)}px)`,
      width: `${width.toFixed(2)}px`,
      opacity: String(d.shape.alphaScale * alpha)
    };
    if (d.shape.hollowWidth) styles.borderColor = color;
    else if (heated) styles.backgroundColor = color;
    if (d.look.crtEffect && d.look.glow) styles.boxShadow = `0 0 6px ${color}`;
    if (d.look.energyEffect) {
      const t = this.last * 6e-4 * (d.look.energySpeed ?? 1) % 1 * 300 - 100;
      styles.backgroundImage = `linear-gradient(180deg, ${color} 0%, #ffffff 50%, ${color} 100%)`;
      styles.backgroundSize = "100% 300%";
      styles.backgroundPosition = `0 ${t.toFixed(1)}%`;
    }
    d.caret.setCssStyles(styles);
    if (d.inner) d.inner.setCssStyles({ transform: `translateX(${(-from).toFixed(2)}px)` });
    const fade = d.look.trailFadeMs ?? 300;
    const now = this.last;
    for (let i = 0; i < d.ghosts.length; i++) {
      const g = s.ghosts[s.ghosts.length - 1 - i];
      const el = d.ghosts[i];
      if (!g) {
        el.setCssStyles({ opacity: "0" });
        continue;
      }
      const life = 1 - (now - g.t0) / fade;
      el.setCssStyles({ transform: `translateX(${(g.at * px).toFixed(2)}px)`, width: `${base.toFixed(2)}px`, opacity: (Math.max(0, life) * 0.6 * d.shape.alphaScale).toFixed(3) });
    }
  }
};

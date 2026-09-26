// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hexToRgbTuple, hexToRgba } from "../color.js";

export var paintEnergyMethods = {
  // Chooses how the Energy Beam paints the cursor.
  //
  // Aurora with any waviness becomes a genuine 2D field (auroraPattern); every
  // other case keeps the original linear gradient. Both return something usable
  // directly as a fillStyle/strokeStyle, so callers don't care which they got.
  energyPaint(x, y, w, h, baseColor, alpha) {
    const rampOn = !!this.look.gradientEnabled;
    const wav = this.look.energyAuroraWaviness ?? 1;
    if (rampOn && this.look.energyAurora && wav > 0.05) {
      const pat = this.auroraPattern(x, y, w, h, alpha, wav);
      if (pat) return pat;
    }
    return this.createEnergyGradient(x, y, w, h, baseColor, alpha);
  },
  // Aurora as a 2D pattern rather than a vertical gradient.
  //
  // Why this exists: createLinearGradient can only vary colour along ONE axis.
  // However hard the old code warped its sample position, every colour band was
  // still a perfectly horizontal line spanning the cursor - the bands could
  // slide up and down but could never bend, which is why Aurora read as
  // "scrolling stripes" rather than anything wavy. Getting curtains that
  // actually ripple sideways requires colour to be a function of x AND y, and
  // the only way to hand canvas an arbitrary 2D field as a fillStyle is to
  // rasterise it into an offscreen bitmap and wrap that in a pattern.
  //
  // Returns null (caller falls back to the gradient) rather than throwing on
  // anything unexpected, matching the defensive style used elsewhere here.
  auroraPattern(x, y, w, h, alpha, wav) {
    try {
      const ctx = this.ctx;
      if (!ctx) return null;
      let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
      const q = this.smearCorners();
      if (q) {
        for (const k of ["tl", "tr", "br", "bl"]) {
          const c = q[k];
          if (!c) continue;
          if (c.x < x0) x0 = c.x;
          if (c.y < y0) y0 = c.y;
          if (c.x > x1) x1 = c.x;
          if (c.y > y1) y1 = c.y;
        }
      }
      x0 -= 1;
      y0 -= 1;
      x1 += 1;
      y1 += 1;
      const rw = x1 - x0, rh = y1 - y0;
      if (!(rw > 0.5) || !(rh > 0.5)) return null;
      const dpr = (this.canvas?.ownerDocument?.defaultView || window).devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(rw * dpr));
      const ph = Math.max(1, Math.round(rh * dpr));
      if (pw * ph > 6e4) return null;
      let ac = this._auroraCanvas;
      if (!ac || ac.width !== pw || ac.height !== ph) {
        ac = this._auroraCanvas = createEl("canvas");
        ac.width = pw;
        ac.height = ph;
        this._auroraCtx = ac.getContext("2d");
        this._auroraImg = null;
      }
      const actx = this._auroraCtx;
      if (!actx) return null;
      let img = this._auroraImg;
      if (!img || img.width !== pw || img.height !== ph) {
        img = this._auroraImg = actx.createImageData(pw, ph);
      }
      const data = img.data;
      const speed = this.look.energySpeed ?? 1;
      const t = performance.now() / 1e3 * speed;
      const LUT = 96;
      let lut = this._auroraLut;
      if (!lut || lut.length !== LUT * 3) lut = this._auroraLut = new Float32Array(LUT * 3);
      for (let i = 0; i < LUT; i++) {
        const s = this.sampleRamp(i / LUT, true);
        lut[i * 3] = s[0];
        lut[i * 3 + 1] = s[1];
        lut[i * 3 + 2] = s[2];
      }
      const a255 = Math.max(0, Math.min(255, Math.round(alpha * 255)));
      const invW = 1 / pw, invH = 1 / ph;
      for (let py = 0; py < ph; py++) {
        const v = py * invH;
        for (let px = 0; px < pw; px++) {
          const u = px * invW;
          const warp = Math.sin(v * 4.1 + t * 0.9 + u * 2.3) * 0.2 + Math.sin(v * 7.3 - t * 0.6 + u * 3.7) * 0.11 + Math.sin(u * 5.2 + t * 1.1 - v * 1.9) * 0.15;
          let s = v - t * 0.3 + warp * wav;
          const mix = (0.5 + 0.5 * Math.sin(u * 2.1 + v * 2.3 + t * 0.7)) * 0.55;
          let s2 = v * 0.45 + u * 0.25 + t * 0.17 + 0.37;
          let i1 = (Math.floor(s * LUT) % LUT + LUT) % LUT;
          let i2 = (Math.floor(s2 * LUT) % LUT + LUT) % LUT;
          i1 *= 3;
          i2 *= 3;
          let r = lut[i1] + (lut[i2] - lut[i1]) * mix;
          let g = lut[i1 + 1] + (lut[i2 + 1] - lut[i1 + 1]) * mix;
          let b = lut[i1 + 2] + (lut[i2 + 2] - lut[i1 + 2]) * mix;
          const pulse = 0.5 + 0.5 * Math.sin((v - t * 0.6) * Math.PI * 2 + u * 1.4);
          if (pulse > 0.5) {
            const k = (pulse - 0.5) * 2 * 0.45;
            r += (255 - r) * k * 0.55;
            g += (255 - g) * k * 0.55;
            b += (255 - b) * k * 0.55;
          } else {
            const k = (0.5 - pulse) * 2 * 0.45;
            r -= r * k * 0.45;
            g -= g * k * 0.45;
            b -= b * k * 0.45;
          }
          const o = (py * pw + px) * 4;
          data[o] = r < 0 ? 0 : r > 255 ? 255 : r;
          data[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
          data[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
          data[o + 3] = a255;
        }
      }
      actx.putImageData(img, 0, 0);
      const pat = ctx.createPattern(ac, "no-repeat");
      if (!pat) return null;
      if (typeof pat.setTransform === "function" && typeof DOMMatrix === "function") {
        pat.setTransform(new DOMMatrix().translateSelf(x0, y0).scaleSelf(1 / dpr, 1 / dpr));
      } else {
        return null;
      }
      return pat;
    } catch {
      return null;
    }
  },
  createEnergyGradient(x, y, w, h, baseColor, alpha) {
    const ctx = this.ctx;
    if (!ctx) return hexToRgba(baseColor, alpha);
    const speed = this.look.energySpeed ?? 1;
    const t = performance.now() / 1e3 * speed;
    const base = hexToRgbTuple(baseColor);
    const rampOn = !!this.look.gradientEnabled;
    const aurora = rampOn && !!this.look.energyAurora;
    const grad = ctx.createLinearGradient(x + w / 2, y + h, x + w / 2, y);
    const stops = aurora ? 20 : rampOn ? 12 : 6;
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops;
      const pulse = 0.5 + 0.5 * Math.sin((pos - t * 0.6) * Math.PI * 2);
      let bs;
      if (aurora) {
        const warp = Math.sin(pos * 3.1 + t * 0.85) * 0.26 + Math.sin(pos * 5.7 - t * 0.55) * 0.14 + Math.sin(pos * 1.3 + t * 1.25) * 0.2;
        const near = this.sampleRamp(pos - t * 0.3 + warp, true);
        const far = this.sampleRamp(pos * 0.45 + t * 0.17 + 0.37, true);
        const mix = (0.5 + 0.5 * Math.sin(pos * 2.3 + t * 0.7)) * 0.6;
        bs = [
          near[0] + (far[0] - near[0]) * mix,
          near[1] + (far[1] - near[1]) * mix,
          near[2] + (far[2] - near[2]) * mix
        ];
      } else {
        bs = rampOn ? this.sampleRamp(pos - t * 0.35, true) : base;
      }
      let r = bs[0], g = bs[1], b = bs[2];
      const punch = aurora ? 0.45 : 1;
      if (pulse > 0.5) {
        const k = (pulse - 0.5) * 2 * punch;
        r += (255 - r) * k * 0.55;
        g += (255 - g) * k * 0.55;
        b += (255 - b) * k * 0.55;
      } else {
        const k = (0.5 - pulse) * 2 * punch;
        r -= r * k * 0.45;
        g -= g * k * 0.45;
        b -= b * k * 0.45;
      }
      if (!rampOn) {
        const shift = 14;
        r += Math.sin(t * 0.7 + pos * 6) * shift;
        g += Math.sin(t * 0.7 + pos * 6 + 2.1) * shift;
        b += Math.sin(t * 0.7 + pos * 6 + 4.2) * shift;
      }
      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));
      grad.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  }
};

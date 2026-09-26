// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { THUNDER_PALETTE } from "./constants.js";

export function hexToRgba(hex, alpha) {
  let h = (hex || "#39ff14").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const int = parseInt(h, 16) || 0;
  const r = int >> 16 & 255;
  const g = int >> 8 & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
export function hexToRgb(hex) {
  let h = (hex || "#ff963c").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const n = parseInt(h, 16) || 0;
  return `${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}`;
}
export function lighten(c, f) {
  return Math.round(c + (255 - c) * f);
}
export function thunderRamp(hue = null) {
  if (typeof hue === "number") {
    return [
      hslToRgbTuple(hue, 0.85, 0.62),
      hslToRgbTuple(hue + 18, 0.8, 0.72),
      hslToRgbTuple(hue + 36, 0.7, 0.85)
    ];
  }
  const pool = THUNDER_PALETTE.slice();
  const n = 2 + (Math.random() < 0.55 ? 1 : 0);
  const stops = [];
  for (let i = 0; i < n; i++) {
    stops.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return stops;
}
export function thunderColorAt(stops, t) {
  if (stops.length === 1) return stops[0];
  const p = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const f = p - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
}
export function hexToRgbTuple(hex) {
  let h = (hex || "#ffffff").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16) || 0;
  return [int >> 16 & 255, int >> 8 & 255, int & 255];
}
export function hslToRgbTuple(h, s, l) {
  const hue = (h % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(hue / 60 % 2 - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (hue < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}
export function hslToRgbString(h, s, l) {
  const [r, g, b] = hslToRgbTuple(h, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}
export function rgbToHsv([r, g, b]) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rr) h = 60 * ((gg - bb) / d % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max > 1e-6 ? d / max : 0, max];
}
export function hsvToRgb([h, s, v]) {
  const hue = (h % 360 + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(hue / 60 % 2 - 1));
  const m = val - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}
export function lerpHsv(a, b, f, arc = 0) {
  let hue;
  if (a[1] < 0.03) hue = b[0];
  else if (b[1] < 0.03) hue = a[0];
  else {
    let d = (b[0] - a[0] + 540) % 360 - 180;
    if (arc > 0 && d < 0) d += 360;
    else if (arc < 0 && d > 0) d -= 360;
    hue = a[0] + d * f;
  }
  return [hue, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export function rgbTupleToHex([r, g, b]) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${(1 << 24 | c(r) << 16 | c(g) << 8 | c(b)).toString(16).slice(1)}`;
}
export function parseColorTuple(colorStr) {
  if (!colorStr || typeof colorStr !== "string") return null;
  const s = colorStr.trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length < 6) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(n)) return null;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const nums = s.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  const t = nums.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
  return t.some((v) => !Number.isFinite(v)) ? null : t;
}
export function relLuminance(rgb) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
export function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export var GLYPH_MIN_CONTRAST = 4.5;
export function readableGlyphColor(boxColorStr, mode = "contrast") {
  const box = parseColorTuple(boxColorStr);
  if (!box) return "#000000";
  const inv = [255 - box[0], 255 - box[1], 255 - box[2]];
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  if (mode === "invert") return rgb(inv);
  const white = [255, 255, 255], black = [0, 0, 0];
  const poleC = contrastRatio(white, box) >= contrastRatio(black, box) ? white : black;
  if (mode !== "tinted") return rgb(poleC);
  if (contrastRatio(inv, box) >= GLYPH_MIN_CONTRAST) return rgb(inv);
  const pole = poleC[0];
  const STEPS = 16;
  let best = inv;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const c = [
      Math.round(inv[0] + (pole - inv[0]) * t),
      Math.round(inv[1] + (pole - inv[1]) * t),
      Math.round(inv[2] + (pole - inv[2]) * t)
    ];
    best = c;
    if (contrastRatio(c, box) >= GLYPH_MIN_CONTRAST) break;
  }
  return rgb(best);
}

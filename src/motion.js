// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { TORCH_FLICKER_PHASES, TORCH_FLICKER_RATES, TORCH_FLICKER_WEIGHTS } from "./constants.js";

export function torchFlickerScale(nowMs, amount) {
  const a = Math.max(0, Math.min(1, amount));
  if (a === 0) return 1;
  const t = nowMs / 1e3;
  let n = 0;
  for (let i = 0; i < TORCH_FLICKER_RATES.length; i++) {
    n += Math.sin(t * TORCH_FLICKER_RATES[i] + TORCH_FLICKER_PHASES[i]) * TORCH_FLICKER_WEIGHTS[i];
  }
  return 1 - a * (1 - n) / 2;
}
export var REDUCED_MOTION_OFF_KEYS = [
  "smoothEnabled",
  // the cursor gliding to its destination
  "smear",
  // corner springs
  "popEffects",
  // letters, disintegration, thunderstrike, fireworks
  "flameTrail",
  // pixel trail, including the jump streak
  "stardustEnabled",
  // ambient drift
  "hotHead",
  // continuous fire
  "speedDemonSparks",
  // emission; the heat colour itself is not motion
  "crtGlitch",
  // whole-cursor displacement bursts
  "energyEffect",
  // wall-clock shimmer inside the cursor body
  "blinkBreathing",
  // size oscillation
  "overlayBlinkSync",
  // torch radius pulse
  "overlayFlicker"
  // torch candle flicker
];
export function applyReducedMotion(obj) {
  for (const k of REDUCED_MOTION_OFF_KEYS) obj[k] = false;
  return obj;
}
export function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}
export function glitchNoise(a, b, c) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519) >>> 0;
  n = Math.imul(n ^ n >>> 13, 1274126177) >>> 0;
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
export function isTextCaretHost(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return type === "text" || type === "search" || type === "url" || type === "tel" || type === "email" || type === "password" || type === "number";
  }
  return false;
}
export function blinkSegments(speed, onOffBalance = 0.5, fade = 0.15) {
  const period = 2500 / speed;
  fade = Math.max(0.02, Math.min(0.5, fade ?? 0.15));
  const balance = Math.max(0.1, Math.min(0.9, onOffBalance));
  const hold = 1 - fade * 2;
  const p1 = hold * balance;
  const p2 = p1 + fade;
  const p3 = p2 + hold * (1 - balance);
  return { period, p1, p2, p3, fade };
}
export function blinkAlphaAt(nowMs, speed, onOffBalance = 0.5, fade = 0.15) {
  if (speed <= 0) return 1;
  const s = blinkSegments(speed, onOffBalance, fade);
  const phase = nowMs % s.period / s.period;
  if (phase < s.p1) return 1;
  if (phase < s.p2) return 1 - easeInOutSine((phase - s.p1) / s.fade);
  if (phase < s.p3) return 0;
  return easeInOutSine((phase - s.p3) / s.fade);
}

// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { TORCH_CANVAS_SCALE } from "../constants.js";

export function clipToRegions(ctx, regions) {
  if (!regions) return false;
  ctx.save();
  ctx.beginPath();
  for (const b of regions) ctx.rect(b.left, b.top, b.width, b.height);
  ctx.clip();
  return true;
}
export function paintTorchDarkness(ctx, w, h, spots, radiusPx, darkness, regions) {
  const d = Math.max(0, Math.min(1, darkness));
  const r = Math.max(1, radiusPx);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  const clipped = clipToRegions(ctx, regions);
  ctx.fillStyle = `rgba(0, 0, 0, ${d})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  for (const sp of spots) {
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    g.addColorStop(0, "rgba(0, 0, 0, 1)");
    g.addColorStop(0.4, "rgba(0, 0, 0, 0.48)");
    g.addColorStop(0.7, "rgba(0, 0, 0, 0.09)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = "source-over";
  if (clipped) ctx.restore();
}
export function paintTorchGlow(ctx, w, h, spots, radiusPx, warmRgb, regions) {
  const r = Math.max(1, radiusPx * 0.6);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  const clipped = clipToRegions(ctx, regions);
  for (const sp of spots) {
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    g.addColorStop(0, `rgba(${warmRgb}, 0.4)`);
    g.addColorStop(0.45, `rgba(${warmRgb}, 0.12)`);
    g.addColorStop(0.75, `rgba(${warmRgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
  }
  if (clipped) ctx.restore();
}
export function torchCanvasContext(el, w, h) {
  const bw = Math.max(1, Math.ceil(w * TORCH_CANVAS_SCALE));
  const bh = Math.max(1, Math.ceil(h * TORCH_CANVAS_SCALE));
  if (el.width !== bw || el.height !== bh) {
    el.width = bw;
    el.height = bh;
  }
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(TORCH_CANVAS_SCALE, 0, 0, TORCH_CANVAS_SCALE, 0, 0);
  return ctx;
}

// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { CANVAS_REGION_GRID, CANVAS_REGION_MARGIN_X, CANVAS_REGION_SHRINK_RATIO } from "./constants.js";

export function fitCanvasRegion(need, clip, current, opts = {}) {
  const marginX = opts.marginX ?? CANVAS_REGION_MARGIN_X;
  const marginY = opts.marginY ?? 32;
  const grid = opts.grid ?? CANVAS_REGION_GRID;
  if (!need || !clip || clip.w <= 0 || clip.h <= 0) return current;
  const cx1 = clip.x + clip.w, cy1 = clip.y + clip.h;
  const nx0 = Math.max(clip.x, Math.floor(need.x0));
  const ny0 = Math.max(clip.y, Math.floor(need.y0));
  const nx1 = Math.min(cx1, Math.ceil(need.x1));
  const ny1 = Math.min(cy1, Math.ceil(need.y1));
  if (nx1 <= nx0 || ny1 <= ny0) return current;
  const contains = current && nx0 >= current.x && ny0 >= current.y && nx1 <= current.x + current.w && ny1 <= current.y + current.h;
  let w = Math.min(clip.w, Math.ceil((nx1 - nx0 + 2 * marginX) / grid) * grid);
  let h = Math.min(clip.h, Math.ceil((ny1 - ny0 + 2 * marginY) / grid) * grid);
  if (contains) {
    if (!opts.allowShrink) return current;
    if (current.w * current.h <= CANVAS_REGION_SHRINK_RATIO * w * h) return current;
  } else if (current && w <= current.w && h <= current.h) {
    w = current.w;
    h = current.h;
  }
  let x = Math.round((nx0 + nx1) / 2 - w / 2);
  let y = Math.round((ny0 + ny1) / 2 - h / 2);
  if (x + w > cx1) x = cx1 - w;
  if (y + h > cy1) y = cy1 - h;
  if (x < clip.x) x = clip.x;
  if (y < clip.y) y = clip.y;
  if (current && x === current.x && y === current.y && w === current.w && h === current.h) return current;
  return { x, y, w, h };
}
export function wrapperClipForStatusBar(wrapper, bar) {
  const { top, left, width } = wrapper;
  const height = wrapper.height;
  const maxBottom = bar.top;
  if (top + height <= maxBottom) return { height, clipPath: "" };
  const spansPane = bar.left <= left + 2 && bar.right >= left + width - 2;
  if (spansPane || !(bar.right > bar.left)) {
    return { height: Math.max(0, Math.floor(maxBottom - top)), clipPath: "" };
  }
  const ny = Math.max(0, Math.floor(maxBottom - top));
  const nx0 = Math.max(0, Math.floor(bar.left - left));
  const nx1 = Math.min(width, Math.ceil(bar.right - left));
  if (nx1 <= nx0) return { height, clipPath: "" };
  const W = width, H = height;
  const clipPath = `polygon(0 0, ${W}px 0, ${W}px ${H}px, ${nx1}px ${H}px, ${nx1}px ${ny}px, ${nx0}px ${ny}px, ${nx0}px ${H}px, 0 ${H}px)`;
  return { height, clipPath };
}

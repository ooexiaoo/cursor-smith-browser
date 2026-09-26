// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { SMEAR_LEAD_BOOST_CAP, SMEAR_SETTLE_V, SMEAR_VOLUME_MIN_FACTOR, TAPER_FULL_LAG, TAPER_MIN_LAG } from "../constants.js";

export var paintSmearMethods = {
  updateSmearQuad() {
    const now = performance.now();
    if (!this._smearDtT) this._smearDtT = now;
    let dt = (now - this._smearDtT) / 1e3;
    this._smearDtT = now;
    dt = Math.min(dt, 0.05);
    const settings = this.look;
    const rect = settings.smear ? this.getActiveRect() : null;
    if (!rect) {
      this.smearQuad = null;
      this.smearShape = null;
      this.smearCenterPrev = null;
      this._smearLead = null;
      this._smearTrail = null;
      this._smearMoving = false;
      return;
    }
    const target = { x: rect.x, y: rect.y };
    const offsets = { tl: { x: 0, y: 0 }, tr: { x: rect.w, y: 0 }, br: { x: rect.w, y: rect.h }, bl: { x: 0, y: rect.h } };
    if (!this.smearQuad || !this._smearLead || !this._smearTrail) {
      this._smearLead = { x: target.x, y: target.y, vx: 0, vy: 0 };
      this._smearTrail = { x: target.x, y: target.y };
      this.smearQuad = {};
      for (const key of Object.keys(offsets)) {
        this.smearQuad[key] = { x: target.x + offsets[key].x, y: target.y + offsets[key].y, vx: 0, vy: 0 };
      }
      this.smearCenterPrev = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      this.smearShape = this.smearQuad;
      this._smearMoving = false;
      return;
    }
    {
      const lead2 = this._smearLead, trail2 = this._smearTrail, q = this.smearQuad;
      if (!this._smearMoving && this.smearShape === q && lead2.x === target.x && lead2.y === target.y && lead2.vx === 0 && lead2.vy === 0 && trail2.x === target.x && trail2.y === target.y && q.tl.x === target.x && q.tl.y === target.y && q.tr.x === target.x + rect.w && q.tr.y === target.y && q.br.x === target.x + rect.w && q.br.y === target.y + rect.h && q.bl.x === target.x && q.bl.y === target.y + rect.h) {
        return;
      }
    }
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    let dirX = 0, dirY = 0;
    if (this.smearCenterPrev) {
      dirX = center.x - this.smearCenterPrev.x;
      dirY = center.y - this.smearCenterPrev.y;
    }
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen > 0.01) {
      this._smearDir = { x: dirX / dirLen, y: dirY / dirLen };
    }
    this.smearCenterPrev = center;
    const leadBoost = settings.smoothEnabled ? Math.max(1, Math.min(SMEAR_LEAD_BOOST_CAP, this._catchUpBoost || 1)) : 1;
    const freqLead = (2 + Math.max(0, Math.min(1, settings.smearStiffness)) * 38) * leadBoost;
    const freqTrail = 2 + Math.max(0, Math.min(1, settings.smearTrailingStiffness)) * 38;
    const dampingRatio = 0.15 + Math.max(0, Math.min(1, settings.smearDamping)) * 1.15;
    const MAX_STEP = 1 / 240;
    const steps = Math.max(1, Math.min(16, Math.ceil(dt / MAX_STEP)));
    const h = dt / steps;
    const lead = this._smearLead;
    const trail = this._smearTrail;
    const k = freqLead * freqLead;
    const damp = 2 * dampingRatio * freqLead;
    for (let i = 0; i < steps; i++) {
      const ax2 = k * (target.x - lead.x) - damp * lead.vx;
      const ay2 = k * (target.y - lead.y) - damp * lead.vy;
      lead.vx += ax2 * h;
      lead.vy += ay2 * h;
      lead.x += lead.vx * h;
      lead.y += lead.vy * h;
      const f = 1 - Math.exp(-freqTrail * h);
      trail.x += (lead.x - trail.x) * f;
      trail.y += (lead.y - trail.y) * f;
    }
    if (!isFinite(lead.x) || !isFinite(lead.y) || !isFinite(lead.vx) || !isFinite(lead.vy) || !isFinite(trail.x) || !isFinite(trail.y)) {
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
    }
    this.applySmearMaxLength(rect);
    const dir = this._smearDir;
    const ax = dir ? Math.abs(dir.x) : 0, ay = dir ? Math.abs(dir.y) : 0;
    const hx = (rect.h * ax) ** 4, wy = (rect.w * ay) ** 4;
    const u = hx + wy > 0 ? hx / (hx + wy) : 0.5;
    const sgnX = dir ? Math.sign(dir.x) : 0, sgnY = dir ? Math.sign(dir.y) : 0;
    const tvx = (lead.x - trail.x) * freqTrail, tvy = (lead.y - trail.y) * freqTrail;
    let moving = false;
    for (const key of Object.keys(offsets)) {
      const o = offsets[key];
      const sx = o.x > 0 ? 1 : -1;
      const sy = o.y > 0 ? 1 : -1;
      const front = dir ? sx * sgnX * u + sy * sgnY * (1 - u) : 0;
      const f = (1 - front) / 2;
      const c = this.smearQuad[key];
      c.x = lead.x + (trail.x - lead.x) * f + o.x;
      c.y = lead.y + (trail.y - lead.y) * f + o.y;
      c.vx = lead.vx + (tvx - lead.vx) * f;
      c.vy = lead.vy + (tvy - lead.vy) * f;
      const tx = target.x + o.x, ty = target.y + o.y;
      if (Math.abs(c.x - tx) > 0.5 || Math.abs(c.y - ty) > 0.5 || Math.abs(c.vx) > SMEAR_SETTLE_V || Math.abs(c.vy) > SMEAR_SETTLE_V) moving = true;
    }
    this._smearMoving = moving;
    this.applySmearTaper({
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
      bl: { x: rect.x, y: rect.y + rect.h }
    }, center);
    this.applySmearVolume({
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
      bl: { x: rect.x, y: rect.y + rect.h }
    }, rect);
    if (moving) {
      this.smearQuadLastMoveT = now;
    } else {
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
      for (const key of Object.keys(offsets)) {
        const c = this.smearQuad[key];
        c.x = target.x + offsets[key].x;
        c.y = target.y + offsets[key].y;
        c.vx = 0;
        c.vy = 0;
      }
    }
  },
  // Cap how far the tail trails the caret. A page-down or a click across the
  // pane otherwise stretches the quad the whole way - a streak the height of
  // the pane that then takes its time contracting. With a cap, no corner may
  // lag its own target by more than the cap: a corner further out is pulled
  // in along its own line of travel until it is exactly the cap behind. The
  // caret keeps its shape - the leading corners are at their targets, the
  // trailing ones the cap behind them - and the taper does its own job on
  // what is left. This is written into the spring's STATE, deliberately:
  // the tail is meant to arrive sooner, not just to be drawn shorter.
  //
  // Not smear-cursor.nvim's version, which scales every corner toward the
  // one nearest its target: on a 9x24 box that collapses the tail to a point
  // at that corner's height, and the smear read as tapered the wrong way
  // round, narrow at the front (1.5.4, seen live).
  applySmearMaxLength(rect) {
    const cap = this.look.smearMaxLength;
    const lead = this._smearLead, trail = this._smearTrail;
    if (!lead || !trail || !(cap > 0)) return;
    for (const p of [lead, trail]) {
      const dx2 = p.x - rect.x, dy2 = p.y - rect.y;
      const d2 = Math.hypot(dx2, dy2);
      if (d2 <= cap) continue;
      const f = cap / d2;
      p.x = rect.x + dx2 * f;
      p.y = rect.y + dy2 * f;
    }
    const dx = lead.x - rect.x, dy = lead.y - rect.y;
    const d = Math.hypot(dx, dy);
    if (d >= cap - 1e-9 && d > 0) {
      const away = (lead.vx * dx + lead.vy * dy) / d;
      if (away > 0) {
        lead.vx -= dx / d * away;
        lead.vy -= dy / d * away;
      }
    }
  },
  // Conserve the smear's area: a long streak gets thin. The quad's area is
  // compared with the caret's resting area and every corner is pulled toward
  // the centre ACROSS its own direction of travel by (rest / area) to the
  // strength, floored at SMEAR_VOLUME_MIN_FACTOR - so the stretch along the
  // move is untouched and only the width across it gives. After
  // smear-cursor.nvim's shrink_volume, with one change: the pull is weighted
  // by each corner's share of the lag, as the taper's is, so the leading
  // edge - the caret itself - keeps its full size and only the tail thins.
  // Their cursor IS the smear; ours has a caret at the front of it.
  //
  // Skipped on an axis-aligned move. A horizontal smear is a rectangle that
  // is wider than the caret, so conserving its area would thin the caret's
  // height while you type - the effect is for the diagonal streak of a
  // jump, where the parallelogram sweeps far more area than the caret has.
  //
  // Like the taper, this derives the painted corners and is never written
  // back into smearQuad: the spring integrates forward from its own state.
  applySmearVolume(targets, rect) {
    const shape = this.smearShape;
    const strength = Math.max(0, Math.min(1, this.look.smearVolumeStrength ?? 0.3));
    if (!shape || !this.look.smearConserveVolume || strength <= 0) return;
    const cx = (shape.tl.x + shape.tr.x + shape.br.x + shape.bl.x) / 4;
    const cy = (shape.tl.y + shape.tr.y + shape.br.y + shape.bl.y) / 4;
    const tx = rect.x + rect.w / 2, ty = rect.y + rect.h / 2;
    if (Math.abs(tx - cx) < 1 || Math.abs(ty - cy) < 1) return;
    const pts = [shape.tl, shape.tr, shape.br, shape.bl];
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      area2 += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(area2) / 2;
    const rest = rect.w * rect.h;
    if (!(area > rest) || !(rest > 0)) return;
    const factor = Math.max(SMEAR_VOLUME_MIN_FACTOR, Math.pow(rest / area, strength / 2));
    if (factor >= 0.999) return;
    if (!this._volumeBuf) {
      this._volumeBuf = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    }
    const out = this._volumeBuf;
    let maxLag = 0;
    const lag = {};
    for (const k of Object.keys(targets)) {
      lag[k] = Math.hypot(targets[k].x - shape[k].x, targets[k].y - shape[k].y);
      if (lag[k] > maxLag) maxLag = lag[k];
    }
    if (maxLag < 0.01) return;
    for (const k of Object.keys(targets)) {
      const c = shape[k];
      const mx = targets[k].x - c.x, my = targets[k].y - c.y;
      const ml = lag[k];
      if (ml < 0.01) {
        out[k].x = c.x;
        out[k].y = c.y;
        continue;
      }
      const nx = -my / ml, ny = mx / ml;
      const proj = (c.x - cx) * nx + (c.y - cy) * ny;
      const shift = proj * (1 - factor) * (ml / maxLag);
      out[k].x = c.x - nx * shift;
      out[k].y = c.y - ny * shift;
    }
    this.smearShape = out;
  },
  // Derive the corners to PAINT from the corners the spring is holding.
  //
  // With Tapered Trail off this is just the quad itself, passed straight
  // through by reference - no copy, no work. With it on, the trailing end is
  // pulled in toward the line of travel so the smear comes to a point behind
  // the caret instead of dragging a full-width rectangle.
  //
  // The result is deliberately NOT written back into smearQuad. That object is
  // the spring's state, integrated forward from its own previous position: a
  // tapered corner stored there would become the position the next frame
  // springs from, so the corners would chase the narrowed shape and the taper
  // would eat the very lag it is drawn from. Derived fresh each frame and
  // thrown away.
  applySmearTaper(targets, center) {
    const q = this.smearQuad;
    const amount = Math.max(0, Math.min(1, this.look.smearTaperAmount ?? 0.7));
    const dir = this._smearDir;
    if (!q || !this.look.smearTaper || amount <= 0 || !dir) {
      this.smearShape = q;
      return;
    }
    let maxLag = 0;
    const lag = {};
    for (const k of Object.keys(targets)) {
      const l = Math.hypot(q[k].x - targets[k].x, q[k].y - targets[k].y);
      lag[k] = l;
      if (l > maxLag) maxLag = l;
    }
    const reach = Math.max(0, Math.min(1, (maxLag - TAPER_MIN_LAG) / (TAPER_FULL_LAG - TAPER_MIN_LAG)));
    if (reach <= 1e-3) {
      this.smearShape = q;
      return;
    }
    if (!this._taperBuf) {
      this._taperBuf = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    }
    const out = this._taperBuf;
    for (const k of Object.keys(targets)) {
      const c = q[k];
      const ox = c.x - center.x;
      const oy = c.y - center.y;
      const along = ox * dir.x + oy * dir.y;
      const px = ox - along * dir.x;
      const py = oy - along * dir.y;
      const w = lag[k] / maxLag * reach * amount;
      out[k].x = c.x - px * w;
      out[k].y = c.y - py * w;
    }
    this.smearShape = out;
  },
  // The four corners to paint the cursor through, or null when Motion Smear is
  // off and callers should use the plain caret rect instead.
  smearCorners() {
    if (!this.look.smear) return null;
    return this.smearShape || this.smearQuad;
  },
  // The painted quad reduced to a short string, for the draw-skip signature.
  // See the call site for why the quad has to be in that signature at all.
  _smearSig() {
    const q = this.look.smear ? this.smearCorners() : null;
    if (!q) return "nosmear";
    let s = "";
    for (const k of ["tl", "tr", "br", "bl"]) {
      const c = q[k];
      if (!c) return "nosmear";
      s += Math.round(c.x * 2) + ":" + Math.round(c.y * 2) + ",";
    }
    return s;
  }
};

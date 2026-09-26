// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { CARET_STATE_FIELDS, CATCHUP_BOOST_RATE, JUMP_TRAIL_MIN_DIST, SECONDARY_FULL_MAX, SECONDARY_MATCH_WINDOW } from "./constants.js";
import { HOT_ENGULF_MS } from "./fire.js";

export var caretsMethods = {
  // =========================================================================
  // Multi-cursor: full effects on secondary carets
  // =========================================================================
  // Every non-primary caret up to SECONDARY_FULL_MAX gets the primary's whole
  // pipeline rather than a 2px line. Nothing in that pipeline takes a caret
  // argument; it reads and writes the fields in CARET_STATE_FIELDS on
  // `this`, and those are accessors over the current caret's state object
  // (this._caret), so _withCaret makes a secondary's bundle current with one
  // pointer, runs the primary's own code, and points back.
  //
  // What is per caret: position, smoothing, the smear spring, the trail,
  // the pending (Move Delay) state, a Signal Glitch burst, and the pop
  // effects a move spawns (letter pop, pixel trail, disintegration, jump
  // trail). What stays global: the blink clock (lastMoveTime - every caret
  // blinks with the primary), Speed Demon's heat, Thunderstrike, Fireworks,
  // Hot-head and Stardust, which follow the primary only.
  // A caret's state is an object (CaretState): the primary's is this._caret,
  // a full-effect secondary's is its bundle in this._secondaries. Every
  // per-caret field (CARET_STATE_FIELDS) is an accessor on the class that
  // forwards to this._caret (the end of plugin.ts), so the pipeline
  // addresses whichever caret is current as `this.x`, and switching carets
  // is one pointer. Until 1.5.8 _withCaret copied the forty fields into a
  // scratch bundle and the secondary's in, ran the code, and copied both
  // back - twice per secondary per frame - and three of the smear's fields
  // were missing from the list, so every secondary's spring integrated the
  // primary's points toward its own target.
  // A bundle in the state a fresh engine has: the reset, run by a scratch
  // engine whose caret is the new object, so the two cannot drift.
  _freshCaretState() {
    const fresh = {};
    const scratch = Object.create(Object.getPrototypeOf(this));
    scratch._caret = fresh;
    scratch._resetEngineState();
    return fresh;
  },
  // Run `fn` with `state` as the current caret, then put the primary back.
  // Nothing is copied: the state object is the caret before, during and
  // after. Re-entrant - a nested swap restores the outer one - and the
  // primary is always what is put back, whatever fn threw.
  _withCaret(state, fn) {
    const prev = this._caret;
    const pass = this._caretPass;
    const owner = this._caretOwner;
    this._caret = state;
    this._caretPass = "secondary";
    this._caretOwner = state;
    try {
      return fn();
    } finally {
      this._caret = prev;
      this._caretPass = pass;
      this._caretOwner = owner;
    }
  },
  // The selection changed shape: a range was added or removed, or a different
  // one is main. Index-aligned bundles are then wrong, so every bundle - the
  // primary's included, since the range it was tracking may now be a
  // secondary and vice versa - is matched to the new ranges by document
  // position. An Alt+click that makes the new caret main is the common case:
  // the old primary's state follows its range down into the secondaries and
  // the new caret starts fresh, so nothing streaks across the page. Ranges
  // cannot cross without merging, so while the shape holds, index order does.
  rematchCaretStates(view) {
    const sel = view && view.hasFocus ? view.state.selection : null;
    const count = sel ? sel.ranges.length : 1;
    const mainIndex = sel ? sel.mainIndex : 0;
    const prev = this._selShape;
    this._selShape = { count, mainIndex };
    if (!prev || prev.count === count && prev.mainIndex === mainIndex) return;
    if (!sel) {
      this._secondaries = [];
      return;
    }
    const candidates = [{ state: this._caret, pos: this.lastActive ? this.lastActive.pos : null }];
    for (const c of this._secondaries) candidates.push({ state: c, pos: c.lastActive ? c.lastActive.pos : null });
    const take = (head) => {
      let best = -1, bestD = SECONDARY_MATCH_WINDOW + 1, bestCand = null;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        if (!cand || cand.pos == null) continue;
        const d = Math.abs(cand.pos - head);
        if (d < bestD) {
          bestD = d;
          best = i;
          bestCand = cand;
        }
      }
      if (!bestCand) return null;
      candidates[best] = null;
      return bestCand.state;
    };
    const main = take(sel.ranges[mainIndex].head) || this._freshCaretState();
    this._caret = main;
    const next = [];
    for (let i = 0; i < sel.ranges.length && next.length < SECONDARY_FULL_MAX; i++) {
      if (i === mainIndex) continue;
      next.push(take(sel.ranges[i].head) || this._freshCaretState());
    }
    this._secondaries = next;
  },
  // Per frame: measure every secondary, run the primary's update pipeline on
  // the first SECONDARY_FULL_MAX of them through their bundles, and leave the
  // rest in this.secondaryCarets for the plain line. `flags` holds the
  // Backspace/Enter/Space flags as they stood before the primary consumed
  // them, so each secondary's commitMove sees the same keystroke.
  updateSecondaryCarets(view, flags = {}) {
    const raw = this.secondaryCaretCoords(view, this._secondaries);
    const full = raw.slice(0, SECONDARY_FULL_MAX);
    this.secondaryCarets = raw.slice(SECONDARY_FULL_MAX).filter((c) => c.visible);
    const states = this._secondaries;
    while (states.length < full.length) states.push(this._freshCaretState());
    if (states.length > full.length) states.length = full.length;
    if (full.length === 0 || !view) return;
    const lineStyles = /* @__PURE__ */ new Map();
    const primaryFlags = { del: this._deletePending, enter: this._enterPending, pop: this._popKeyPending };
    try {
      for (let i = 0; i < full.length; i++) {
        const record = full[i].visible ? this.secondaryCaretRecord(view, full[i], states[i], lineStyles) : null;
        const c = full[i];
        this._withCaret(states[i], () => {
          this._deletePending = flags.del || 0;
          this._enterPending = flags.enter || 0;
          this._popKeyPending = flags.pop || 0;
          this.updateActivePoint(record);
          this.updateSmoothCursor();
          this.updateSmearQuad();
          this.pruneTrail();
          if (this.look.speedDemon && this.look.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) this.maybeSpawnHotHead();
          this.maybeSpawnStardust();
          states[i]._tetherOut = this.look.bracketTether && c.visible ? this.bracketTetherCoords(view, c.pos, c.empty !== false) : null;
        });
      }
    } finally {
      this._deletePending = primaryFlags.del;
      this._enterPending = primaryFlags.enter;
      this._popKeyPending = primaryFlags.pop;
    }
  },
  // The static-frame signature term for the full-effect secondaries: each
  // one's settled position and shape, plus its smear quad - the same things
  // the primary contributes, for the same reasons (see the tick).
  _secondariesSig() {
    const states = this._secondaries;
    if (!states || states.length === 0) return "";
    const parts = [];
    for (const st of states) {
      const la = st.lastActive;
      parts.push(la ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," + Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "") : "none");
      parts.push(this._withCaret(st, () => this._smearSig()));
    }
    return parts.join(";");
  },
  // Measures where the caret actually sits inside an <input>/<textarea> by
  // mirroring the field's text (up to selectionStart) into an offscreen
  // element with identical font/box metrics, then reading the position of a
  // marker placed at the caret. This is the standard technique for this
  // problem since native form fields expose no coordinate API for the caret.
  formFieldCaretCoords(el) {
    try {
      const doc = el.ownerDocument;
      const win = doc.defaultView || window;
      const style = win.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isTextarea = el.tagName === "TEXTAREA";
      const value = el.value != null ? String(el.value) : "";
      let selStart = value.length;
      try {
        const s = el.selectionStart, e = el.selectionEnd;
        if (typeof s === "number" && typeof e === "number") {
          selStart = el.selectionDirection === "backward" ? s : e;
        }
      } catch {
      }
      let mirror = this._formMirror;
      if (!mirror || mirror.ownerDocument !== doc) {
        mirror?.remove();
        mirror = doc.body.createDiv({ attr: { "aria-hidden": "true" } });
        mirror.setCssStyles({
          position: "absolute",
          visibility: "hidden",
          top: "0",
          left: "0",
          zIndex: "-1",
          pointerEvents: "none"
        });
        this._formMirror = mirror;
      }
      const props = [
        "height",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "fontStyle",
        "fontVariant",
        "fontWeight",
        "fontStretch",
        "fontSize",
        "lineHeight",
        "fontFamily",
        "letterSpacing",
        "textIndent",
        "textTransform",
        "wordSpacing",
        "tabSize",
        "textAlign",
        "direction",
        "unicodeBidi"
      ];
      const dst = mirror.style, src = style;
      for (const p of props) dst[p] = src[p];
      mirror.setCssStyles({ borderStyle: "solid" });
      const padL = parseFloat(style.paddingLeft) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      mirror.setCssStyles({
        boxSizing: "content-box",
        width: Math.max(0, (el.clientWidth || 0) - padL - padR) + "px",
        whiteSpace: isTextarea ? "pre-wrap" : "pre",
        wordWrap: isTextarea ? "break-word" : "normal",
        overflow: "hidden"
      });
      if (!isTextarea) mirror.setCssStyles({ height: "auto" });
      mirror.textContent = "";
      mirror.appendChild(doc.createTextNode(value.substring(0, selStart)));
      const marker = mirror.createSpan();
      marker.setCssStyles({ display: "inline-block", width: "0", verticalAlign: "top" });
      mirror.appendChild(doc.createTextNode(value.substring(selStart)));
      const markerRect = marker.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();
      const offsetX = markerRect.left - mirrorRect.left;
      const offsetY = markerRect.top - mirrorRect.top;
      const scrollLeft = el.scrollLeft || 0;
      const scrollTop = el.scrollTop || 0;
      const fontSize = parseFloat(style.fontSize) || 14;
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2 || 16;
      const left = rect.left + offsetX - scrollLeft;
      let top, height;
      if (isTextarea) {
        top = rect.top + offsetY - scrollTop;
        height = lineHeight;
      } else {
        height = Math.min(lineHeight, rect.height) || fontSize * 1.2;
        top = rect.top + (rect.height - height) / 2;
      }
      const clampedLeft = Math.min(Math.max(left, rect.left), rect.right);
      const clampedTop = Math.min(Math.max(top, rect.top), rect.bottom - 1);
      return { left: clampedLeft, top: clampedTop, bottom: clampedTop + height };
    } catch (e) {
      this._reportOnce("formFieldCaretCoords", e);
      return null;
    }
  },
  // With no argument this is the primary and measures itself. A secondary
  // hands its own record in, with its state bundle swapped into `this`
  // (see _withCaret), and everything below then runs for that caret.
  updateActivePoint(caret = this.caretCoords()) {
    if (!caret || !caret.focused) {
      this.lastActive = null;
      this.pending = null;
      return;
    }
    if (!this.lastActive) {
      this.lastActive = caret;
      this.pending = null;
      return;
    }
    const moved = Math.abs(this.lastActive.x - caret.x) > 0.5 || Math.abs(this.lastActive.top - caret.top) > 0.5;
    if (!moved) {
      if (!this.pending) this.lastActive = caret;
      return;
    }
    if (caret.pos !== null && caret.pos === this.lastActive.pos && caret.assoc === this.lastActive.assoc) {
      const dx = caret.x - this.lastActive.x;
      const dy = caret.top - this.lastActive.top;
      this.lastActive = caret;
      if (this.animActive && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
        this.animActive.x += dx;
        this.animActive.top += dy;
        this.animActive.w = caret.w;
        this.animActive.h = caret.h;
        if (this.smearQuad) {
          for (const key of Object.keys(this.smearQuad)) {
            this.smearQuad[key].x += dx;
            this.smearQuad[key].y += dy;
          }
          if (this._smearLead) {
            this._smearLead.x += dx;
            this._smearLead.y += dy;
          }
          if (this._smearTrail) {
            this._smearTrail.x += dx;
            this._smearTrail.y += dy;
          }
          if (this.smearShape && this.smearShape !== this.smearQuad) {
            for (const key of Object.keys(this.smearShape)) {
              this.smearShape[key].x += dx;
              this.smearShape[key].y += dy;
            }
          }
          if (this.smearCenterPrev) {
            this.smearCenterPrev.x += dx;
            this.smearCenterPrev.y += dy;
          }
        }
        if (this.trail.length) {
          for (const p of this.trail) {
            p.x += dx;
            p.y += dy;
          }
        }
      }
      return;
    }
    const delay = Math.max(0, Math.round(this.look.moveDelayMs));
    if (delay <= 0) {
      this.resolveHoldChar(caret);
      this.commitMove(caret);
      return;
    }
    const pending = this.pending;
    if (!pending || pending.caret.x !== caret.x || pending.caret.top !== caret.top) {
      this.pending = { caret, since: performance.now(), holdChar: this.resolveHoldChar(caret) ?? (this.lastActive ? this.lastActive.char : "") };
    } else if (performance.now() - pending.since >= delay) {
      this.commitMove(pending.caret);
    }
  },
  updateSmoothCursor() {
    if (!this.lastActive) {
      this.animActive = null;
      this._smoothMoving = false;
      this._smoothLastT = 0;
      this._catchUpBoost = 1;
      this._typingBoostSm = null;
      return;
    }
    if (!this.look.smoothEnabled) {
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
      this._catchUpBoost = 1;
      this._typingBoostSm = null;
      return;
    }
    if (!this.animActive) {
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
    }
    const now = performance.now();
    let dt = (now - (this._smoothLastT || now)) / 1e3;
    this._smoothLastT = now;
    dt = Math.max(1e-3, Math.min(dt, 0.05));
    let targetSpeed = this.look.catchUpSpeed;
    let typingBoost = 1;
    if (this.look.smoothAdaptive) {
      const timeSinceMove = now - this.lastMoveTime;
      const maxMod = this.look.maxCatchUpSpeed / Math.max(0.01, this.look.catchUpSpeed);
      if (timeSinceMove < 150) {
        this.typingSpeedMod = Math.min(this.typingSpeedMod + (maxMod - 1) * 8 * dt, maxMod);
      } else {
        this.typingSpeedMod = Math.max(this.typingSpeedMod - (maxMod - 1) * 2 * dt, 1);
      }
      targetSpeed = Math.min(this.look.maxCatchUpSpeed, targetSpeed * this.typingSpeedMod);
      if (timeSinceMove < 150) {
        const cw = Math.max(4, this.lastActive.actualCharWidth || 8);
        const dist = Math.hypot(
          this.lastActive.x - this.animActive.x,
          this.lastActive.top - this.animActive.top
        );
        const backlogChars = Math.max(0, dist / cw - 1);
        typingBoost = 1 + Math.min(3, backlogChars);
      }
    }
    const boostK = 1 - Math.exp(-CATCHUP_BOOST_RATE * dt);
    this._typingBoostSm = this._typingBoostSm == null ? typingBoost : this._typingBoostSm + (typingBoost - this._typingBoostSm) * boostK;
    typingBoost = this._typingBoostSm;
    const RATE_SCALE = 40;
    const rate = Math.max(0.5, targetSpeed * (1 - this.look.smoothness) * RATE_SCALE * typingBoost);
    this._catchUpBoost = targetSpeed / Math.max(0.01, this.look.catchUpSpeed) * typingBoost;
    const lerpFactor = 1 - Math.exp(-rate * dt);
    this.animActive.x += (this.lastActive.x - this.animActive.x) * lerpFactor;
    this.animActive.top += (this.lastActive.top - this.animActive.top) * lerpFactor;
    this.animActive.w += (this.lastActive.w - this.animActive.w) * lerpFactor;
    this.animActive.h += (this.lastActive.h - this.animActive.h) * lerpFactor;
    const arrived = Math.abs(this.lastActive.x - this.animActive.x) < 0.25 && Math.abs(this.lastActive.top - this.animActive.top) < 0.25 && Math.abs(this.lastActive.w - this.animActive.w) < 0.25 && Math.abs(this.lastActive.h - this.animActive.h) < 0.25;
    if (arrived) {
      this.animActive.x = this.lastActive.x;
      this.animActive.top = this.lastActive.top;
      this.animActive.w = this.lastActive.w;
      this.animActive.h = this.lastActive.h;
    }
    this._smoothMoving = !arrived;
    this.animActive.textColor = this.lastActive.textColor;
    this.animActive.char = this.lastActive.char;
    this.animActive.actualCharWidth = this.lastActive.actualCharWidth;
    this.animActive.fontFamily = this.lastActive.fontFamily;
    this.animActive.fontSize = this.lastActive.fontSize;
    this.animActive.fontWeight = this.lastActive.fontWeight;
    this.animActive.fontStyle = this.lastActive.fontStyle;
    this.animActive.letterSpacing = this.lastActive.letterSpacing;
    this.animActive.rowLeft = this.lastActive.rowLeft;
    this.animActive.rowRight = this.lastActive.rowRight;
  },
  commitMove(caret) {
    const secondary = this._caretPass === "secondary";
    if (this.look.speedDemon && this.lastActive && caret && !secondary) {
      const keyed = this._heatKeyT && performance.now() - this._heatKeyT < 150;
      if (!keyed) {
        const dist = Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top);
        const bump = Math.min(0.12, dist / 900) * (this.look.speedDemonSensitivity ?? 1);
        this.heat = Math.min(1, this.heat + bump);
      }
    }
    this.pushTrail(this.lastActive, caret);
    if (this.lastActive) {
      const now = performance.now();
      const disintegrate = !!(this.look.popEffects && this.look.backspaceDisintegrate && this._deletePending && now - this._deletePending < 250);
      this.spawnFlamePixels(this.lastActive, disintegrate);
      if (this.look.flameTrailOnJump && !disintegrate) {
        this.spawnJumpTrail(this.lastActive, caret);
      }
      this._deletePending = 0;
      if (this.look.crtEffect && this.look.crtGlitch) {
        this.spawnGlitch(this.lastActive, caret);
      }
      if (this.styleFor("hotHead") && Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top) >= JUMP_TRAIL_MIN_DIST) {
        this._hotEngulfUntil = now + HOT_ENGULF_MS;
        this._hotActiveT = now;
      }
      if (this._enterPending && now - this._enterPending < 250) {
        this.spawnThunderbolt(caret);
      }
      if (this._popKeyPending && now - this._popKeyPending < 250) {
        this.spawnFireworks(caret);
      }
    }
    if (!secondary) {
      this._enterPending = 0;
      this._popKeyPending = 0;
    }
    this.lastActive = caret;
    this.pending = null;
    this.lastMoveTime = performance.now();
  }
};

// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { Notice } from "./shim/notice.js";

import { CANVAS_REGION_GRID, CANVAS_REGION_MARGIN_X, CANVAS_REGION_MARGIN_Y, CANVAS_REGION_MOTION_PAD, CANVAS_REGION_SHRINK_MS, CANVAS_REGION_SHRINK_RATIO, CARET_STATE_FIELDS, FRAME_CAPS, INPUT_HOT_MS, SCROLL_LOCK_MS, WATCHDOG_INTERVAL_MS, WATCHDOG_STALE_MS } from "./constants.js";
import { step } from "./demo.js";
import { fitCanvasRegion, wrapperClipForStatusBar } from "./geometry.js";
import { presetToCode } from "./share.js";
import { prepareDocument } from "./shim/dom.js";

export var engineMethods = {
  // The element the canvas wrapper hangs from: the focused editor's
  // scroller, where the wrapper rides with the scrolled content - the
  // compositor carries it with the text between ticks; the app container,
  // fixed, while focus is not in the editor (a search field, a prompt: those
  // carets are clipped to their own boxes by the fixed wrapper), the scroller
  // belongs to another document, or it sits in a Canvas card (scaled by a
  // transform the placement does not know).
  //
  // On a phone since 1.6.2; on the desktop since 1.6.5, while no torch can
  // be on. A fixed caret trailed every wheel tick by one frame - a whole
  // scroll step, 55 px, then back: "the cursor jitters around when
  // scrolling" (a Reddit user, who blamed Smooth movement; it did the same
  // with it off). The torch keeps the fixed wrapper: inside the scroller the
  // caret would sit under its darkness and its glow, which is what the
  // phone accepts and the desktop's layering (z 10010-10012) was built
  // against. Word-Smith's bands and bar need no clip in the scroller: they
  // sit above its stacking context.
  _wrapperHome(doc, view) {
    const app = doc.querySelector(".app-container") || doc.body;
    if (!view || !view.hasFocus) return app;
    if (!doc.body.classList.contains("is-mobile") && this.torchPossible()) return app;
    const sc = view.scrollDOM;
    if (!sc || !sc.isConnected || sc.ownerDocument !== doc) return app;
    return sc.closest(".canvas-node") ? app : sc;
  },
  ensureCanvasForView(view) {
    const targetDoc = this._focusedForeignDoc(view) || view && view.dom.ownerDocument || this.canvasWrapper && this.canvasWrapper.ownerDocument || typeof activeDocument !== "undefined" && activeDocument || document;
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument !== targetDoc) {
      this.canvasWrapper.remove();
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
      this._canvasRect = null;
    }
    if (!this.canvasWrapper) {
      targetDoc.body.classList.add("cursor-smith-active");
      prepareDocument(targetDoc);
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.canvasWrapper = appContainer.createDiv({ cls: "cursor-smith-wrapper" });
      this._lastWrapperRect = "";
      this._canvasBlend = "";
      this.canvas = this.canvasWrapper.createEl("canvas", { cls: "cursor-smith-canvas" });
      this.ctx = this.canvas.getContext("2d");
      this._canvasRect = null;
      this._canvasDpr = 0;
      this._wrapperPos = null;
      this._dirtyRaw = null;
    }
    const home = this._wrapperHome(targetDoc, view);
    if (this.canvasWrapper.parentElement !== home) {
      home.appendChild(this.canvasWrapper);
      this.canvasWrapper.classList.toggle("cursor-smith-wrapper-scrolled", home.classList.contains("cm-scroller"));
      this._lastWrapperRect = "";
      this._wrapperPos = null;
      this._canvasPlaced = false;
      this._dirtyFull = true;
    }
    if (!targetDoc.body.classList.contains("cursor-smith-active")) {
      targetDoc.body.classList.add("cursor-smith-active");
    }
    const hideNative = this.hideNativeActive();
    targetDoc.body.classList.toggle("cursor-smith-hide-native", hideNative);
    if (hideNative !== this._hideNativeSig) {
      this._hideNativeSig = hideNative;
      try {
        this.applyBodyClasses();
      } catch (e) {
        this._reportOnce("applyBodyClasses in the tick", e);
      }
    }
  },
  disableCanvasEngine() {
    this.canvasEngineActive = false;
    if (this.canvasRaf) {
      window.cancelAnimationFrame(this.canvasRaf);
      this.canvasRaf = 0;
    }
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
    }
    this._canvasTick = null;
    this._drawSig = null;
    this._caretGeoCache = null;
    this._paneRectCache = null;
    this._mainRectCache = null;
    this._observeEditorLayout(null);
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("cursor-smith-active", "cursor-smith-hide-native");
        const canvas = doc.querySelector(".cursor-smith-canvas");
        if (canvas) {
          if (canvas.parentElement && canvas.parentElement.style.overflow === "hidden") {
            canvas.parentElement.remove();
          } else {
            canvas.remove();
          }
        }
      }
    }
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this._canvasRect = null;
    this._clipRect = null;
    this._wrapperPos = null;
    this._dirtyRaw = null;
    this._resetEngineState();
    this._formMirror?.remove();
    this._formMirror = null;
  },
  enableCanvasEngine() {
    this.canvasEngineActive = true;
    this._resetEngineState();
    this._suspendCleared = false;
    if (this.ctx && this.canvas) this._clearCanvas();
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyRaw = null;
    this._dirtyFull = true;
    this._canvasRect = null;
    this._regionOversizedT = 0;
    const schedule = () => {
      if (!this.canvasEngineActive) return;
      const gear = this._canvasGear || "hot";
      const caps = this._frameCaps();
      if (gear === "hot") {
        this.canvasRaf = window.requestAnimationFrame(tick);
        return;
      }
      const idleMs = Math.min(caps.idleMs, Math.max(1, Math.ceil(this._idleWakeMs || caps.idleMs)));
      this._canvasIdleT = window.setTimeout(() => {
        this._canvasIdleT = 0;
        if (this.canvasEngineActive) this.canvasRaf = window.requestAnimationFrame(tick);
      }, gear === "warm" ? caps.warmMs : gear === "energy" ? caps.energyMs : idleMs);
    };
    const tick = () => {
      if (!this.canvasEngineActive) return;
      this._lastTickT = performance.now();
      const perf = this._perf;
      if ((this._canvasGear || "hot") === "hot") {
        const n = performance.now();
        if (perf) {
          if (perf.rafPrev) {
            const d = n - perf.rafPrev;
            if (d > 1 && d < 100) {
              const b = Math.round(d * 2) / 2;
              perf.rafGaps[b] = (perf.rafGaps[b] || 0) + 1;
            }
          }
          perf.rafPrev = n;
        }
        if (!this._hotCapLifted(n) && n - (this._lastHotFrameT || 0) < this._frameCaps().hotMinMs) {
          this.canvasRaf = window.requestAnimationFrame(tick);
          return;
        }
        this._lastHotFrameT = n;
      } else if (perf) {
        perf.rafPrev = 0;
      }
      const tTick = perf ? performance.now() : 0;
      try {
        if (this.presentationActive() || !this.windowFocused()) {
          if (this.ctx && this.canvas && !this._suspendCleared) {
            this._clearCanvas();
            this._suspendCleared = true;
            this._dirtyPrev = null;
            this._drawSig = null;
          }
          this._canvasGear = "idle";
          this._idleWakeMs = 0;
          schedule();
          return;
        }
        this._suspendCleared = false;
        const view = this.app.workspace.activeEditor?.editor?.cm;
        this.ensureCanvasForView(view);
        if (view) this.registerWindowEvents(view.dom.ownerDocument);
        this._observeEditorLayout(view);
        if (this.canvasWrapper) {
          this.registerWindowEvents(this.canvasWrapper.ownerDocument);
        }
        const scrolledWrapper = !!this.canvasWrapper && !!view && this.canvasWrapper.classList.contains("cursor-smith-wrapper-scrolled") && this.canvasWrapper.parentElement === view.scrollDOM;
        if (this.canvasWrapper && this.canvas && scrolledWrapper && view) {
          const sc = view.scrollDOM;
          const sr = sc.getBoundingClientRect();
          const top = Math.round(sr.top - sc.scrollTop);
          const left = Math.round(sr.left - sc.scrollLeft);
          const width = Math.max(1, sc.scrollWidth);
          const height = Math.max(1, sc.scrollHeight);
          this._clipTop = Math.round(sr.top);
          const key = "scrolled|" + width + "," + height;
          if (key !== this._lastWrapperRect) {
            this._lastWrapperRect = key;
            this._dirtyFull = true;
            this.canvasWrapper.style.removeProperty("top");
            this.canvasWrapper.style.removeProperty("left");
            this.canvasWrapper.style.removeProperty("clip-path");
            this.canvasWrapper.style.width = width + "px";
            this.canvasWrapper.style.height = height + "px";
          }
          if (!this._wrapperPos || this._wrapperPos.left !== left || this._wrapperPos.top !== top) {
            this._wrapperPos = { left, top };
            this._canvasPlaced = false;
          }
          this._clipRect = { x: left, y: top, w: width, h: height };
        } else if (this.canvasWrapper && this.canvas) {
          const r = (view && view.hasFocus ? this.getPaneRect(view) : this.getCaretClipRect(this.canvas.ownerDocument)) || // Never 100vw/100vh here: a full-viewport layer over the
          // titlebar kills Electron's window-drag hit-testing on
          // Linux/Windows (drag regions compose in DOM order; z-index
          // and pointer-events are irrelevant to them).
          this.getFullViewportRect(this.canvas.ownerDocument);
          let top = Math.round(r.top);
          const left = Math.round(r.left);
          const width = Math.round(r.width);
          let height = Math.round(r.height);
          const ins = this._chromeInsets(this.canvas.ownerDocument);
          const coverTop = Math.max(top, Math.ceil(ins.coverTop));
          const coverBottom = Math.min(top + height, Math.floor(ins.coverBottom));
          if (coverTop > top || coverBottom < top + height) {
            top = coverTop;
            height = Math.max(0, coverBottom - coverTop);
          }
          this._clipTop = top;
          let clipPath = "";
          if (ins.bottomInset > 0) {
            const win = this.canvas.ownerDocument.defaultView || window;
            const cut = wrapperClipForStatusBar(
              { top, left, width, height },
              { top: win.innerHeight - ins.bottomInset, left: ins.statusLeft, right: ins.statusRight }
            );
            height = cut.height;
            clipPath = cut.clipPath;
          }
          const key = top + "," + left + "," + width + "," + height + "|" + clipPath;
          if (key !== this._lastWrapperRect) {
            this._lastWrapperRect = key;
            this._dirtyFull = true;
            this.canvasWrapper.style.top = top + "px";
            this.canvasWrapper.style.left = left + "px";
            this.canvasWrapper.style.width = width + "px";
            this.canvasWrapper.style.height = height + "px";
            this.canvasWrapper.style.clipPath = clipPath;
            this._wrapperPos = { left, top };
            this._clipRect = { x: left, y: top, w: width, h: height };
            this._canvasPlaced = false;
          }
        }
        const _vimMode = this.currentVimMode();
        if (_vimMode !== this._appliedVimMode) {
          this._appliedVimMode = _vimMode;
          this.onVimModeChanged();
        }
        {
          this._tickNo = (this._tickNo || 0) + 1;
          const flagsAtFrame = {
            del: this._deletePending,
            enter: this._enterPending,
            pop: this._popKeyPending
          };
          this.rematchCaretStates(view);
          const tCaret = perf ? performance.now() : 0;
          this.updateActivePoint();
          if (perf) perf.caretMs += performance.now() - tCaret;
          this.updateSmoothCursor();
          this.updateSecondaryCarets(view, flagsAtFrame);
          this.bracketTether = this.mergeTethers(
            this.look.bracketTether ? this.bracketTetherCoords(view) : null
          );
          this.updateSmearQuad();
          this.pruneTrail();
          if (this.heat > 0) {
            this.heat *= 0.985;
            if (this.heat < 1e-3) this.heat = 0;
          }
          if (this.look.speedDemon && this.look.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) {
            this.maybeSpawnHotHead();
          }
          this.maybeSpawnStardust();
          const nowT = performance.now();
          const g = this._decideGear(nowT, !!perf);
          this._canvasGear = g.gear;
          this._idleWakeMs = g.idleWake;
          if (perf) perf.why[g.why] = (perf.why[g.why] || 0) + 1;
          let doDraw = true;
          if (g.staticFrame) {
            const sig = this._frameSignature(_vimMode, g.blinkBucket);
            if (sig === this._drawSig) doDraw = false;
            else this._drawSig = sig;
          } else {
            this._drawSig = null;
          }
          if (this._dirtyFull) doDraw = true;
          if (this._fitCanvasRegion()) {
            doDraw = true;
            if (perf) perf.reanchors++;
          }
          if (doDraw && this._canvasRect) {
            const tDraw = perf ? performance.now() : 0;
            this.draw();
            if (perf) {
              perf.draws++;
              perf.drawMs += performance.now() - tDraw;
            }
          }
        }
      } catch (e) {
        this._reportOnce("canvas tick (loop kept alive)", e);
      }
      if (perf) {
        perf.ticks++;
        perf.tickMs += performance.now() - tTick;
        const g = this._canvasGear || "hot";
        perf.gears[g] = (perf.gears[g] || 0) + 1;
      }
      schedule();
    };
    this._canvasTick = tick;
    this._canvasGear = "hot";
    this._idleWakeMs = 0;
    this._lastTickT = performance.now();
    this.canvasRaf = window.requestAnimationFrame(tick);
  },
  // (Re)allocate the backing store for the current canvas region. This used
  // to size the canvas to the window; it now sizes it to this._canvasRect,
  // the caret's neighbourhood chosen by _fitCanvasRegion (issue #30). Drawing
  // stays in absolute client coordinates: the context transform subtracts
  // the region's origin, so nothing that paints had to change.
  resizeCanvas() {
    if (!this.canvas || !this.ctx) return;
    const r = this._canvasRect;
    if (!r) return;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    this._canvasDpr = dpr;
    this.canvas.style.width = r.w + "px";
    this.canvas.style.height = r.h + "px";
    this.canvas.width = Math.max(1, Math.round(r.w * dpr));
    this.canvas.height = Math.max(1, Math.round(r.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, -r.x * dpr, -r.y * dpr);
    this._placeCanvas();
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyFull = false;
    this._caretStyleCache = null;
  },
  // Position the canvas element inside the wrapper so that the region's
  // origin lands at its own client coordinates. transform: none when the
  // region sits at the wrapper's corner avoids promoting the canvas to a
  // separate compositor layer for nothing.
  _placeCanvas() {
    const r = this._canvasRect;
    if (!this.canvas || !r) return;
    const wp = this._wrapperPos || { left: 0, top: 0 };
    const dx = r.x - wp.left;
    const dy = r.y - wp.top;
    this.canvas.style.transform = dx === 0 && dy === 0 ? "none" : `translate(${dx}px, ${dy}px)`;
    this._canvasPlaced = true;
  },
  // Blank the whole surface, whatever region it covers. Bypasses the region
  // transform so it needs no coordinates at all.
  _clearCanvas() {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyRaw = null;
  },
  // The bounding box of everything this frame has to be able to paint, in
  // client coordinates, or null when there is nothing. Runs after the update
  // phase, so it sees every pool a spawn just filled.
  //
  // Three sources. The cursor's own damage bounds (the same helper draw()
  // marks dirty from, so the two cannot disagree), plus the smooth-movement
  // target so the region grows toward where the caret is heading rather than
  // chasing it. The secondaries and the tether, whose positions are known
  // before the draw. And last frame's UNCLAMPED painted union, padded for
  // motion: particles, embers, motes, trail ghosts and glitch slices were all
  // painted somewhere last frame and will be near there this frame. That
  // union is recorded from _markDirty whether or not the canvas actually
  // showed the pixels, which is what lets anything that outruns the pad
  // reappear one frame later instead of staying lost.
  //
  // Two effects are exempt from all that and claim the whole clip window for
  // as long as they are live: a thunderbolt starts above the pane on purpose
  // (see spawnThunderbolt) and a firework shell climbs out of any region
  // fitted round the caret. Both are rare and short.
  _frameNeed(clip) {
    if (this.thunderbolts && this.thunderbolts.length || this.fireworks && this.fireworks.length) {
      return { x0: clip.x, y0: clip.y, x1: clip.x + clip.w, y1: clip.y + clip.h };
    }
    let b = null;
    const add = (x0, y0, x1, y1) => {
      if (!b) {
        b = { x0, y0, x1, y1 };
        return;
      }
      if (x0 < b.x0) b.x0 = x0;
      if (y0 < b.y0) b.y0 = y0;
      if (x1 > b.x1) b.x1 = x1;
      if (y1 > b.y1) b.y1 = y1;
    };
    const cb = this._cursorBounds();
    if (cb) add(cb.x0, cb.y0, cb.x1, cb.y1);
    const la = this.lastActive;
    if (la && this.animActive && la !== this.animActive) {
      const pad = 24;
      add(
        la.x - pad,
        la.top - pad,
        la.x + Math.max(la.w || 0, la.actualCharWidth || 0) + pad,
        la.top + (la.h || 0) + pad
      );
    }
    if (this.secondaryCarets && this.secondaryCarets.length) {
      for (const c of this.secondaryCarets) add(c.x - 4, c.top - 4, c.x + 8, c.bottom + 4);
    }
    if (this._secondaries && this._secondaries.length) {
      for (const st of this._secondaries) {
        if (!st.animActive) continue;
        const sb = this._withCaret(st, () => this._cursorBounds());
        if (sb) add(sb.x0, sb.y0, sb.x1, sb.y1);
        const sl = st.lastActive;
        if (sl && sl !== st.animActive) {
          add(
            sl.x - 24,
            sl.top - 24,
            sl.x + Math.max(sl.w || 0, sl.actualCharWidth || 0) + 24,
            sl.top + (sl.h || 0) + 24
          );
        }
      }
    }
    if (this.bracketTether && this.bracketTether.length) {
      for (const s of this.bracketTether) {
        add(
          Math.min(s.x1, s.x2) - 4,
          Math.min(s.y1, s.y2) - 4,
          Math.max(s.x1, s.x2) + 4,
          Math.max(s.y1, s.y2) + 4
        );
      }
    }
    const r = this._dirtyRaw;
    if (r) {
      const p = CANVAS_REGION_MOTION_PAD;
      add(r.x0 - p, r.y0 - p, r.x1 + p, r.y1 + p);
    }
    return b;
  },
  // Decide the canvas region for this frame and apply it. Returns true when
  // the surface was re-anchored (and is therefore blank), so the caller
  // knows the frame must be painted whatever the static-frame test said.
  //
  // Movement without growth keeps the backing store and only moves the
  // element (a transform write); growth or a DPR change reallocates it.
  // Either way the surface is blank afterwards, which is fine: draw() paints
  // every live thing from state each frame, it never relies on last frame's
  // pixels beyond knowing where to clear them.
  _fitCanvasRegion() {
    if (!this.canvas || !this.ctx) return false;
    const clip = this._clipRect;
    if (!clip) return false;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    let cur = this._canvasRect;
    if (cur && (cur.x < clip.x || cur.y < clip.y || cur.x + cur.w > clip.x + clip.w || cur.y + cur.h > clip.y + clip.h)) {
      cur = null;
    }
    const need = this._frameNeed(clip);
    const lh = this.animActive && this.animActive.h || this.lastActive && this.lastActive.h || 24;
    const marginY = Math.round(CANVAS_REGION_MARGIN_Y * lh);
    const now = performance.now();
    let allowShrink = false;
    if (cur && need) {
      const nw = Math.min(clip.w, need.x1 - need.x0 + 2 * CANVAS_REGION_MARGIN_X);
      const nh = Math.min(clip.h, need.y1 - need.y0 + 2 * marginY);
      if (cur.w * cur.h > CANVAS_REGION_SHRINK_RATIO * Math.max(1, nw) * Math.max(1, nh)) {
        if (!this._regionOversizedT) this._regionOversizedT = now;
        else if (now - this._regionOversizedT > CANVAS_REGION_SHRINK_MS) allowShrink = true;
      } else {
        this._regionOversizedT = 0;
      }
    } else {
      this._regionOversizedT = 0;
    }
    const next = fitCanvasRegion(need, clip, cur, {
      marginX: CANVAS_REGION_MARGIN_X,
      marginY,
      grid: CANVAS_REGION_GRID,
      allowShrink
    });
    if (next === cur && cur === this._canvasRect && dpr === this._canvasDpr) {
      if (!this._canvasPlaced) this._placeCanvas();
      return false;
    }
    if (!next) {
      if (this._canvasRect) this._clearCanvas();
      this._canvasRect = null;
      return false;
    }
    if (allowShrink && next !== cur) this._regionOversizedT = 0;
    const prev = this._canvasRect;
    this._canvasRect = next;
    if (!prev || next.w !== prev.w || next.h !== prev.h || dpr !== this._canvasDpr) {
      this.resizeCanvas();
    } else {
      this.ctx.setTransform(dpr, 0, 0, dpr, -next.x * dpr, -next.y * dpr);
      this._placeCanvas();
      this._clearCanvas();
    }
    this._dirtyFull = false;
    this._dirtyPrev = null;
    return true;
  },
  // The render loops' frame intervals for the current Low Power setting.
  // Global, not a look: read off this.settings directly, which a per-Vim-mode
  // swap leaves untouched because no mode snapshot carries the key.
  // Whether the hot gear's frame cap is off for the frame at `n`. The cap
  // skips every other frame on a 120 Hz screen (every second or third in
  // Low Power) while the text moves on every one, so a caret that moves
  // with the text trails it on half the frames:
  //
  //   - a scroll (SCROLL_LOCK_MS after the scroller's own scroll or wheel
  //     event, on its own stamp - the activity kind is overwritten by every
  //     touch or pointer move between two scroll events): the wobble;
  //   - typing (1.6.4), outside Low Power: while the drawn caret glides or
  //     its smear moves, and SCROLL_LOCK_MS after a key, so the frame that
  //     shows the new text shows the caret beside it. "The whole cursor is
  //     laggy when typing fast" on a 120 Hz laptop: the plugin ran 60 ticks
  //     a second while the screen ran 120 (measured, 2026-09-24). Low Power
  //     keeps its cap there - it is the switch for trading this away.
  _hotCapLifted(n) {
    if (n - (this._lastScrollT || 0) < SCROLL_LOCK_MS) return true;
    if (this.settings && this.settings.lowPowerMode) return false;
    return !!(this._smoothMoving || this._smearMoving) || n - (this._realKeyT || 0) < SCROLL_LOCK_MS;
  },
  _frameCaps() {
    return this.settings && this.settings.lowPowerMode ? FRAME_CAPS.lowPower : FRAME_CAPS.normal;
  },
  // ---- Damage tracking ---------------------------------------------------
  // The canvas spans the whole viewport at devicePixelRatio, so on a Retina
  // display it is several million pixels - while the cursor and its effects
  // touch a few thousand. Clearing the entire surface each frame was the
  // dominant GPU cost as soon as anything forced continuous repaints (typing,
  // or the energy shimmer): a full-surface clear plus a full-surface composite
  // 30-60 times a second, to change a caret-sized region.
  //
  // So each primitive reports the box it painted and the next frame clears
  // exactly the union of what the last one touched. Nothing is predicted in
  // advance, so this cannot drift out of sync with the drawing code - but a
  // primitive that paints WITHOUT calling _markDirty will leave ghost pixels
  // behind. If you add an effect, mark its bounds, generously: over-reporting
  // only costs fill rate, under-reporting corrupts the frame.
  // ---------------------------------------------------------------------------
  // "Is anything actually in motion this frame?" - the frame governor's hot-gear
  // test, and the fourth of the six touchpoints for adding an effect.
  //
  // Extracted from the canvas tick so it can be TESTED. Missing an entry here is
  // the one effect-authoring mistake that is both silent and user-visible: the
  // loop judges the frame static, drops to its idle heartbeat, and the
  // effect freezes mid-animation whenever nothing else happens to be moving. It
  // was previously guarded by a comment alone while every other effect invariant
  // in this file had coverage. See test.js, "frame governor".
  //
  // MUST STAY A PURE READ. The gear decision runs before draw(), and anything
  // that retires state here (glitchState() would - it drops an expired burst as
  // a side effect) would retire it before the frame that should have painted it.
  // ---------------------------------------------------------------------------
  _isAnimating(nowT) {
    const crt = !!this.look.crtEffect;
    return !!this._smoothMoving || !!this.pending || crt && this.trail && this.trail.length > 0 || this.particles && this.particles.length > 0 || // flamePixels are aged inside draw(), so a skipped frame would
    // freeze a burst mid-flight rather than letting it expire.
    this.flamePixels && this.flamePixels.length > 0 || // Same again for Hot-head's fire, aged in its own draw call.
    this.flameEmbers && this.flameEmbers.length > 0 || // ...and the effect itself, not just its live particles. While
    // Hot-head is on the fire is continuously animating by definition,
    // and the particle test alone has a hole in it: the instant the
    // pool empties the loop would judge the frame static, drop to the
    // idle heartbeat, and the next spawn would arrive as one
    // lumpy burst instead of a steady flame.
    !!this.styleFor("hotHead") && !!this.animActive && this.hotHeadFeeding(nowT) || // Same reasoning: a bolt is aged and expired inside its draw call,
    // so a skipped frame would leave one frozen on screen.
    this.thunderbolts && this.thunderbolts.length > 0 || // And again for a firework. Note this covers a shell still sitting
    // out its stagger delay, which paints nothing yet but must not be
    // allowed to drop the loop into the idle heartbeat - the volley
    // would land in lumps a tenth of a second apart.
    this.fireworks && this.fireworks.length > 0 || // A Signal Glitch burst is a ~200ms wall-clock animation, so it
    // needs continuous frames for its whole life. Tested inline rather
    // than via glitchState() because that RETIRES an expired burst as a
    // side effect, and the gear decision must stay a pure read - the
    // draw call below is what should do the retiring.
    !!this.glitch && nowT - this.glitch.start < this.glitch.dur || this.heat > 0 || // Every full-effect secondary carries the same motion fields (see
    // CARET_STATE_FIELDS), and a settling spring or a live trail on any of
    // them needs frames exactly as the primary's does. A pure read of the
    // bundles, nothing swapped in.
    this._secondaries && this._secondaries.some((c) => !!c._smoothMoving || !!c.pending || !!c._smearMoving || crt && c.trail && c.trail.length > 0 || !!c.glitch && nowT - c.glitch.start < c.glitch.dur || // Hot-head feeding on a secondary, same test as the primary's above.
    !!this.styleFor("hotHead") && !!c.animActive && this._hotFeedingAt(c._hotActiveT, nowT)) || // Precise: the spring reports whether any corner is still off its
    // target or carrying velocity. This used to be a 1200ms window
    // after the last motion, which was a workaround for a timestamp
    // that was being restamped every frame and so never expired. Now
    // that the spring snaps exactly onto its targets when it settles,
    // it cannot flap back and forth, so the grace period is dead
    // weight - it just held the hot gear for an extra 1.2s after every
    // smear finished.
    !!this._smearMoving;
  },
  // The gear for this frame and what decided it; the tick applies the
  // result. Pure reads. `why` is the first reason that held, for the
  // report's "awake because", built only when a report is running.
  //
  // Gears: anything genuinely in motion (_isAnimating) or an input within
  // INPUT_HOT_MS is hot; a blink fade or armed stardust is warm; the energy
  // shimmer alone is its own slow gear - it is driven by wall clock and has
  // to keep repainting, but at ~1.7 s a cycle 20 fps is fifty samples and
  // looks identical to sixty; otherwise idle. Stardust deliberately never
  // claims hot: it runs *because* nothing is happening, and a slow drift is
  // smooth at the warm gear; `armed` rather than "motes alive" keeps the
  // loop warm through the gaps between emissions, where the idle heartbeat
  // would make the spawn cadence stutter. The blink's window is phase-based
  // (blinkWindow), so the warm gear covers a fade from its first frame.
  _decideGear(nowT, wantWhy) {
    const eff = this.look;
    const animating = this._isAnimating(nowT);
    const energyShimmer = !!eff.energyEffect && !!this.lastActive;
    const recentInput = nowT - (this._lastActivityT || 0) < INPUT_HOT_MS;
    let blinkFading = false;
    let blinkBucket = 1;
    let idleWake = Infinity;
    if (eff.blinkingEnabled && this.lastActive) {
      const a = this.blinkPhase(nowT);
      blinkBucket = a >= 0.5 ? 1 : 0;
      const w = this.blinkWindow(nowT);
      blinkFading = w.fading;
      idleWake = w.msToNext;
    }
    const stardustLive = this.stardust.length > 0;
    const stardustActive = stardustLive || this.stardustArmed();
    const gear = animating || recentInput ? "hot" : blinkFading || stardustActive ? "warm" : energyShimmer ? "energy" : "idle";
    const staticFrame = !animating && !blinkFading && !energyShimmer && !stardustLive;
    let why = "";
    if (wantWhy) {
      why = this._smoothMoving ? "glide" : this.pending ? "pending move" : eff.crtEffect && this.trail && this.trail.length > 0 ? "trail" : this.particles && this.particles.length > 0 ? "particles" : this.flamePixels && this.flamePixels.length > 0 || this.flameEmbers && this.flameEmbers.length > 0 ? "pixels" : this.thunderbolts && this.thunderbolts.length > 0 || this.fireworks && this.fireworks.length > 0 ? "pops" : this.glitch && nowT - this.glitch.start < this.glitch.dur ? "glitch" : this.heat > 0 ? "heat" : this._smearMoving ? "smear" : !!this.styleFor("hotHead") && !!this.animActive && this.hotHeadFeeding(nowT) ? "fire" : animating ? "secondaries" : recentInput ? "input:" + (this._lastActivityKind || "?") : blinkFading ? "blink" : stardustActive ? "stardust" : energyShimmer ? "energy" : "idle";
    }
    return { gear, staticFrame, blinkBucket, idleWake, why };
  },
  // What a static frame would paint, as a string; when it matches the last
  // frame's the draw is skipped. The look's part is ONE number, the look
  // generation (_lookGen: bumped by saveSettings, a preset, the
  // reduced-motion query flipping - every path that changes what
  // this.look answers), instead of a list of every look key that reaches a
  // pixel. That list was kept by hand, and eight of its entries were bug
  // fixes: a toggle that "did nothing until the next keystroke" because the
  // key was missing here. The rest is what changes without a setting: the
  // Vim mode (its own look), the blink's half, the theme, the caret's place,
  // shape and glyph to the half-pixel, the plain secondaries, the tether,
  // the full secondaries and the smear quad (a spring with its own state;
  // it keeps deforming after the caret has stopped, and without it here a
  // settled frame stranded a stretched ghost on screen).
  _frameSignature(vimMode, blinkBucket) {
    const la = this.lastActive;
    const isDark = this.canvas ? this.canvas.ownerDocument.body.classList.contains("theme-dark") : true;
    const sec = this.secondaryCarets && this.secondaryCarets.length ? this.secondaryCarets.map((c) => (c.x | 0) + ":" + (c.top | 0) + ":" + (c.bottom | 0)).join(",") : "";
    const bt = this.bracketTether && this.bracketTether.length ? this.bracketTether.map((s) => (s.x1 | 0) + ":" + (s.y1 | 0) + ":" + (s.x2 | 0) + ":" + (s.y2 | 0)).join(",") : "";
    return [
      vimMode,
      this._lookGen | 0,
      blinkBucket,
      isDark,
      la ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," + Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "") : "none",
      sec,
      bt,
      this._secondariesSig(),
      this._smearSig()
    ].join("|");
  },
  _markDirty(x, y, w, h) {
    const d = this._dirty;
    if (!d) {
      this._dirty = { x0: x, y0: y, x1: x + w, y1: y + h };
      return;
    }
    if (x < d.x0) d.x0 = x;
    if (y < d.y0) d.y0 = y;
    if (x + w > d.x1) d.x1 = x + w;
    if (y + h > d.y1) d.y1 = y + h;
  },
  forEachTrailPoint(cb) {
    if (!this.look.crtEffect) return;
    const now = performance.now();
    const fade = Math.max(50, this.look.trailFadeMs);
    for (const p of this.trail) {
      const age = (now - p.t) / fade;
      const alpha = Math.max(0, 1 - age) * 0.55;
      if (alpha > 0.02) {
        const pad = this.look.crtNeon ? 22 : 14;
        this._markDirty(p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2);
        cb(p, alpha, Math.max(0, Math.min(1, age)));
      }
    }
  },
  // =========================================================================
  // Frame governor — power management for the render loops
  // =========================================================================
  // Both render loops used to run requestAnimationFrame unconditionally: the
  // full DOM-read + clear + redraw pipeline executed at display refresh rate
  // (120fps on ProMotion Macs) even while the cursor sat perfectly still.
  // That measured ~20% CPU/GPU at idle on Apple Silicon. The governor gives
  // each loop three gears:
  //   hot  — continuous rAF (capped near 60fps on high-refresh displays),
  //          while input is recent or any animation is genuinely in flight
  //   warm — ~30fps, only while a blink fade is mid-transition
  //   idle — a 200 ms heartbeat (or the blink's next fade, if sooner) that
  //          re-checks state and repaints ONLY if the
  //          picture changed; with a static, non-fading cursor the canvas
  //          isn't touched at all, so idle cost approaches zero
  // Input events snap the loops back to hot instantly (the pending idle
  // timeout is cancelled and a frame is requested immediately), so the
  // scheduling can never add perceptible input latency.
  // Called from input events. Timestamps the activity and wakes any dozing
  // loop right now instead of letting it sleep out its timeout.
  // Anything that can move the caret on screen bumps this; the geometry
  // caches (cmCaretCoords, getPaneRect, the secondaries') are keyed on it.
  // Layout may have moved the caret: drop the geometry caches and have the
  // loop look now rather than on the heartbeat. Cheap when it finds nothing
  // (one tick, a signature that matches, no draw), and it is what lets a
  // sidebar animating shut, or a slider dragged in the settings window
  // (saveSettings calls this), move the caret on the next frame instead of
  // up to a heartbeat later.
  _invalidateLayout() {
    this._layoutGen = (this._layoutGen | 0) + 1;
    this._wakeLoop();
  },
  // The caret's computed style may have changed under it - css-change, a
  // layout change, a resize (which is also how a zoom arrives). The style
  // cache in cmCaretCoords is keyed on this generation. Kept apart from the
  // layout generation, which every scroll and keystroke bumps: a scroll
  // moves the caret, it does not change the font under it, and re-reading
  // computed styles and hit-testing the line on every scroll event was the
  // alternative.
  _invalidateStyle() {
    this._styleGen = (this._styleGen | 0) + 1;
    this._invalidateLayout();
  },
  // A dozing loop (warm, energy or idle: parked on a timeout) is put on the
  // next frame. A hot loop is already on requestAnimationFrame and needs
  // nothing, and a tick in progress has no timeout to cancel.
  _wakeLoop() {
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
      if (this.canvasEngineActive && this._canvasTick) {
        this.canvasRaf = window.requestAnimationFrame(this._canvasTick);
      }
    }
  },
  // The frame loop's watchdog, on an interval from onload. The plugin hides
  // Obsidian's caret and draws its own, so a loop that stops - a frame that
  // threw before it rescheduled, an animation frame that never came back -
  // leaves the editor with no caret at all, the worst thing this plugin can
  // do. A parked loop still ticks at the idle heartbeat, so a visible
  // document with no tick for WATCHDOG_STALE_MS is a dead loop: it is
  // restarted (enable), the console says so, and on the second stall the
  // native caret is handed back (hideNativeActive reads _watchdogGaveUp)
  // until the plugin is next enabled by hand. Not a stall: a hidden
  // document (no animation frames by design), or an interval that was
  // itself late by as much - the main thread was blocked, and the loop
  // never had a chance. Trips are forgotten after a healthy minute.
  _watchdog(now) {
    const lastRun = this._watchdogLastT || now;
    this._watchdogLastT = now;
    if (!this.canvasEngineActive) return;
    const doc = this.canvas && this.canvas.ownerDocument || document;
    if (doc.visibilityState === "hidden" || now - lastRun > WATCHDOG_INTERVAL_MS * 1.5) {
      this._lastTickT = now;
      return;
    }
    const silent = now - (this._lastTickT || now);
    if (silent < WATCHDOG_STALE_MS) {
      if (this._watchdogTrips && now - (this._watchdogTripT || 0) > 6e4) this._watchdogTrips = 0;
      return;
    }
    this._watchdogTrips = (this._watchdogTrips | 0) + 1;
    this._watchdogTripT = now;
    this._reportOnce("watchdog, stall " + this._watchdogTrips, new Error(`no frame for ${Math.round(silent)} ms: restarting the loop`));
    try {
      this.enable();
    } catch (e) {
      this._reportOnce("watchdog restart", e);
    }
    if (this._watchdogTrips >= 2) {
      this._watchdogGaveUp = true;
      try {
        this.applyBodyClasses();
      } catch (e) {
        this._reportOnce("watchdog body classes", e);
      }
    }
  },
  _markActivity(kind = "") {
    this._lastActivityT = performance.now();
    if (kind) this._lastActivityKind = kind;
    this._invalidateLayout();
    this._wakeTorch();
  },
  // A ResizeObserver on the active editor's content and scroller: an embed
  // or image finishing its load, a line wrapping differently after a font
  // loads - anything that changes the content's size moves the caret without
  // an input event, and bumps the layout generation here. Re-pointed when
  // the active editor changes; disconnected on unload.
  //
  // And a MutationObserver on the content, for what changes the line under
  // the caret without changing its size: Live Preview reveals a heading's
  // "# " a beat after a click lands in it (a second transaction on mouseup,
  // some 60 ms later - an arrow key reveals it in the same frame) and the
  // text shifts right by the markup's width. Same document, same selection,
  // so no event the plugin listens to fires, and the geometry cache in
  // cmCaretCoords kept the pre-reveal spot for its whole TTL: the caret
  // landed short of the end and hopped 400 ms later. A change in the
  // content DOM bumps the layout generation and wakes a frame, and the
  // next measurement reads the revealed line. The callback writes nothing
  // it watches (the canvas is never inside the content).
  _observeEditorLayout(view) {
    if (this._roView === view) return;
    try {
      this._ro?.disconnect();
      this._mo?.disconnect();
    } catch {
    }
    this._ro = null;
    this._mo = null;
    this._roView = view || null;
    if (!view) return;
    if (typeof ResizeObserver !== "undefined") {
      try {
        this._ro = new ResizeObserver(() => this._invalidateLayout());
        if (view.contentDOM) this._ro.observe(view.contentDOM, { box: "border-box" });
        if (view.scrollDOM) this._ro.observe(view.scrollDOM, { box: "border-box" });
      } catch {
        this._ro = null;
      }
    }
    if (typeof MutationObserver !== "undefined" && view.contentDOM) {
      try {
        this._mo = new MutationObserver(() => this._invalidateLayout());
        this._mo.observe(view.contentDOM, { childList: true, subtree: true, characterData: true });
      } catch (e) {
        this._mo = null;
        this._reportOnce("content observer", e);
      }
    }
    this._invalidateLayout();
  },
  // Whether a scroll or wheel event on `target` can move the caret: the
  // document itself (a window scroll), the active editor's scroller or an
  // ancestor of it, or any element containing the focused field. Everything
  // else scrolls something the caret is not in. See registerWindowEvents.
  _scrollMovesCaret(target, doc) {
    if (!target) return true;
    if (target === doc || target === (doc && doc.documentElement) || target === (doc && doc.defaultView)) return true;
    const node = target;
    const contains = node && typeof node.contains === "function" ? (el) => !!el && node.contains(el) : () => false;
    let scroller = null;
    try {
      scroller = this.app.workspace.activeEditor?.editor?.cm?.scrollDOM || null;
    } catch {
      scroller = null;
    }
    if (scroller && (target === scroller || contains(scroller) || typeof scroller.contains === "function" && scroller.contains(node))) return true;
    const active = doc && doc.activeElement;
    if (active && active !== doc.body && contains(active)) return true;
    return false;
  },
  // Whether the document's selection is somewhere else than when this last
  // answered. Android's WebView, and CodeMirror re-syncing the DOM selection
  // to its own, fire selectionchange with the caret exactly where it was;
  // each used to buy INPUT_HOT_MS of the hot gear. Compared, not stamped:
  // the editor's selection (its document, anchor, head, assoc and range
  // count) while the editor has focus, a field's own selection when a field
  // does, the DOM selection's two ends otherwise. When in doubt (a probe
  // throws), the answer is yes.
  _selectionMoved(doc) {
    let sig;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (view && view.hasFocus && view.dom.ownerDocument === doc) {
        const sel = view.state.selection;
        const m = sel.main;
        sig = { a: view.state.doc, b: null, n: m.anchor, h: m.head, o: m.assoc || 0, k: sel.ranges.length };
      } else {
        const el = doc.activeElement;
        const start = el ? el.selectionStart : null;
        if (el && typeof start === "number") {
          sig = { a: el, b: null, n: start, h: el.selectionEnd ?? start, o: 0, k: 1 };
        } else {
          const s = doc.getSelection();
          sig = s ? { a: s.anchorNode, b: s.focusNode, n: s.anchorOffset, h: s.focusOffset, o: 0, k: s.rangeCount } : { a: null, b: null, n: -1, h: -1, o: 0, k: 0 };
        }
      }
    } catch {
      this._selSig = null;
      return true;
    }
    const prev = this._selSig;
    this._selSig = sig;
    if (!prev) return true;
    return prev.a !== sig.a || prev.b !== sig.b || prev.n !== sig.n || prev.h !== sig.h || prev.o !== sig.o || prev.k !== sig.k;
  },
  // Count what the loop does for `seconds`, then put a report on the
  // clipboard (and in the console). The counters live on this._perf and
  // the tick adds to them only while that is set; see the tick.
  performanceReport(seconds = 10) {
    if (this._perf) {
      new Notice("Cursor-Smith: a performance report is already running.");
      return;
    }
    const perf = this._perf = this._freshPerf();
    let po = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          perf.longTasks++;
          perf.longTaskMs += e.duration;
        }
      });
      po.observe({ entryTypes: ["longtask"] });
    } catch {
      po = null;
    }
    const onKey = () => {
      perf.keys++;
    };
    const doc = this.canvas && this.canvas.ownerDocument || document;
    doc.addEventListener("keydown", onKey, true);
    new Notice(`Cursor-Smith: measuring for ${seconds} seconds - keep browsing as you normally would.`);
    window.setTimeout(() => {
      this._perf = null;
      if (po) {
        try {
          po.disconnect();
        } catch {
        }
      }
      doc.removeEventListener("keydown", onKey, true);
      const text = this.perfReportText(perf, seconds);
      const clip = typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"));
      clip.then(
        () => new Notice("Cursor-Smith: report copied to the clipboard."),
        () => {
          console.warn(text);
          new Notice("Cursor-Smith: report is in the developer console (Ctrl+Shift+I).");
        }
      );
    }, seconds * 1e3);
  },
  _freshPerf() {
    return {
      t0: performance.now(),
      ticks: 0,
      draws: 0,
      gears: {},
      tickMs: 0,
      caretMs: 0,
      drawMs: 0,
      reanchors: 0,
      longTasks: 0,
      longTaskMs: 0,
      rafGaps: {},
      rafPrev: 0,
      keys: 0,
      why: {}
    };
  },
  // The report's text. Pure apart from reading the environment, so the
  // shape can be tested with a synthetic counter object. Everything in it is
  // either a number the tick counted or a fact about the machine and the
  // configuration; nothing that identifies the vault or its contents.
  perfReportText(perf, seconds) {
    const s = this.settings || {};
    const secs = Math.max(1e-3, seconds);
    const gearTotal = Object.values(perf.gears).reduce((a, b) => a + b, 0) || 1;
    const gears = Object.entries(perf.gears).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${Math.round(100 * n / gearTotal)}%`).join(", ") || "none";
    const whyTotal = Object.values(perf.why || {}).reduce((a, b) => a + b, 0) || 1;
    const why = Object.entries(perf.why || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, n]) => `${w} ${Math.round(100 * n / whyTotal)}%`).join(", ") || "none";
    const on = [];
    for (const k of [
      "gradientEnabled",
      "crtEffect",
      "glow",
      "crtNeon",
      "crtGlitch",
      "cursorTranslucent",
      "cursorRounded",
      "blinkingEnabled",
      "smear",
      "smoothEnabled",
      "energyEffect",
      "popEffects",
      "popLetters",
      "flameTrail",
      "fireworks",
      "thunderstrike",
      "backspaceDisintegrate",
      "hotHead",
      "stardustEnabled",
      "speedDemon",
      "bracketTether",
      "torchEffect",
      "vimModeEnabled"
    ]) {
      if (s[k]) on.push(k);
    }
    let gpu = "unknown";
    try {
      const c = createEl("canvas");
      const gl = c.getContext("webgl");
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : gl ? "webgl, no renderer info" : "no webgl";
    } catch {
    }
    let code = "";
    try {
      code = presetToCode("report", s);
    } catch {
      code = "(unavailable)";
    }
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const win = typeof window !== "undefined" ? window : {};
    const clip = this._clipRect;
    const region = this._canvasRect;
    const app = this.app || {};
    const themeName = app.customCss && (app.customCss.theme || app.customCss.currentTheme) || "default";
    const snippets = app.customCss && app.customCss.enabledSnippets ? app.customCss.enabledSnippets.size : 0;
    const plugins = app.plugins && app.plugins.enabledPlugins ? app.plugins.enabledPlugins.size : 0;
    let gap = 0, gapN = 0;
    for (const [g, n] of Object.entries(perf.rafGaps || {})) {
      if (n > gapN) {
        gapN = n;
        gap = Number(g);
      }
    }
    const hz = gap > 0 ? Math.round(1e3 / gap) : null;
    const lines = [
      `Cursor-Smith performance report (${this.manifest && this.manifest.version || "?"}), ${secs.toFixed(0)}s`,
      `environment: ${nav.userAgent || "?"}`,
      `platform ${nav.platform || "?"}; window ${win.innerWidth || "?"}x${win.innerHeight || "?"} @${win.devicePixelRatio || "?"}x; display ~${hz ? hz + "Hz" : "unmeasured (no hot frames)"}`,
      `gpu: ${gpu}`,
      `theme: ${themeName}; snippets on: ${snippets}; plugins on: ${plugins}`,
      `pane: ${clip ? clip.w + "x" + clip.h : "none"}; canvas region now: ${region ? region.w + "x" + region.h : "none"}`,
      `settings: style ${s.cursorStyle || "?"}; low power ${s.lowPowerMode ? "on" : "off"}; hide when unfocused ${s.hideOnWindowBlur === false ? "off" : "on"}; note editor only ${s.siteMode === "all" ? "all sites" : s.siteMode + ": " + ((s.siteList || []).length + " patterns")}; reduced motion ${this.reducedMotion && this.reducedMotion() ? "ACTIVE" : "no"}`,
      `effects on: ${on.join(", ") || "none"}`,
      `share code: ${code}`,
      `loop: ${perf.ticks} ticks (${(perf.ticks / secs).toFixed(1)}/s), ${perf.draws} draws (${(perf.draws / secs).toFixed(1)}/s), gears ${gears}, ${perf.reanchors} canvas re-anchors, ${perf.keys} keystrokes`,
      `awake because: ${why}`,
      `cost per frame: tick ${perf.ticks ? (perf.tickMs / perf.ticks).toFixed(2) : "0"}ms (caret measure ${perf.ticks ? (perf.caretMs / perf.ticks).toFixed(2) : "0"}ms), draw ${perf.draws ? (perf.drawMs / perf.draws).toFixed(2) : "0"}ms; plugin main-thread total ${perf.tickMs.toFixed(0)}ms of ${(secs * 1e3).toFixed(0)}ms (${(100 * perf.tickMs / (secs * 1e3)).toFixed(1)}%)`,
      `long tasks (anything over 50ms, any source): ${perf.longTasks}, ${perf.longTaskMs.toFixed(0)}ms total`
    ];
    return lines.join("\n");
  }
};

// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { hexToRgb } from "../color.js";
import { torchFlickerScale } from "../motion.js";
import { VIM_MODE_KEYS } from "../settings.js";
import { paintTorchDarkness, paintTorchGlow, torchCanvasContext } from "./paint.js";
import { prepareDocument } from "../shim/dom.js";

export var regionsKey = (regions) => regions ? regions.map((b) => Math.round(b.left) + "," + Math.round(b.top) + "," + Math.round(b.width) + "," + Math.round(b.height)).join(";") : "";
export var torchMethods = {
  // Whether the torch overlay engine might be needed: either the global cursor
  // uses it, or Vim cursors are on and some mode uses it. The torch tick then
  // shows/hides + restyles the overlay per the effective (per-mode) settings.
  torchPossible() {
    if (this.settings.torchEffect) return true;
    if (this.settings.vimModeEnabled && this.settings.vimModes) {
      for (const m of VIM_MODE_KEYS) {
        if (this.settings.vimModes[m] && this.settings.vimModes[m].torchEffect) return true;
      }
    }
    return false;
  },
  // The torch's look - darkness, colour, radius - is painted by the torch
  // tick from the effective settings every frame it changes (see
  // _torchPaintDarkness / _torchPaintGlow), so a settings change has nothing
  // to apply to the elements themselves. Kept as the hook saveSettings and
  // the tick call, so the dedupe keys can be dropped here: the painters
  // compare against them, and a changed Darkness or Colour must repaint.
  applyOverlayStyle() {
    this._torchDarkKey = "";
    this._torchGlowKey = "";
  },
  ensureTorchOverlayForView(view) {
    if (!this.settings.torchEffect) {
      this.disableTorchOverlay();
      return;
    }
    const targetDoc = view && view.dom.ownerDocument || this.overlay && this.overlay.ownerDocument || document;
    if (this.overlay && this.overlay.ownerDocument !== targetDoc) {
      this.overlay.remove();
      this.overlay = null;
      this.modalObserver?.disconnect();
      this.modalObserver = null;
    }
    if (!this.overlay) {
      targetDoc.body.classList.add("cursor-smith-torch-active");
      prepareDocument(targetDoc);
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.overlay = appContainer.createEl("canvas", { cls: "cursor-smith-torch-overlay" });
      this._torchDarkKey = "";
      this._lastOverlayRect = "";
      this._lastTorchRadius = -1;
      this._lastGlowRect = "";
      this._lastGlowAlpha = "";
      this._torchGlowKey = "";
      this.applyOverlayStyle();
      const covered = () => {
        this.modalOpen = !!targetDoc.querySelector(".modal-container");
        this._coverOpen = this.modalOpen || !!targetDoc.querySelector("body > .menu, .menu-container");
      };
      covered();
      this.modalObserver = new MutationObserver(covered);
      this.modalObserver.observe(targetDoc.body, { childList: true });
    }
  },
  // Paint the darkness layer for these lights, if anything about the picture
  // changed since the last paint: a moved light, a new radius, a new size,
  // a new setting. A parked torch does not touch the bitmap.
  // The note tabs' rectangles in the overlay's own coordinates, for the
  // painters' clip; null with the whole overlay dark.
  _torchLocalRegions() {
    const notes = this._torchRegions;
    const box = this._overlayBox;
    if (!notes || !box) return null;
    return notes.map((b) => ({ left: b.left - box.left, top: b.top - box.top, width: b.width, height: b.height, right: b.right - box.left, bottom: b.bottom - box.top }));
  },
  _torchPaintDarkness(spots, radiusPx, darkness, w, h, regions) {
    const el = this.overlay;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + darkness + "|" + spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";") + "|" + regionsKey(regions);
    if (key === this._torchDarkKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchDarkKey = key;
    paintTorchDarkness(ctx, w, h, spots, radiusPx, darkness, regions);
  },
  _torchPaintGlow(spots, radiusPx, warmRgb, w, h, regions) {
    const el = this.glowEl;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + warmRgb + "|" + spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";") + "|" + regionsKey(regions);
    if (key === this._torchGlowKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchGlowKey = key;
    paintTorchGlow(ctx, w, h, spots, radiusPx, warmRgb, regions);
  },
  // Build or tear down the additive glow layer.
  //
  // Called from the torch tick, NOT from ensureTorchOverlayForView: that runs
  // before the Vim per-mode settings swap, so a mode that turns the glow up
  // while the global setting has it at 0 would silently get no layer to light.
  // Decide after the swap. (Same rule as the canvas engine's lazy layers.)
  //
  // Torn down rather than hidden when unused, because a blended layer forces a
  // re-composite of everything beneath it whether or not it paints anything.
  _ensureGlowLayer(wanted) {
    if (!wanted) {
      if (this.glowEl) {
        this.glowEl.remove();
        this.glowEl = null;
        this._torchGlowKey = "";
      }
      return null;
    }
    const doc = this.overlay && this.overlay.ownerDocument;
    if (!doc) return null;
    if (this.glowEl && this.glowEl.ownerDocument !== doc) {
      this.glowEl.remove();
      this.glowEl = null;
    }
    if (!this.glowEl) {
      prepareDocument(doc);
      const appContainer = doc.querySelector(".app-container") || doc.body;
      this.glowEl = appContainer.createEl("canvas", { cls: "cursor-smith-torch-glow" });
      this._torchGlowKey = "";
      this._lastGlowRect = "";
      this._lastGlowAlpha = "";
      this._torchGlowKey = "";
    }
    return this.glowEl;
  },
  disableTorchOverlay() {
    this.torchEngineActive = false;
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
    }
    this._torchTick = null;
    this._torchRegions = null;
    this._torchDarkKey = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    if (this.torchRaf) {
      window.cancelAnimationFrame(this.torchRaf);
      this.torchRaf = 0;
    }
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("cursor-smith-torch-active");
        doc.querySelector(".cursor-smith-torch-overlay")?.remove();
        doc.querySelector(".cursor-smith-torch-glow")?.remove();
      }
    }
    this.overlay = null;
    this.glowEl?.remove();
    this.glowEl = null;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._torchDarkKey = "";
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.modalOpen = false;
    this._coverOpen = false;
  },
  enableTorchOverlay() {
    this.torchEngineActive = true;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;
    const schedule = () => {
      if (!this.torchEngineActive) return;
      if (this._torchGear === "hot") {
        this.torchRaf = window.requestAnimationFrame(tick);
        return;
      }
      const caps = this._frameCaps();
      const idleMs = Math.min(caps.torchIdleMs, Math.max(1, Math.ceil(this._torchIdleWakeMs || caps.torchIdleMs)));
      const delay = this._torchGear === "pulse" ? caps.torchPulseMs : idleMs;
      this._torchIdleT = window.setTimeout(() => {
        this._torchIdleT = 0;
        if (this.torchEngineActive) this.torchRaf = window.requestAnimationFrame(tick);
      }, delay);
    };
    const tick = () => {
      if (!this.torchEngineActive) return;
      this._torchGear = "idle";
      this._torchIdleWakeMs = 0;
      try {
        {
          if (this.presentationActive()) {
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
          } else if (!this.look.torchEffect) {
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
          } else if (!this.windowFocused() && this.look.overlayBlinkSync && this.look.blinkingEnabled) {
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            if (this.overlay) {
              this.overlay.classList.remove("cursor-smith-torch-hidden");
              const from = this._lastTorchRadius > 0 ? this._lastTorchRadius : this.look.overlayRadius;
              const stepped = Math.round(from - (from - 1) * 0.28);
              const next = stepped <= 2 ? 1 : stepped;
              if (next !== this._lastTorchRadius) {
                this._lastTorchRadius = next;
                const box = this._overlayBox;
                if (box) {
                  this._torchPaintDarkness(
                    [{ x: this.x - box.left, y: this.y - box.top }],
                    next,
                    this.look.overlayDarkness,
                    box.width,
                    box.height,
                    this._torchLocalRegions()
                  );
                }
                if (next > 1) this._torchGear = "pulse";
              }
            }
          } else {
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            if (view) this.registerWindowEvents(view.dom.ownerDocument);
            if (this.overlay) {
              const sig = [
                this.look.overlayRadius,
                this.look.overlayDarkness,
                this.look.overlayIntensity,
                this.look.overlayColor
              ].join("|");
              if (sig !== this._overlaySig) {
                this._overlaySig = sig;
                this.applyOverlayStyle();
              }
              const useMouse = this.updateOverlayTarget();
              const lerp = this.look.overlaySpeed;
              this.x += (this.tx - this.x) * lerp;
              this.y += (this.ty - this.y) * lerp;
              const settled = Math.abs(this.tx - this.x) < 0.25 && Math.abs(this.ty - this.y) < 0.25;
              if (!settled) this._torchGear = "hot";
              else {
                this.x = this.tx;
                this.y = this.ty;
              }
              const spots = this.torchSpotlights(useMouse, lerp);
              const isMobile = this.overlay.ownerDocument.body.classList.contains("is-mobile");
              const spare = isMobile || !!this.look.overlaySpareSidebars;
              const r = spare ? this.getMainAreaRect(this.overlay.ownerDocument) : null;
              const usePane = !!r;
              const rect = usePane ? r : this.getFullViewportRect(this.overlay.ownerDocument);
              const notes = usePane ? this.getNoteTabRects(this.overlay.ownerDocument) : null;
              const top = Math.round(rect.top);
              const left = Math.round(rect.left);
              const width = Math.round(rect.width);
              const height = Math.round(rect.height);
              const key = top + "," + left + "," + width + "," + height;
              if (key !== this._lastOverlayRect) {
                this._lastOverlayRect = key;
                this.overlay.style.top = top + "px";
                this.overlay.style.left = left + "px";
                this.overlay.style.width = width + "px";
                this.overlay.style.height = height + "px";
              }
              const hideForModal = spare && (this.modalOpen || notes !== null && notes.length === 0) || isMobile && (this._coverOpen || this._drawerOpen());
              const pulse = !hideForModal && !!this.look.overlayBlinkSync && !!this.look.blinkingEnabled;
              let radius = this.look.overlayRadius;
              if (pulse) {
                const depth = Math.max(0, Math.min(1, this.look.overlayBlinkDepth ?? 0.25));
                const tNow = performance.now();
                radius *= 1 - depth * (1 - this.blinkPhase(tNow));
                const w = this.blinkWindow(tNow);
                if (w.fading && this._torchGear === "idle") this._torchGear = "pulse";
                this._torchIdleWakeMs = w.msToNext;
              }
              const rKey = Math.max(1, Math.round(radius));
              this._lastTorchRadius = rKey;
              const hidden = hideForModal;
              const fScale = !hidden && this.look.overlayFlicker ? torchFlickerScale(
                performance.now(),
                this.look.overlayFlickerAmount ?? 0.3
              ) : 1;
              if (fScale !== 1 && this._torchGear === "idle") {
                this._torchGear = "pulse";
              }
              const baseI = this.look.overlayIntensity;
              const glow = this._ensureGlowLayer(!hidden && baseI > 0);
              const local = spots.map((sp) => ({ x: sp.x - left, y: sp.y - top }));
              this._overlayBox = { top, left, width, height };
              this._torchRegions = notes;
              const regions = this._torchLocalRegions();
              this._torchPaintDarkness(local, rKey, this.look.overlayDarkness, width, height, regions);
              if (glow) {
                if (key !== this._lastGlowRect) {
                  this._lastGlowRect = key;
                  glow.style.top = top + "px";
                  glow.style.left = left + "px";
                  glow.style.width = width + "px";
                  glow.style.height = height + "px";
                }
                const gAlpha = Math.max(0, Math.min(1, baseI * fScale)).toFixed(2);
                if (gAlpha !== this._lastGlowAlpha) {
                  this._lastGlowAlpha = gAlpha;
                  glow.style.setProperty("--torch-glow", gAlpha);
                }
                this._torchPaintGlow(local, rKey, hexToRgb(this.look.overlayColor), width, height, regions);
              }
              this.overlay.classList.toggle("cursor-smith-torch-hidden", !!hideForModal);
            }
          }
        }
      } catch (e) {
        this._reportOnce("torch tick (loop kept alive)", e);
      }
      schedule();
    };
    this._torchTick = tick;
    this._torchGear = "hot";
    this.torchRaf = window.requestAnimationFrame(tick);
  },
  // Sets this.tx/ty, the primary spotlight's target. Returns true when the
  // torch is following the mouse - in which case there is one light and
  // the secondaries get none (torchSpotlights).
  updateOverlayTarget() {
    const mode = this.look.overlayFollowMode;
    const here = this.overlay ? this.overlay.ownerDocument : null;
    const sameDoc = !here || !this.canvasWrapper || this.canvasWrapper.ownerDocument === here;
    const box = this._overlayBox;
    const regions = this._torchRegions;
    const inBox = (b, x, y) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
    const inside = (x, y) => (!box || inBox(box, x, y)) && (!regions || regions.some((b) => inBox(b, x, y)));
    const measured = sameDoc ? this.caretCoords() : null;
    const caret = measured && inside(measured.x, (measured.top + measured.bottom) / 2) ? measured : null;
    const mouseHere = (!here || !this._mouseDoc || this._mouseDoc === here) && inside(this.mouseX, this.mouseY);
    if (caret) {
      if (!this.lastCaret || caret.x !== this.lastCaret.x || caret.top !== this.lastCaret.top) {
        this.lastCaretMove = performance.now();
      }
      this.lastCaret = caret;
    }
    const useMouse = mode === "mouse" || mode === "auto" && (performance.now() - this.lastMouseMove < 800 || !this.lastCaret);
    if (useMouse) {
      if (mouseHere) {
        this.tx = this.mouseX;
        this.ty = this.mouseY;
      }
    } else if (this.lastCaret) {
      this.tx = this.lastCaret.x;
      this.ty = (this.lastCaret.top + this.lastCaret.bottom) / 2;
    }
    return !!useMouse;
  },
  // Every spotlight this frame: the primary's (already eased to this.x/y by
  // the torch tick) and one per full-effect secondary, each chasing its own
  // caret at the same easing. Returns [{x, y}] in client coordinates, and
  // sets this._torchGear hot while any secondary is still en route. With
  // the torch on the mouse there is one light, so only the primary's.
  torchSpotlights(useMouse, lerp) {
    const spots = [{ x: this.x, y: this.y }];
    const states = this._secondaries;
    if (useMouse || !states || !states.length) return spots;
    for (const st of states) {
      const a = st.animActive;
      if (!a) {
        st.torchX = st.torchY = void 0;
        continue;
      }
      const tx = a.x;
      const ty = a.top + (a.h || 0) / 2;
      if (st.torchX === void 0 || st.torchY === void 0) {
        st.torchX = tx;
        st.torchY = ty;
      }
      st.torchX += (tx - st.torchX) * lerp;
      st.torchY += (ty - st.torchY) * lerp;
      if (Math.abs(tx - st.torchX) < 0.25 && Math.abs(ty - st.torchY) < 0.25) {
        st.torchX = tx;
        st.torchY = ty;
      } else {
        this._torchGear = "hot";
      }
      spots.push({ x: st.torchX, y: st.torchY });
    }
    return spots;
  },
  // A side pane open over the note: on a phone the drawers, on desktop the
  // docks (only the phone reads it). The workspace's own flags, not the
  // DOM: WorkspaceMobileDrawer and WorkspaceSidedock both carry
  // `collapsed`.
  _drawerOpen() {
    try {
      const ws = this.app.workspace;
      const l = ws.leftSplit, r = ws.rightSplit;
      return !!(l && !l.collapsed || r && !r.collapsed);
    } catch {
      return false;
    }
  },
  // Torch-only wake: mouse movement retargets the spotlight but shouldn't
  // spin the cursor canvas up to full rate.
  _wakeTorch() {
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
      if (this.torchEngineActive && this._torchTick) {
        this.torchRaf = window.requestAnimationFrame(this._torchTick);
      }
    }
  }
};

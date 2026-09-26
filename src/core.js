// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { caretsMethods } from "./carets.js";
import { CARET_STATE_FIELDS, WATCHDOG_INTERVAL_MS, keystrokeHeatWeight } from "./constants.js";
import { effectsMethods } from "./effects/index.js";
import { engineMethods } from "./engine.js";
import { libraryMethods } from "./library.js";
import { measureMethods } from "./measure.js";
import { applyReducedMotion } from "./motion.js";
import { paintMethods } from "./paint/index.js";
import { DEFAULT_PRESETS, DEFAULT_PRESET_NAME, DEFAULT_VIM_PRESETS, applyStarterPreset } from "./presets.js";
import { DEFAULT_SETTINGS, VIM_MODE_KEYS, cloneVimModes, migrateLegacyKeys, pickLook } from "./settings.js";
import { app, disposeHost } from "./shim/host.js";
import { View } from "./shim/notice.js";
import { onUrlChange, siteEnabled } from "./shim/sites.js";
import { loadDeviceEnabled, loadSettings, onSettingsChanged, saveDeviceEnabled, saveSettings } from "./shim/storage.js";
import { torchMethods } from "./torch/index.js";
import { vimMethods } from "./vim.js";

export var CANDLE_ICON = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 2S9 5.3 9 7s1.3 3 3 3 3-1.3 3-3-3-5-3-5"/>
<path d="M16 22H8v-7c0-.6.4-1 1-1h6c.6 0 1 .4 1 1Z"/>
<path d="M12 14v3"/>
<path d="M17 17s-.7-1.4-1.1-2.4"/>
</g>`;
export class Host {
  constructor() {
    this.app = app;
    this._events = [];
    this._intervals = [];
  }
  // Obsidian's plugin lifecycle bookkeeping, kept because the engine's teardown
  // order depends on it: unregisterEvent runs the disposer that removes the
  // listener, and registerInterval's ids are cleared on unload.
  registerEvent(ref) {
    if (ref && typeof ref.unload === "function") this._events.push(ref);
    return ref;
  }
  registerInterval(id) {
    this._intervals.push(id);
    return id;
  }
  registerDomEvent(el, type, cb, opts) {
    el.addEventListener(type, cb, opts);
    return this.registerEvent({ unload: () => el.removeEventListener(type, cb, opts) });
  }
  _runDisposers() {
    for (const ref of this._events.splice(0)) {
      try {
        ref.unload();
      } catch (e) {
        this._reportOnce?.("unload", e);
      }
    }
    for (const id of this._intervals.splice(0)) clearInterval(id);
  }
  async loadData() {
    return loadSettings();
  }
  async saveData(data) {
    await saveSettings(data);
  }
}

export var CursorSmithPlugin = class extends Host {
  async onload() {
    this._deviceEnabled = await loadDeviceEnabled();
    const rawSaved = await this.loadData();
    const saved = migrateLegacyKeys(rawSaved);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    const freshInstall = !rawSaved || typeof rawSaved !== "object";
    if (saved && saved.uiMode === void 0) {
      this.settings.uiMode = this.settings.vimModeEnabled ? "vim" : "cua";
    }
    delete this.settings.vimPrevObsidianVim;
    if (!this.settings.userPresets) this.settings.userPresets = {};
    for (const [name, snap] of Object.entries(DEFAULT_PRESETS)) {
      if (!(name in this.settings.userPresets)) {
        this.settings.userPresets[name] = snap;
      }
    }
    if (freshInstall && applyStarterPreset(this.settings)) {
      this._activePresetName = DEFAULT_PRESET_NAME;
    }
    {
      const savedModes = this.settings.vimModes && typeof this.settings.vimModes === "object" ? this.settings.vimModes : {};
      const fresh = {};
      for (const mode of VIM_MODE_KEYS) {
        const saved2 = Object.assign({}, savedModes[mode] || {});
        if (saved2.useCustomColors === false) {
          saved2.colorDark = this.settings.colorDark;
          saved2.colorLight = this.settings.colorLight;
        }
        delete saved2.useCustomColors;
        fresh[mode] = Object.assign({}, DEFAULT_SETTINGS.vimModes[mode], pickLook(saved2));
      }
      this.settings.vimModes = fresh;
    }
    const hadVimPresets = !!this.settings.vimPresets;
    if (!this.settings.vimPresets) this.settings.vimPresets = {};
    for (const [name, snap] of Object.entries(DEFAULT_VIM_PRESETS)) {
      if (!(name in this.settings.vimPresets)) {
        this.settings.vimPresets[name] = cloneVimModes(snap);
      }
    }
    if (!hadVimPresets && !this.settings.vimActivePreset) {
      this.settings.vimActivePreset = "Preset1";
    }
    if (freshInstall) {
      try {
        await this.saveData(this.settings);
      } catch (e) {
        console.error("[cursor-smith] could not write initial settings:", e);
      }
    }
    this._docCleanups = /* @__PURE__ */ new Map();
    this.registeredDocuments = /* @__PURE__ */ new Set();
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this._resetEngineState();
    this.overlay = null;
    this.modalObserver = null;
    this.modalOpen = false;
    this._coverOpen = false;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;
    this.lastCaret = null;
    this.lastCaretMove = 0;
    this.mouseX = this.x;
    this.mouseY = this.y;
    this.lastMouseMove = 0;
    this._lastScrollT = 0;
    this._mouseDoc = null;
    this.canvasEngineActive = false;
    this.torchEngineActive = false;
    this.canvasRaf = 0;
    this.torchRaf = 0;
    this._lastWrapperRect = "";
    this._canvasBlend = "";
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._chromeCache = null;
    this._caretStyleCache = null;
    this._styleGen = 0;
    this._uiModeSwitching = false;
    // Obsidian's command palette is chrome.commands' job here: the browser owns
    // the shortcut assignment UI and the binding survives the tab not being
    // focused, which the palette never did. Ids match manifest.json's `commands`
    // block; registerCommands() wires them to the same four callbacks, and
    // `suggested_key` in the manifest pre-fills the ones the user has not bound.
    this._commands = {
      "cycle-preset": () => this.cycleActivePreset(1),
      toggle: () => this.toggle(),
      "toggle-cua-vim-mode": () => this.toggleUiMode(),
      "performance-report": () => this.performanceReport(10),
    };
    this._lookGen = 0;
    this._lastTickT = 0;
    this._watchdogTrips = 0;
    this._watchdogTripT = 0;
    this._watchdogLastT = 0;
    this._watchdogGaveUp = false;
    this._vimStatusTimer = 0;
    this.registerInterval(window.setInterval(() => this._watchdog(performance.now()), WATCHDOG_INTERVAL_MS));
    for (const ev of ["css-change", "layout-change", "active-leaf-change", "resize"]) {
      const style = ev !== "active-leaf-change";
      try {
        this.registerEvent(this.app.workspace.on(ev, () => (style ? this._invalidateStyle() : this._invalidateLayout())));
      } catch {
      }
    }
    // The options page is a separate document, so there is no panel object to
    // re-render here. Cross-document sync replaces Obsidian's refreshSettingTab.
    this.registerEvent(
      onSettingsChanged((next) => {
        if (!next) return;
        // Another tab or the options page wrote. Take the new look wholesale
        // rather than merging field by field: the writer owns the schema.
        this.settings = next;
        this._lookChanged();
        this._wakeLoop();
        // A synced change can flip a gate, not just a colour: the kill switch,
        // the site list, the allow-list mode. Reconcile, or a page opened before
        // the change keeps drawing a cursor it is no longer allowed to draw.
        if (this.isOn()) this.enable();
        else this.disable();
        try {
          this.applyBodyClasses();
          this.applyOverlayStyle();
          this._vimStatusSig = null;
          this.updateVimStatusBar();
        } catch (e) {
          this._reportOnce("settings-changed", e);
        }
      })
    );
    this._unsubUrl = onUrlChange(() => {
      // Single-page apps swap origins without a load. Re-check the site gate
      // and tear the canvas down (or bring it up) to match.
      if (this.isOn()) this.enable();
      else this.disable();
    });
    this.app.workspace.onLayoutReady(() => {
      if (this.isOn()) this.enable();
      this.syncVimStatusBar();
    });
  }
  onunload() {
    this.disable();
    if (this._reduceMQ && this._reduceMQHandler && typeof this._reduceMQ.removeEventListener === "function") {
      try {
        this._reduceMQ.removeEventListener("change", this._reduceMQHandler);
      } catch {
      }
    }
    this._reduceMQ = null;
    this._reduceMQHandler = null;
    if (this._vimStatusTimer) {
      window.clearInterval(this._vimStatusTimer);
      this._vimStatusTimer = 0;
    }
    if (this._unsubUrl) {
      this._unsubUrl();
      this._unsubUrl = null;
    }
    if (this._vimNormalRetryT) {
      window.clearTimeout(this._vimNormalRetryT);
      this._vimNormalRetryT = 0;
    }
    if (this.vimStatusEl) {
      this.vimStatusEl.remove();
      this.vimStatusEl = null;
    }
    for (const doc of Array.from(this._docCleanups.keys())) {
      this.unregisterDocument(doc);
    }
    this._runDisposers();
    disposeHost();
  }
  // Detach everything the extension put into one document: its listeners, its
  // body classes, its layers. Called for every registered document on unload.
  //
  // Thorough on purpose. A hot reload in the browser tears the content script
  // down WITHOUT reloading the page, so anything left behind survives into the
  // next run - which is how a stale canvas or a duplicated stylesheet outlives
  // the build that wrote it, and why this still removes one.
  unregisterDocument(doc) {
    const cleanup = this._docCleanups.get(doc);
    if (cleanup) {
      try {
        cleanup();
      } catch (e) {
        console.error("[cursor-smith] document cleanup failed:", e);
      }
      this._docCleanups.delete(doc);
    }
    this.registeredDocuments.delete(doc);
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument === doc) {
      try {
        this.canvasWrapper.remove();
      } catch {
      }
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
      this._canvasRect = null;
    }
    try {
      doc.getElementById("cursor-smith-dynamic-styles")?.remove();
      doc.querySelector(".cursor-smith-torch-glow")?.remove();
      doc.body?.classList.remove(
        "cursor-smith-active",
        "cursor-smith-hide-native",
        "cursor-smith-torch-active"
      );
    } catch {
    }
  }
  registerWindowEvents(doc) {
    if (this.registeredDocuments.has(doc)) return;
    this.registeredDocuments.add(doc);
    const onMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this._mouseDoc = doc;
      this.lastMouseMove = performance.now();
      this._wakeTorch();
    };
    const onActivity = (e) => this._markActivity(e && e.type ? e.type : "activity");
    const noteKeystroke = (kind, opts = {}) => {
      const now = performance.now();
      if (kind === "delete") this._deletePending = now;
      if (kind === "enter") this._enterPending = now;
      if (kind === "enter" || kind === "space") this._popKeyPending = now;
      if (!this.look.speedDemon) return;
      const weight = keystrokeHeatWeight(kind, !!opts.repeat);
      if (!weight) return;
      const bump = 0.09 * weight * (this.look.speedDemonSensitivity ?? 1);
      this.heat = Math.min(1, this.heat + bump);
      this._heatKeyT = performance.now();
    };
    const onKeyDown = (e) => {
      this._markActivity("key");
      const k = e.key;
      if (k === "Unidentified" || k === "Process" || e.isComposing) return;
      this._realKeyT = performance.now();
      if (k === "Backspace" || k === "Delete") noteKeystroke("delete", e);
      else if (k === "Enter") noteKeystroke("enter", e);
      else if (k === " " || k === "Spacebar") noteKeystroke("space", e);
      else if (k === "Tab" || typeof k === "string" && k.length === 1) {
        noteKeystroke("type", e);
      } else if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" || k === "Home" || k === "End" || k === "PageUp" || k === "PageDown") {
        noteKeystroke("nav", e);
      }
    };
    const onBeforeInput = (e) => {
      this._markActivity("input");
      if (performance.now() - (this._realKeyT || 0) < 60) return;
      const t = e.inputType || "";
      if (t.startsWith("delete")) noteKeystroke("delete");
      else if (t === "insertLineBreak" || t === "insertParagraph") noteKeystroke("enter");
      else if (t === "insertText" || t === "insertCompositionText" || t === "insertReplacementText" || t === "insertFromPaste") {
        const data = typeof e.data === "string" ? e.data : "";
        noteKeystroke(data.endsWith(" ") ? "space" : "type");
      }
    };
    const onResize = () => {
      this._chromeCache = null;
      this._lastWrapperRect = "";
      this._lastOverlayRect = "";
      this._canvasRect = null;
      this._caretStyleCache = null;
      this._markActivity("resize");
    };
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("beforeinput", onBeforeInput, true);
    const onScrollLike = (e) => {
      if (this._scrollMovesCaret(e.target, doc)) {
        this._lastScrollT = performance.now();
        this._markActivity(e.type);
      }
    };
    const onSelectionChange = () => {
      if (this._selectionMoved(doc)) this._markActivity("selectionchange");
    };
    doc.addEventListener("selectionchange", onSelectionChange);
    doc.addEventListener("mousedown", onActivity, true);
    doc.addEventListener("focusin", onActivity, true);
    doc.addEventListener("wheel", onScrollLike, { capture: true, passive: true });
    doc.addEventListener("scroll", onScrollLike, { capture: true, passive: true });
    const onWindowFocusChange = () => this._markActivity("window focus");
    const win = doc.defaultView;
    if (win) {
      win.addEventListener("resize", onResize);
      win.addEventListener("focus", onWindowFocusChange);
      win.addEventListener("blur", onWindowFocusChange);
    }
    let onPageHide = null;
    if (win && doc !== document) {
      onPageHide = () => this.unregisterDocument(doc);
      win.addEventListener("pagehide", onPageHide);
    }
    this._docCleanups.set(doc, () => {
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("beforeinput", onBeforeInput, true);
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("mousedown", onActivity, true);
      doc.removeEventListener("focusin", onActivity, true);
      doc.removeEventListener("wheel", onScrollLike, { capture: true });
      doc.removeEventListener("scroll", onScrollLike, { capture: true });
      if (win) {
        win.removeEventListener("resize", onResize);
        win.removeEventListener("focus", onWindowFocusChange);
        win.removeEventListener("blur", onWindowFocusChange);
        if (onPageHide) win.removeEventListener("pagehide", onPageHide);
      }
    });
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this._lookChanged();
    this._wakeLoop();
    try {
      this.applyBodyClasses();
    } catch (e) {
      console.error("[cursor-smith] applyBodyClasses failed:", e);
    }
    try {
      this.applyOverlayStyle();
    } catch (e) {
      console.error("[cursor-smith] applyOverlayStyle failed:", e);
    }
    try {
      this._vimStatusSig = null;
      this.updateVimStatusBar();
    } catch (e) {
      console.error("[cursor-smith] status bar refresh failed:", e);
    }
    if (this.canvasEngineActive) {
      if (this.torchPossible() && !this.torchEngineActive) this.enableTorchOverlay();
      else if (!this.torchPossible() && this.torchEngineActive) this.disableTorchOverlay();
    }
  }
  // Obsidian's panel lived in this document and had to be told when a command
  // changed what it showed. The options page is its own document and reads
  // storage directly, so there is nothing to refresh here - the engine's own
  // response to a change is _lookChanged(), which saveSettings already does.
  refreshSettingTab() {}
  toggle() {
    this.settings.enabled = !this.settings.enabled;
    if (this.isOn()) this.enable();
    else this.disable();
    void this.saveSettings();
  }
  // "Enable on this device" (issue #31). Obsidian stored the flag in its own
  // One answer to "should the cursor be drawing right now", so the site list,
  // the per-device switch and the synced kill switch cannot drift apart.
  isOn() {
    return !this.settings.globalOff && siteEnabled(this.settings) && this.settings.enabled && this._deviceEnabled;
  }

  // local storage so a synced "enabled" could not switch the cursor on for a
  // machine the user had not opted in. Same idea, chrome.storage.local instead
  // of sync, so the look still follows the profile but the master switch does not.
  setDeviceEnabled(on) {
    this._deviceEnabled = !!on;
    void saveDeviceEnabled(this._deviceEnabled);
    if (on && this.isOn()) this.enable();
    else this.disable();
  }
  // A defensive catch that stays silent turns a bug into a cursor that is
  // quietly wrong. Every catch in this class is one of two things: an EXPECTED
  // failure with a comment naming it (a document torn down with its window, an
  // input type that has no selectionStart, an Obsidian without the event), or
  // a guard that must not take the frame down - and those report here, once
  // per site per engine run, so the first occurrence is in the console and the
  // ten-thousandth is not. A test sweeps the source for a catch that is
  // neither.
  _reportOnce(site, e) {
    const seen = this._reported || (this._reported = /* @__PURE__ */ new Set());
    if (seen.has(site)) return;
    seen.add(site);
    console.error("[cursor-smith] " + site + " (reported once):", e);
  }
  // The look/effect settings in force right now. When a Vim mode is active its
  // full snapshot is layered over the global settings; otherwise the global
  // settings are returned unchanged. The engine reads it as this.look (the
  // getter below), so every read in the engine honors the active mode with
  // no per-key plumbing - and this.settings is never touched.
  // True when the OS asks for reduced motion and the user has not opted out.
  //
  // Read live off the MediaQueryList rather than cached in a field: `.matches`
  // is a plain property read, and a cached copy would need its own change
  // listener and would be one more thing that can desync. Guarded because
  // matchMedia is absent from the test harness's stubbed environment.
  reducedMotion() {
    if (this.settings.respectReducedMotion === false) return false;
    try {
      if (!this._reduceMQ) {
        const win = this.canvas && this.canvas.ownerDocument.defaultView || window;
        const mq = win.matchMedia("(prefers-reduced-motion: reduce)");
        this._reduceMQ = mq;
        this._reduceMatches = !!mq.matches;
        this._reduceMQHandler = (e) => {
          this._reduceMatches = !!e.matches;
          this._lookChanged();
        };
        if (typeof mq.addEventListener === "function") mq.addEventListener("change", this._reduceMQHandler);
      }
      return this._reduceMatches;
    } catch {
      return false;
    }
  }
  effectiveSettings(mode) {
    if (mode === void 0) mode = this.currentVimMode();
    const cfg = mode && this.settings.vimModes && this.settings.vimModes[mode] || null;
    const reduce = this.reducedMotion();
    if (!cfg && !reduce) return this.settings;
    const c = this._effCache;
    if (c && c.mode === mode && c.base === this.settings && c.cfg === cfg && c.reduce === reduce) {
      return c.obj;
    }
    const obj = Object.assign({}, this.settings, cfg);
    if (reduce) applyReducedMotion(obj);
    this._effCache = { mode, base: this.settings, cfg, reduce, obj };
    return obj;
  }
  // The look the engine draws with: this.settings with the active Vim mode's
  // snapshot merged over it and reduced motion applied. Everything that
  // measures, spawns or paints reads THIS; everything that persists, and the
  // panel, reads this.settings - which is never replaced. It is a getter
  // over the memo in effectiveSettings (currentVimMode is memoized for a
  // frame too), so a read is a handful of comparisons and always agrees with
  // the settings object of the moment.
  //
  // Until 1.5.5 the two ticks swapped this.settings for the merged object
  // for the length of a frame and put it back in a finally, with a guard in
  // saveSettings against persisting the wrong one. That was correct while
  // every read in the frame was synchronous and nothing inside it saved -
  // and it was the kind of trick that stays correct until someone reads a
  // setting from a callback that fires mid-frame. Now there is nothing to
  // put back.
  get look() {
    return this.effectiveSettings(this.currentVimMode());
  }
  // Something changed what `look` answers: a save, a preset, the
  // reduced-motion query. Drops the memo and bumps the look generation the
  // static-frame signature carries (_frameSignature), so the next frame is
  // painted whatever else matched.
  _lookChanged() {
    this._effCache = null;
    this._lookGen = (this._lookGen | 0) + 1;
  }
  // Thin passthrough kept for the draw-path reads that take a key by name.
  styleFor(key) {
    return this.look[key];
  }
  // isPresentationModeActive runs two querySelector-style probes; at 120fps in
  // two loops that's ~500 DOM queries a second for a state that changes maybe
  // twice per session. Cache it for 500ms — a half-second delay in noticing a
  // presentation started/ended is invisible.
  presentationActive() {
    const now = performance.now();
    if (now - (this._presCacheT || 0) < 500) return !!this._presCacheV;
    this._presCacheT = now;
    this._presCacheV = this.isPresentationModeActive();
    return this._presCacheV;
  }
  // True when the OS-level window that owns our canvas is the focused one.
  //
  // Every other writing app drops the caret the moment its window goes to the
  // background, and so does Obsidian's own editor: CodeMirror removes
  // .cm-focused on window blur and stops painting its cursor. Ours is drawn on
  // an independent canvas that knows nothing about any of that, so without
  // this check it sits there blinking away over a background window.
  //
  // Document.hasFocus() is the probe rather than a cached flag set from a blur
  // listener, for two reasons: it answers per-document, so in a multi-window
  // vault the popout you're actually typing in keeps its cursor while the
  // others drop theirs; and it can't get stuck out of sync if a focus event is
  // ever missed (a window opened/closed mid-transition, OS-level focus
  // stealing). The focus/blur listeners in registerWindowEvents don't set
  // state - they only wake the render loop so the change is picked up on the
  // very next frame instead of up to 100ms later at the idle heartbeat.
  //
  // It's cheap: hasFocus() reads a flag on the frame, forcing no layout, so
  // polling it once per frame costs nothing measurable.
  windowFocused() {
    if (!this.settings.hideOnWindowBlur) return true;
    try {
      const canvasDoc = this.canvas && this.canvas.ownerDocument;
      if (canvasDoc && canvasDoc.hasFocus()) return true;
      if (typeof activeDocument !== "undefined" && activeDocument && activeDocument.hasFocus()) return true;
      for (const d of this.registeredDocuments) {
        try {
          if (d && d.hasFocus()) return true;
        } catch {
        }
      }
      if (canvasDoc || typeof activeDocument !== "undefined" && activeDocument || this.registeredDocuments.size) {
        return false;
      }
      return document.hasFocus();
    } catch (e) {
      this._reportOnce("windowFocused", e);
      return true;
    }
  }
  // Whether the native caret should currently be suppressed. Every site that
  // stamps cursor-smith-hide-native reads this rather than the setting, because
  // the answer also changes with FOCUS and not only when a setting is saved.
  //
  // Upstream this also consulted noteEditorOnly, so the native caret survived in
  // Obsidian's own UI fields. A browser has no equivalent split: the per-origin
  // gate already decided whether this document is ours at all (see enable()), and
  // on a document that is ours, suppressing the native caret is the whole point.
  hideNativeActive() {
    if (this._watchdogGaveUp) return false;
    return !!this.settings.hideNativeCaret;
  }
  applyBodyClasses() {
    const engineActive = !!(this.canvasEngineActive || this.torchEngineActive);
    const presenting = this.isPresentationModeActive();
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.toggle(
          "cursor-smith-hide-native",
          !!(engineActive && this.hideNativeActive() && !presenting)
        );
      }
    }
  }
  // The focused document that ISN'T the active view's - or null when the
  // view's own window is the focused one (or nothing of ours is focused).
  //
  // This is the Obsidian 1.13 settings window, made a first-class citizen.
  // Before 1.13, Settings was a modal INSIDE the main document, so the
  // interface-caret machinery (genericCaretCoords / formFieldCaretCoords /
  // getCaretClipRect - all of which were built for exactly those text boxes)
  // found its inputs for free: same document as the canvas. 1.13 moved
  // Settings into its own window, and every document this engine knew how to
  // reach came from `view.dom.ownerDocument` - a document that, by
  // construction, hosts a workspace view. The settings window hosts none, so
  // the canvas never migrated there, its activeElement was never consulted,
  // and the cursor simply didn't exist in any of its boxes.
  //
  // The rule: the view's document keeps the canvas for as long as it has OS
  // focus. Only when it doesn't - and some OTHER document of ours does - is
  // that other document offered as the migration target. Candidates are
  // Obsidian's activeDocument global (which tracks the focused Obsidian
  // window) plus every document we've registered, which includes the
  // settings window itself via the settings tab (registerPanelDocument). A fully
  // backgrounded app matches nothing here and returns null, so the old
  // fallback chain - and windowFocused()'s parking - behave exactly as
  // before.
  _focusedForeignDoc(view) {
    try {
      const viewDoc = view && view.dom.ownerDocument;
      if (viewDoc && viewDoc.hasFocus()) return null;
      const candidates = [];
      if (typeof activeDocument !== "undefined" && activeDocument) {
        candidates.push(activeDocument);
      }
      for (const d of this.registeredDocuments) candidates.push(d);
      for (const d of candidates) {
        if (!d || d === viewDoc) continue;
        try {
          if (d.body && d.hasFocus()) return d;
        } catch {
        }
      }
    } catch (e) {
      this._reportOnce("_focusedForeignDoc", e);
    }
    return null;
  }
  // Returns true when Obsidian's Slides plugin is showing a presentation
  // overlay. In that state the note editor is still technically "active" and
  // hasFocus can still return true, so without this guard the canvas engine
  // keeps drawing a blinking cursor over the slides - and keystrokes still
  // reach the underlying CM editor, causing live edits during a presentation.
  //
  // Detection strategy (most-to-least specific):
  //   1. A .slides-container element is present and visible (Slides plugin
  //      presentation overlay - the most direct signal).
  //   2. The active leaf's view type is "slides" (covers the same case via
  //      Obsidian's own workspace API, without relying on DOM class names).
  //   3. body.is-fullscreen alone is NOT used: other things (e.g. Obsidian's
  //      native full-screen mode) also set it and would cause a false positive.
  isPresentationModeActive() {
    try {
      const doc = this.canvas?.ownerDocument ?? (typeof activeDocument !== "undefined" ? activeDocument : null) ?? document;
      const slidesContainer = doc.querySelector(".slides-container");
      if (slidesContainer && this._isVisiblyRendered(slidesContainer)) return true;
      const activeView = this.app.workspace.getActiveViewOfType(View);
      if (activeView?.getViewType?.() === "slides") return true;
    } catch (e) {
      this._reportOnce("isPresentationModeActive", e);
    }
    return false;
  }
  // ---------------------------------------------------------------------------
  // THE pool/state reset. Called from three places - onload, enableCanvasEngine
  // and disableCanvasEngine - which is exactly why it is a function: those
  // three used to be three hand-maintained lists, and ARCHITECTURE.md's warning
  // that missing one lets state survive a plugin toggle had already come true
  // in both directions (see the comment at the call site in onload).
  //
  // ADDING AN EFFECT: reset its pool HERE and nowhere else. This is the second
  // of the six touchpoints in the header, and now the only one that is a single
  // edit rather than three.
  //
  // Nothing here may touch the DOM, the canvas, the rAF handles or the engine's
  // active flags: those are genuinely per-site (a disable tears the canvas down,
  // an enable builds it) and stay at their call sites.
  // ---------------------------------------------------------------------------
  _resetEngineState() {
    this._reported = /* @__PURE__ */ new Set();
    if (!this._caret) this._caret = {};
    this.trail = [];
    this.particles = [];
    this.flamePixels = [];
    this.flameEmbers = [];
    this.hotBurns = [];
    this._hotPrev = null;
    this.thunderbolts = [];
    this.fireworks = [];
    this._lastFireworkT = 0;
    this.glitch = null;
    this.stardust = [];
    this._lastStardustT = 0;
    this.bracketTether = null;
    this._tetherKey = null;
    this._tetherFrom = -1;
    this._tetherTo = -1;
    this._tetherSegs = null;
    this._tetherSegKey = null;
    this._tetherAnchorA = null;
    this._tetherAnchorB = null;
    this.secondaryCarets = [];
    this._secondaries = [];
    this._selShape = null;
    this.lastActive = null;
    this.pending = null;
    this.smearQuad = null;
    this._smearLead = null;
    this._smearTrail = null;
    this.smearShape = null;
    this._taperBuf = null;
    this._volumeBuf = null;
    this._smearDir = null;
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;
    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;
    this._catchUpBoost = 1;
    this._smoothMoving = false;
    this._smoothLastT = 0;
    this._typingBoostSm = null;
    this._hotEmitFrom = null;
    this._hotActiveT = 0;
    this._lastHotT = 0;
    this._hotShiftTick = 0;
    this._hotEngulfUntil = 0;
    this.heat = 0;
    this._lastSparkT = 0;
    this._popRainbowHue = 0;
    this._hideNativeSig = null;
    this._selSig = null;
    this._idleWakeMs = 0;
    this._glyphMetricKey = null;
    this._glyphMetrics = null;
    this._hotFill = null;
  }
  enable() {
    this.disable();
    if (this._deviceEnabled === false) return;
    // The per-origin gate. Resolved here rather than inside the measurement
    // path so a denied site never builds a canvas, never installs listeners and
    // never touches the page's caret styling at all - the cheapest possible
    // "no" on a tab the user never opted in.
    if (!siteEnabled(this.settings)) return;
    this._watchdogGaveUp = false;
    this.enableCanvasEngine();
    if (this.torchPossible()) this.enableTorchOverlay();
  }
  disable() {
    this.disableCanvasEngine();
    this.disableTorchOverlay();
  }
};
Object.assign(CursorSmithPlugin.prototype, measureMethods, effectsMethods, paintMethods, torchMethods, libraryMethods, vimMethods, engineMethods, caretsMethods);
for (const key of CARET_STATE_FIELDS) {
  Object.defineProperty(CursorSmithPlugin.prototype, key, {
    configurable: true,
    enumerable: false,
    get() {
      const c = this._caret;
      return c ? c[key] : void 0;
    },
    set(value) {
      const c = this._caret || (this._caret = {});
      c[key] = value;
    }
  });
}

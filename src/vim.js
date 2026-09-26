// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { isRichEditorHost } from "./shim/editors.js";
import { Notice } from "./shim/notice.js";

import { step } from "./demo.js";
import { isTextCaretHost } from "./motion.js";
import { VIM_MODE_KEYS, VIM_MODE_LABELS } from "./settings.js";

export var vimMethods = {
  // Whether the plugin is currently "in Vim mode" for command purposes.
  // uiMode is the user-facing switch and vimModeEnabled is the feature flag;
  // renderModeSwitch and setVimModeEnabled keep them in step, but an install that
  // predates uiMode can have only the latter, so treat either as Vim.
  isVimUiMode() {
    return (this.settings.uiMode || "cua") === "vim" || !!this.settings.vimModeEnabled;
  },
  // The palette's CUA/Vim switch. Deliberately a wrapper around
  // setVimModeEnabled rather than a second way of doing the same thing: the
  // panel's segmented control and this command have to stay on one path, or
  // the two drift the moment either grows a step.
  //
  // Single-flight, and that guard exists FOR the palette. A segmented button
  // cannot be clicked again mid-flight; a hotkey held down re-fires as fast as
  // the OS repeats it, and setVimModeEnabled awaits a disk write in the middle
  // of a chain that rebuilds every editor's extensions. Without this, a held
  // key stacks overlapping switches whose saveSettings() calls race.
  //
  // Reads through isVimUiMode() rather than settings.uiMode directly, so an
  // install predating uiMode (vimModeEnabled only) toggles the right way on
  // the first press instead of appearing to do nothing.
  async toggleUiMode() {
    if (this._uiModeSwitching) return;
    this._uiModeSwitching = true;
    try {
      const next = !this.isVimUiMode();
      await this.setVimModeEnabled(next);
      new Notice(`Cursor-Smith: ${next ? "Vim" : "CUA / Normal"} mode`);
      this.refreshSettingTab();
    } finally {
      this._uiModeSwitching = false;
    }
  },
  // =========================================================================
  // Vim-aware cursors
  // =========================================================================
  // Single entry point for turning the plugin's Vim cursors on/off. Two
  // callers, and they must stay the only two: the settings panel's CUA/Vim
  // switch (renderModeSwitch) and the palette command (toggleUiMode, which
  // wraps this rather than repeating it). Also:
  //  • drives Obsidian's own Vim keybindings when vimControlObsidian is set
  //    (remembering the prior state so turning the feature off restores it),
  //  • creates/removes the status bar mode indicator.
  async setVimModeEnabled(value) {
    value = !!value;
    this.settings.vimModeEnabled = value;
    this.settings.uiMode = value ? "vim" : "cua";
    await this.saveSettings();
    if (this.settings.vimRichEditorsOnly) {
      try {
        if (value) this.forceVimNormalMode();
      } catch (e) {
        console.error("[cursor-smith] settling Vim mode failed:", e);
      }
    }
    try {
      this.syncVimStatusBar();
    } catch (e) {
      console.error("[cursor-smith] vim status bar update failed:", e);
    }
  },
  // Drop every open editor into Normal mode.
  //
  // Sending a synthetic Escape rather than poking cm.state.vim.insertMode
  // directly is deliberate: exiting insert is not just a flag flip. The vim
  // engine also has to close the change/undo group it opened on entry, run any
  // pending repeat (so a half-finished "3i" doesn't fire later), and move the
  // caret back one column the way real vim does. Clearing the flag by hand
  // skips all of that and leaves the engine inconsistent — Escape runs the
  // engine's own exit path, which is the only thing that gets it all right.
  //
  // updateOptions() rebuilds the editor's extensions asynchronously, so the
  // vim extension usually isn't installed yet on the first attempt; retry on a
  // short timer until the adapter shows up, then give up rather than spin.
  forceVimNormalMode(attempt = 0) {
    if (this._vimNormalRetryT) {
      window.clearTimeout(this._vimNormalRetryT);
      this._vimNormalRetryT = 0;
    }
    if (!this.settings.vimModeEnabled) return;
    let anyEditor = false;
    try {
      for (const view of this.allEditorViews()) {
        anyEditor = true;
        const cm = this.getVimAdapter(view);
        if (!cm) {
          anyEditor = false;
          break;
        }
        const v = cm.state.vim || {};
        if (!v.insertMode && !v.visualMode) continue;
        const target = view.contentDOM;
        if (!target) continue;
        const win = target.ownerDocument.defaultView || window;
        target.dispatchEvent(new win.KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        }));
      }
    } catch (e) {
      this._reportOnce("forceVimNormalMode", e);
    }
    if (!anyEditor && attempt < 20) {
      this._vimNormalRetryT = window.setTimeout(() => {
        this._vimNormalRetryT = 0;
        this.forceVimNormalMode(attempt + 1);
      }, 50);
    }
  },
  // Every live CodeMirror view across all open markdown leaves (including
  // pop-out windows), not just the focused one — switching modes should settle
  // every editor, otherwise a background tab stays in insert until you visit
  // it and press Escape yourself.
  allEditorViews() {
    const views = [];
    const push = (v) => {
      if (v && !views.includes(v)) views.push(v);
    };
    try {
      push(this.app.workspace.activeEditor?.editor?.cm);
      this.app.workspace.iterateAllLeaves?.((leaf) => {
        push(leaf?.view?.editor?.cm);
      });
    } catch (e) {
      this._reportOnce("allEditorViews", e);
    }
    return views;
  },
  // Whether Vim cursor modes should apply to the focused host.
  //
  // Upstream this read Obsidian's own "Vim keybindings" setting, because in
  // Obsidian the Vim cursor is meaningless unless Obsidian's vim engine is the
  // thing producing the modes. On the web the same reasoning applies to the
  // host rather than to a global toggle: a <textarea> has no Normal mode, so
  // gating on "is this a real code editor" is the equivalent question. A site
  // running CodeMirror with codemirror-vim answers yes; a login form does not.
  isVimCapableHost() {
    try {
      if (!this.settings.vimRichEditorsOnly) return true;
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (!view) return false;
      return isRichEditorHost(view.dom);
    } catch (e) {
      this._reportOnce("isVimCapableHost", e);
      return false;
    }
  },
  // @replit/codemirror-vim (the vim engine Obsidian bundles) stashes a CM5-
  // compatible adapter on the EditorView; its own getCM(view) helper just
  // returns view.cm. We read it directly rather than importing the vim module,
  // since that module isn't guaranteed to be requireable from a plugin. The
  // adapter exposes the live vim state at cm.state.vim, which is what we need.
  getVimAdapter(view) {
    try {
      const cm = view && view.cm;
      if (cm && cm.state && cm.state.vim) return cm;
    } catch {
    }
    return null;
  },
  // Is a block ("fat") cursor currently shown? @replit/codemirror-vim toggles
  // the .cm-fat-cursor class on the content element for block-cursor modes
  // (normal/visual/replace). Insert mode uses a thin caret. This is the
  // fallback signal when the adapter isn't reachable.
  _vimBlockCursorShown(view) {
    try {
      const content = view.contentDOM;
      if (content && content.classList && content.classList.contains("cm-fat-cursor")) return true;
      const root = view.dom;
      return !!(root && "querySelector" in root && root.querySelector(".cm-fat-cursor"));
    } catch (e) {
      this._reportOnce("_vimBlockCursorShown", e);
      return false;
    }
  },
  // Resolve the current Vim mode to one of VIM_MODE_KEYS, or null when it
  // can't be determined. Prefers the adapter's authoritative state (the only
  // way to reliably see "replace"); falls back to selection + block-cursor
  // heuristics, which cover normal/insert/visual but report replace as normal.
  detectVimMode(view) {
    const cm = this.getVimAdapter(view);
    if (cm) {
      const v = cm.state.vim || {};
      if (v.visualMode) return "visual";
      if (v.insertMode) {
        const replace = cm.state.overwrite || v.insertModeReplace || v.replaceMode;
        return replace ? "replace" : "insert";
      }
      return "normal";
    }
    try {
      if (!view.state.selection.main.empty) return "visual";
      return this._vimBlockCursorShown(view) ? "normal" : "insert";
    } catch (e) {
      this._reportOnce("detectVimMode", e);
      return null;
    }
  },
  // Is the caret currently in a plain interface field rather than in a code
  // editor? That is what "Command" means here: the site's own command palette,
  // a search box, a comment field, a settings input, a rename field.
  //
  // Upstream the test was "a text field has focus and it is not the note
  // editor", which lined up exactly with caretCoords() falling through to
  // genericCaretCoords(). The browser equivalent is the same question with the
  // editor test swapped for isRichEditorHost(): a <textarea> or a bare
  // contenteditable is Command; a CodeMirror or Monaco surface is not.
  //
  // isTextCaretHost keeps this off elements with no caret at all - checkboxes,
  // sliders, buttons - which would otherwise read as entering Command mode.
  isVimCommandContext() {
    try {
      const doc = this.canvas?.ownerDocument || document;
      const active = doc.activeElement;
      if (!isTextCaretHost(active)) return false;
      return !isRichEditorHost(active);
    } catch (e) {
      this._reportOnce("isVimCommandContext", e);
      return false;
    }
  },
  // The Vim mode that should currently drive the cursor's look, or null when
  // vim theming shouldn't apply (feature off, Obsidian vim off, or no caret
  // anywhere). Memoized for a frame so the several styleFor()/color reads per
  // draw don't each re-run detection.
  currentVimMode() {
    if (!this.settings.vimModeEnabled) return null;
    const now = performance.now();
    if (this._vimModeCacheT && now - this._vimModeCacheT < 15) return this._vimModeCache;
    let mode = null;
    try {
      if (this.isVimCapableHost()) {
        if (this.isVimCommandContext()) {
          mode = "command";
        } else {
          const view = this.app.workspace.activeEditor?.editor?.cm;
          if (view && view.hasFocus) mode = this.detectVimMode(view);
        }
      }
    } catch (e) {
      this._reportOnce("currentVimMode", e);
      mode = null;
    }
    this._vimModeCache = mode;
    this._vimModeCacheT = now;
    return mode;
  },
  // Called from the canvas tick the frame the active Vim mode changes. The
  // torch tick already reacts per-frame to the effective settings, but clearing
  // its cached style/rect signatures here makes the spotlight update on the
  // very next frame instead of waiting for the dedupe key to differ.
  onVimModeChanged() {
    this._overlaySig = "";
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this.updateVimStatusBar();
  },
  // =========================================================================
  // Vim mode indicator in Obsidian's status bar
  // =========================================================================
  // The mode the status bar should name. Falls back to reading the editor
  // directly when currentVimMode() returns null (focus is on a button, the
  // ribbon, empty space...): the editor is still in whatever mode it was, and
  // blanking the item every time focus touches a non-text element would make
  // it flicker constantly.
  statusBarVimMode() {
    if (!this.settings.vimModeEnabled || !this.isVimCapableHost()) return null;
    const live = this.currentVimMode();
    if (live) return live;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (view) return this.detectVimMode(view);
    } catch {
    }
    return null;
  },
  // Create the mode indicator on demand, remove it when it shouldn't be there.
  // Kept as add/remove rather than a permanently-present hidden element so a
  // page with Vim cursors off carries no stray node at all.
  //
  // Upstream this was an item in Obsidian's status bar. A web page has no status
  // bar and inventing one on someone else's site would be rude, so it is a small
  // fixed badge instead - and one that only exists while there is a mode to
  // report, rather than sitting in the corner of every page at all times.
  syncVimStatusBar() {
    const wanted = !!(this.settings.vimStatusBar && this.settings.vimModeEnabled);
    if (wanted && !this.vimStatusEl) {
      const el = document.createElement("div");
      el.className = "cursor-smith-vim-status";
      el.setAttribute("aria-live", "off");
      document.body.appendChild(el);
      this.vimStatusEl = el;
      this._vimStatusSig = null;
      if (!this._vimStatusTimer) this._vimStatusTimer = window.setInterval(() => this.updateVimStatusBar(), 250);
    } else if (!wanted && this.vimStatusEl) {
      this.vimStatusEl.remove();
      this.vimStatusEl = null;
      this._vimStatusSig = null;
      if (this._vimStatusTimer) {
        window.clearInterval(this._vimStatusTimer);
        this._vimStatusTimer = 0;
      }
    }
    this.updateVimStatusBar();
  },
  updateVimStatusBar() {
    const el = this.vimStatusEl;
    if (!el) return;
    try {
      const mode = this.statusBarVimMode();
      // Obsidian's answer for "is the dark palette in force" was the .theme-dark
      // class. A page can be either, so ask the OS - the same signal the
      // toasts and the options page use.
      const isDark = !!matchMedia?.("(prefers-color-scheme: dark)")?.matches;
      const tint = !!this.settings.vimStatusBarColor;
      const sig = `${mode}|${isDark}|${tint}`;
      if (sig === this._vimStatusSig) return;
      this._vimStatusSig = sig;
      if (!mode) {
        // Hidden, not removed: the poller that would bring it back is the one
        // that would be torn down by removing it, so focus returning to an
        // editor would leave the badge gone until the next settings change.
        el.style.display = "none";
        return;
      }
      el.textContent = (VIM_MODE_LABELS[mode] || mode).toUpperCase();
      el.style.display = "";
      if (!tint) {
        el.style.color = "";
        el.style.background = "";
        return;
      }
      const cfg = this.settings.vimModes && this.settings.vimModes[mode] || null;
      el.style.color = cfg ? (isDark ? cfg.colorDark : cfg.colorLight) : "";
    } catch (e) {
      this._reportOnce("updateVimStatusBar", e);
    }
  }
};

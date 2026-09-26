// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { Notice } from "./shim/notice.js";

import { VIM_MODE_KEYS, VIM_STATE_KEYS, cloneVimModes, presetWithDefaults, vimModeSnapshot } from "./settings.js";
import { codeToPreset, codeToVimPreset } from "./share.js";

export var libraryMethods = {
  // ---- User preset CRUD ----
  getUserPresets() {
    if (!this.settings.userPresets) this.settings.userPresets = {};
    return this.settings.userPresets;
  },
  async saveUserPreset(name) {
    const snap = Object.assign({}, this.settings);
    delete snap.enabled;
    delete snap.userPresets;
    for (const k of VIM_STATE_KEYS) delete snap[k];
    this.getUserPresets()[name] = snap;
    await this.saveSettings();
  },
  async loadUserPreset(name) {
    const preset = this.getUserPresets()[name];
    if (!preset) return;
    const wasEnabled = this.settings.enabled;
    const presets = this.getUserPresets();
    const vimState = {};
    const dst = vimState, src = this.settings;
    for (const k of VIM_STATE_KEYS) dst[k] = src[k];
    Object.assign(this.settings, presetWithDefaults(preset));
    this.settings.enabled = wasEnabled;
    this.settings.userPresets = presets;
    Object.assign(this.settings, vimState);
    await this.saveSettings();
    if (this.settings.enabled) this.enable();
    this._activePresetName = name;
  },
  async deleteUserPreset(name) {
    delete this.getUserPresets()[name];
    await this.saveSettings();
  },
  // The single palette command routes here: cycle whichever preset library
  // belongs to the mode the user is actually in.
  cycleActivePreset(direction) {
    if (this.isVimUiMode()) return this.cycleVimPreset(direction);
    return this.cyclePreset(direction);
  },
  cyclePreset(direction) {
    const presets = this.getUserPresets();
    const names = Object.keys(presets);
    if (names.length === 0) return;
    const current = this._activePresetName ?? null;
    const currentIdx = names.indexOf(current);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];
    void this.loadUserPreset(nextName).then(() => {
      this._activePresetName = nextName;
      this._pendingPresetName = nextName;
      new Notice(`Cursor-Smith: ${nextName}`);
      this.refreshSettingTab();
    });
  },
  // Returns the name it was saved under, or null if the code was invalid.
  async importPreset(code) {
    const result = codeToPreset(code.trim());
    if (!result) return null;
    this.getUserPresets()[result.name] = result.snap;
    await this.saveSettings();
    return result.name;
  },
  // ---- Vim preset CRUD (independent of the regular cursor presets) ----
  getVimPresets() {
    if (!this.settings.vimPresets) this.settings.vimPresets = {};
    return this.settings.vimPresets;
  },
  async saveVimPreset(name) {
    this.getVimPresets()[name] = cloneVimModes(this.settings.vimModes);
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  },
  async loadVimPreset(name) {
    const preset = this.getVimPresets()[name];
    if (!preset) return;
    for (const mode of VIM_MODE_KEYS) {
      this.settings.vimModes[mode] = vimModeSnapshot(mode, preset[mode]);
    }
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  },
  async deleteVimPreset(name) {
    delete this.getVimPresets()[name];
    if (this.settings.vimActivePreset === name) this.settings.vimActivePreset = "";
    await this.saveSettings();
  },
  async cycleVimPreset(direction) {
    const names = Object.keys(this.getVimPresets());
    if (names.length === 0) {
      new Notice("Cursor-Smith: no Vim presets are saved");
      return;
    }
    const currentIdx = names.indexOf(this.settings.vimActivePreset);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];
    if (!this.settings.vimModeEnabled) await this.setVimModeEnabled(true);
    await this.loadVimPreset(nextName);
    new Notice(`Cursor-Smith: Vim preset \u2014 ${nextName}`);
    this.refreshSettingTab();
  },
  // Returns the name it was saved under, or null if the code was invalid.
  //
  // Only accepts Vim codes ("2|..."). A regular preset code describes one
  // cursor, not five, so there's no honest way to expand it into a Vim preset -
  // better to report it as the wrong kind of code than to silently paint all
  // five modes the same and let someone wonder why their Insert cursor looks
  // like their Normal one.
  async importVimPreset(code) {
    const result = codeToVimPreset(code.trim());
    if (!result) return null;
    this.getVimPresets()[result.name] = cloneVimModes(result.modes);
    this.settings.vimActivePreset = result.name;
    await this.saveSettings();
    return result.name;
  }
};

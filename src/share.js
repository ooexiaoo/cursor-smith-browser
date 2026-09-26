// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { DEFAULT_SETTINGS, LOOK_KEYS, VIM_MODE_KEYS, migrateLegacyKeys, pickLook, vimModeSnapshot } from "./settings.js";

export var SHARE_VERSION = "1";
export function shareEncodeValue(v) {
  if (typeof v === "boolean") return "b" + (v ? "1" : "0");
  if (typeof v === "number") return "n" + shareNum(v);
  if (typeof v === "string") {
    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) return "c" + v.slice(1);
    return "s" + encodeURIComponent(v);
  }
  return "j" + encodeURIComponent(JSON.stringify(v));
}
export function shareNum(n) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}
export function shareDecodeValue(tag, raw) {
  switch (tag) {
    case "b":
      return raw === "1";
    case "n":
      return Number(raw);
    case "c":
      return "#" + raw;
    case "s":
      return decodeURIComponent(raw);
    case "j":
      try {
        return JSON.parse(decodeURIComponent(raw));
      } catch {
        return void 0;
      }
    default:
      return void 0;
  }
}
export function shareFields(look, defaults) {
  const fields = [];
  for (let i = 0; i < LOOK_KEYS.length; i++) {
    const k = LOOK_KEYS[i];
    if (!(k in look)) continue;
    const v = look[k];
    if (v === void 0) continue;
    if (v === defaults[k]) continue;
    if (typeof v === "number" && typeof defaults[k] === "number" && shareNum(v) === shareNum(defaults[k])) continue;
    fields.push(i + shareEncodeValue(v));
  }
  return fields.join("~");
}
export function shareParseFields(body) {
  const snap = {};
  if (!body) return snap;
  for (const field of body.split("~")) {
    if (!field) continue;
    const m = /^(\d+)(.)([\s\S]*)$/.exec(field);
    if (!m) continue;
    const key = LOOK_KEYS[Number(m[1])];
    if (!key) continue;
    const val = shareDecodeValue(m[2], m[3]);
    if (val !== void 0) snap[key] = val;
  }
  return snap;
}
export function presetToCode(name, snap) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  const body = shareFields(pickLook(snap), defaults);
  return [SHARE_VERSION, encodeURIComponent(name || ""), body].join("|");
}
export function codeToPreset(code) {
  const trimmed = (code || "").trim();
  if (trimmed.slice(0, 2) !== SHARE_VERSION + "|") return null;
  try {
    const parts = trimmed.split("|");
    const name = decodeURIComponent(parts[1] || "") || "Imported preset";
    return { name, snap: shareParseFields(parts.slice(2).join("|")) };
  } catch {
    return null;
  }
}
export var SHARE_VERSION_VIM = "2";
export function vimPresetToCode(name, modes) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  const bodies = VIM_MODE_KEYS.map((m) => shareFields(pickLook(vimModeSnapshot(m, modes && modes[m])), defaults));
  return [SHARE_VERSION_VIM, encodeURIComponent(name || ""), ...bodies].join("|");
}
export function codeToVimPreset(code) {
  const trimmed = (code || "").trim();
  if (trimmed.slice(0, 2) !== SHARE_VERSION_VIM + "|") return null;
  try {
    const parts = trimmed.split("|");
    const name = decodeURIComponent(parts[1] || "") || "Imported Vim preset";
    const modes = {};
    VIM_MODE_KEYS.forEach((m, i) => {
      const body = parts[2 + i];
      if (body === void 0) return;
      modes[m] = migrateLegacyKeys(shareParseFields(body));
    });
    return { name, modes };
  } catch {
    return null;
  }
}

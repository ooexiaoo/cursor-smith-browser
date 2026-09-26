// The look/effect schema.
//
// The four cards - Appearance, Blinking, Smooth movement, Effects - are defined
// once by lookDefinitions() below and used twice: once for the global cursor and
// once per Vim mode, since a mode's config is a full snapshot of the same keys.
// That sharing is upstream's and worth keeping; it is the reason a new effect is
// one edit rather than two.
//
// lookDefinitions is carried over verbatim. It talks to Obsidian's `Setting`
// builder, which this project does not have, so the seam is a recorder instead:
// row() runs each control-builder against a fake Setting that records what it was
// asked to add, and the options renderer reads those recordings back. Translating
// 440 lines of declarative calls by hand would be a large diff with no upside -
// the schema is data either way, and this way it cannot drift from upstream.

import { DEFAULT_SETTINGS } from "../settings.js";
import { RAIL_EFFECTS } from "./rail.js";

// --- The fake Setting ------------------------------------------------------
//
// Records a control instead of building one. The builder callbacks chain
// (s.addSlider(...).addExtraButton(...)), so each method returns `this`.

// A late-binding builder. The schema runs before any DOM exists, so these calls
// record into the control until the renderer installs a real `impl`; after that
// every call - including the ones the renderer replays - goes to the live
// element. That matters for the per-row reset button, which holds onto the
// slider builder it was given and calls setValue() on it later.
function builder(control, methods) {
  const b = {};
  for (const [name, record] of Object.entries(methods)) {
    b[name] = (...args) => {
      if (control.impl) return control.impl[name](...args);
      record(...args);
      return b;
    };
  }
  return b;
}

class SettingRecorder {
  constructor(spec) {
    this.spec = spec;
    spec.controls = spec.controls || [];
  }
  _add(control) {
    this.spec.controls.push(control);
    return this;
  }
  // Each of these hands the callback a builder that returns ITSELF, the way
  // Obsidian's does: s.addSlider(...).addExtraButton(...) is one expression, so
  // the inner builder - not the Setting - has to be what addSlider returns.
  addToggle(cb) {
    const c = { type: "toggle" };
    cb(builder(c, {
      setValue: (v) => (c.value = v),
      onChange: (fn) => (c.onChange = fn),
    }));
    return this._add(c);
  }
  addSlider(cb) {
    const c = { type: "slider" };
    cb(builder(c, {
      setLimits: (min, max, step) => {
        c.min = min;
        c.max = max;
        c.step = step;
      },
      setValue: (v) => (c.value = v),
      onChange: (fn) => (c.onChange = fn),
    }));
    return this._add(c);
  }
  addDropdown(cb) {
    const c = { type: "dropdown", options: [] };
    cb(builder(c, {
      addOption: (v, label) => void c.options.push({ value: v, label }),
      addOptions: (opts) => {
        // Obsidian takes a { value: label } map here, not an array. Accept both
        // so a caller can hand over whichever it has.
        c.options = Array.isArray(opts)
          ? opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o))
          : Object.entries(opts || {}).map(([value, label]) => ({ value, label }));
      },
      setValue: (v) => (c.value = v),
      onChange: (fn) => (c.onChange = fn),
    }));
    return this._add(c);
  }
  addColorPicker(cb) {
    const c = { type: "color" };
    cb(builder(c, {
      setValue: (v) => (c.value = v),
      onChange: (fn) => (c.onChange = fn),
    }));
    return this._add(c);
  }
  addExtraButton(cb) {
    const c = { type: "extra-button" };
    cb(builder(c, {
      setIcon: (i) => (c.icon = i),
      setTooltip: (t) => (c.tooltip = t),
      onClick: (fn) => (c.onClick = fn),
    }));
    return this._add(c);
  }
  addButton(cb) {
    const c = { type: "button" };
    cb(builder(c, {
      setButtonText: (t) => (c.text = t),
      setIcon: (i) => (c.icon = i),
      setTooltip: (t) => (c.tooltip = t),
      onClick: (fn) => (c.onClick = fn),
    }));
    return this._add(c);
  }
  addText(cb) {
    const c = { type: "text" };
    cb(builder(c, {
      setPlaceholder: (p) => (c.placeholder = p),
      setValue: (v) => (c.value = v),
      onChange: (fn) => (c.onChange = fn),
    }));
    return this._add(c);
  }
  // Structural members the upstream body touches. They exist only so the code
  // runs; the renderer never reads them.
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  setHeading() {
    return this;
  }
  setClass() {
    return this;
  }
  clear() {
    this.spec.controls = [];
    return this;
  }
  then(fn) {
    fn(this);
    return this;
  }
  get components() {
    return [];
  }
  get settingEl() {
    return EL_STUB;
  }
  get controlEl() {
    return EL_STUB;
  }
  get nameEl() {
    return EL_STUB;
  }
  get descEl() {
    return EL_STUB;
  }
}

// Obsidian's createDiv/createSpan/createEl helpers, used by the few hand-written
// rows inside the schema for things a recorder cannot express (a colour row's
// cell wrapper, a hint span). Every one of them is a no-op here: the renderer
// derives that structure from the control spec instead.
const NOOP = () => NOOP_STUB;
const NOOP_STUB = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === "addClass" || prop === "toggleClass" || prop === "setCssStyles" || prop === "setText") return NOOP;
      if (prop === "style") return {};
      if (prop === "classList") return { add: NOOP, remove: NOOP, contains: () => false, toggle: NOOP };
      if (prop === "appendChild" || prop === "remove" || prop === "addEventListener") return NOOP;
      if (prop === "querySelector" || prop === "querySelectorAll") return () => null;
      if (prop === "lastElementChild" || prop === "firstElementChild") return null;
      if (prop === "empty") return true;
      if (prop === "children") return [];
      // Anything else is treated as a chainable element helper (createDiv,
      // createSpan, createEl, addClass, ...) returning a stub. The schema body
      // only uses these to build wrappers the renderer derives on its own, so a
      // no-op is the honest answer and an explicit undefined would just throw
      // on a call that upstream never made in this context.
      if (typeof prop === "string") return NOOP;
      return undefined;
    },
    set: () => true,
  }
);
const EL_STUB = NOOP_STUB;

// --- Recorder-backed replacements for the three `this.*` builders ----------
// Only row(), subheadingRow() and section() are called from inside
// lookDefinitions; they are the seam. `this.update()` becomes a rerender
// callback, and the DOM-only helpers (iconDesc, railRow, resetRow,
// resetLinkRow, rovingRow, onRefresh, needsHint) are reduced to the parts that
// carry meaning.

function makeSchemaHost({ rerender }) {
  return {
    update: rerender,
    onRefresh: () => {},
    iconDesc: (_icon, text) => text,
    // The effects rail: which effect is being inspected, and the row that
    // switches between them. The renderer shows the rail itself.
    _effectsPick: null,
    railRow: () => ({ type: "effects-rail", name: "", desc: "", depth: 0 }),
    rovingRow: () => ({ type: "roving", name: "", desc: "", depth: 0 }),
    resetRow: () => ({ type: "reset", name: "", desc: "", depth: 0 }),
    resetLinkRow: (title) => ({ type: "reset-link", title, name: "", desc: "", depth: 0 }),
    needsHint: () => {},
    section: (title, items) => ({ type: "section", title, items }),
    subheadingRow: (title, depth = 0) => ({ type: "subheading", title, depth }),
    row(name, desc, build, depth = 0) {
      // Upstream's `this.row` took a numeric depth, but the DSL factories in the
      // body call it with the whole { depth, when, needs } options object and
      // rely on it merely being truthy to mean "nested". Accept both, and take
      // the real number so the renderer can indent correctly. `when` and `needs`
      // are applied by those factories, not here.
      const d = typeof depth === "number" ? depth : depth?.depth ?? 0;
      const spec = { type: "row", name, desc, depth: d, controls: [] };
      if (build) build(new SettingRecorder(spec));
      return spec;
    },
  };
}

/**
 * Build the four look cards for one target - the global settings object, or a
 * single Vim mode's snapshot.
 *
 * @param target  object holding the look keys (settings, or settings.vimModes[mode])
 * @param get     (key) => current value
 * @param set     (key) => async onChange(value)
 * @param opts.rerender       called when a gated value changes and the visible rows change
 * @param opts.onEdit          called after any write, so the caller can drop its "unsaved preset" marker
 * @param opts.onTorchToggle   called after torchEffect changes, so the live engine can start/stop
 * @param opts.afterReset      called after a per-card reset
 */
export function lookDefinitions({ get, set, rerender = () => {}, onEdit = () => {}, onTorchToggle = () => {}, afterReset = () => {} }) {
  const host = makeSchemaHost({ rerender });

  const cards = lookDefinitionsInner({
    get,
    set,
    renderCursorStyleSetting: (setting, rerender2) => {
      // The renderer substitutes a live shape preview for this row; the dropdown
      // below is the fallback and the accessible control.
      setting.preview = "cursor-style";
      setting.addDropdown((d) =>
        d
          .addOption("Box", "Box")
          .addOption("Line", "Line")
          .addOption("Underline", "Underline")
          .setValue(get("cursorStyle"))
          .onChange(async (v) => {
            await set("cursorStyle")(v);
            rerender2();
          })
      );
    },
    renderTorchToggleSetting: (setting, rerender2) => {
      setting.preview = "torch";
      setting.addToggle((t) =>
        t.setValue(!!get("torchEffect")).onChange(async (v) => {
          await set("torchEffect")(v);
          onTorchToggle();
          rerender2();
        })
      );
    },
    afterReset,
    row: host.row,
    section: host.section,
    subheadingRow: host.subheadingRow,
    update: host.update,
    onRefresh: host.onRefresh,
    iconDesc: host.iconDesc,
    railRow: host.railRow,
    rovingRow: host.rovingRow,
    resetRow: host.resetRow,
    resetLinkRow: host.resetLinkRow,
    needsHint: host.needsHint,
    _effectsPick: host._effectsPick,
  });

  return cards;
}

export { DEFAULT_SETTINGS, RAIL_EFFECTS };

// The body below is upstream's, unchanged apart from `this.*` having become
// destructured parameters. Keep it that way: a hand-translated copy would drift.
function lookDefinitionsInner({
  get,
  set,
  renderCursorStyleSetting,
  renderTorchToggleSetting,
  afterReset,
  row: hostRow,
  section: hostSection,
  subheadingRow,
  update,
  onRefresh,
  iconDesc,
  railRow,
  rovingRow,
  resetRow,
  resetLinkRow,
  needsHint,
  _effectsPick,
  refreshDomState = update,
}) {

    const gates = /* @__PURE__ */ new Set();
    const cardKeys = { Appearance: [], Blinking: [], "Smooth movement": [], Effects: [] };
    let card = "Appearance";
    const owns = (key) => {
      if (!cardKeys[card].includes(key)) cardKeys[card].push(key);
    };
    const refresh = () => refreshDomState();
    const redraw = (key) => {
      gates.add(key);
      return async (v) => {
        const saved = set(key)(v);
        refresh();
        await saved;
      };
    };
    const rebuild = (key) => {
      gates.add(key);
      return async (v) => {
        const saved = set(key)(v);
        update();
        await saved;
      };
    };
    const afterWrite = (key) => {
      gates.add(key);
      owns(key);
      return refresh;
    };
    const resetCard = (title) => () => {
      const writes = cardKeys[title].map((key) => Promise.resolve(set(key)(DEFAULT_SETTINGS[key])));
      void Promise.all(writes).then(() => {
        if (afterReset) afterReset();
        update();
      });
    };
    const on = (key) => () => !!get(key);
    const off = (key) => () => !get(key);
    const all = (...ps) => () => ps.every((p) => p());
    const isStyle = (s) => () => get("cursorStyle") === s;
    const row = (name, desc, build, { depth = 0, when, needs } = {}) => {
      const effect = depth === 0 ? RAIL_EFFECTS.find((e) => e.name === name) : void 0;
      const def = hostRow(name, effect ? iconDesc(effect.icon, desc) : desc, (s) => {
        build(s);
        if (needs) needsHint(s, needs);
      }, depth);
      if (when) def.visible = when;
      return def;
    };
    // Every factory below knows the key it writes. Recording it on the controls
    // is what lets the renderer pair a nested block with the switch above it,
    // which is the only way 83 effect rows stay navigable.
    const withKey = (key, run) => {
      const def = run();
      for (const c of def.controls || []) if (!c.key) c.key = Array.isArray(key) ? undefined : key;
      return def;
    };
    const toggle = (name, desc, key, { depth = 0, gate = false, when, needs } = {}) => {
      owns(key);
      return withKey(key, () => hostRow(name, desc, (s) => {
        s.addToggle((t) => t.setValue(!!get(key)).onChange(gate ? redraw(key) : set(key)));
      }, { depth, when, needs }));
    };
    const dropdown = (name, desc, key, options, { depth = 0, value, onChange, when } = {}) => {
      owns(key);
      return withKey(key, () => hostRow(name, desc, (s) => {
        s.addDropdown((d) => d.addOptions(options).setValue(value !== void 0 ? value : get(key)).onChange(onChange || set(key)));
      }, { depth, when }));
    };
    const slider = (name, desc, key, [min, max, step2], { depth = 0, fallback, gate = false, when, needs } = {}) => {
      owns(key);
      return withKey(key, () => hostRow(name, desc, (s) => {
        const write = gate ? redraw(key) : set(key);
        let handle = null;
        s.addSlider((sl) => {
          handle = sl;
          sl.setLimits(min, max, step2).setValue(get(key) ?? fallback).onChange(write);
        }).addExtraButton((btn) => btn.setIcon("rotate-ccw").setTooltip(`Restore default (${DEFAULT_SETTINGS[key]})`).onClick(() => {
          const v = DEFAULT_SETTINGS[key];
          if (handle) handle.setValue(v);
          void write(v);
        }));
      }, { depth, when, needs }));
    };
    const swatchRow = (name, keys2, labels, desc, { depth = 0, when } = {}) => {
      keys2.forEach(owns);
      return hostRow(name, desc, (s) => {
        s.settingEl.addClass("cursor-smith-color-row");
        keys2.forEach((key, i) => {
          const cell = s.controlEl.createDiv({ cls: "cursor-smith-swatch-cell" });
          s.addColorPicker((cp) => cp.setValue(get(key) || DEFAULT_SETTINGS[key]).onChange(set(key)));
          const input = s.controlEl.lastElementChild;
          if (input && input !== cell) cell.appendChild(input);
          cell.createSpan({ cls: "cursor-smith-swatch-label", text: labels[i] ?? "" });
        });
      }, { depth, when });
    };
    const subheading = (title, depth, when) => {
      const def = subheadingRow(title, depth);
      def.visible = when;
      return def;
    };
    const appearance = [];
    appearance.push(row(
      "Cursor style",
      "The shape of the cursor itself.",
      (s) => renderCursorStyleSetting(s, afterWrite("cursorStyle"))
    ));
    const line = isStyle("Line"), underline = isStyle("Underline"), box = isStyle("Box");
    appearance.push(slider("Cursor thickness", "How thick the Line cursor is, in pixels.", "caretWidthPx", [1, 12, 1], { depth: 1, when: line }));
    appearance.push(toggle("Serifs", "Adds I-beam serifs at the top and bottom of the line.", "lineSerifs", { depth: 1, when: line }));
    appearance.push(slider(
      "Underline thickness",
      "Underline thickness in pixels. 0 fits the line height.",
      "underlineWidthPx",
      [0, 12, 1],
      { depth: 1, fallback: 0, when: underline }
    ));
    appearance.push(toggle(
      "Show letter inside cursor",
      "Shows the letter inside the block, colors flipped.",
      "showChar",
      { depth: 1, gate: true, when: box }
    ));
    appearance.push(dropdown(
      "Letter color",
      "Contrast: black or white. Tinted: the flipped color, kept legible. Inverted: a raw flip.",
      "glyphColorMode",
      { contrast: "Contrast", tinted: "Tinted", invert: "Inverted" },
      { depth: 2, value: get("glyphColorMode") || "contrast", when: all(box, on("showChar")) }
    ));
    appearance.push(toggle("Hollow", "Draws only the outline of the box instead of a filled block.", "boxHollow", { depth: 1, gate: true, when: box }));
    appearance.push(slider(
      "Outline width",
      "Thickness of the hollow box's outline, in pixels.",
      "boxHollowWidth",
      [1, 6, 1],
      { depth: 2, when: all(box, on("boxHollow")) }
    ));
    appearance.push(toggle("Gradient", "Blends several colors instead of one flat color.", "gradientEnabled", { gate: true }));
    const gradient = on("gradientEnabled");
    const writeCount = rebuild("gradientCount");
    appearance.push(dropdown(
      "Number of colors",
      "How many colors the blend runs through, from 2 to 4.",
      "gradientCount",
      { 2: "2", 3: "3", 4: "4" },
      {
        depth: 1,
        when: gradient,
        value: String(get("gradientCount") ?? 2),
        onChange: (v) => writeCount(Number(v))
      }
    ));
    const count = Math.max(2, Math.min(4, Number(get("gradientCount")) || 2));
    const keys = (prefix) => Array.from({ length: count }, (_, i) => prefix + (i + 1));
    for (let i = 1; i <= 4; i++) {
      owns("gradientDark" + i);
      owns("gradientLight" + i);
    }
    const stops = Array.from({ length: count }, (_, i) => String(i + 1));
    appearance.push(swatchRow(
      "Colors (dark theme)",
      keys("gradientDark"),
      stops,
      "From the top of the cursor to the bottom \u2014 or left to right for the Underline style.",
      { depth: 1, when: gradient }
    ));
    appearance.push(swatchRow(
      "Colors (light theme)",
      keys("gradientLight"),
      stops,
      "The same ramp for light themes, where neon colors tend to wash out.",
      { depth: 1, when: gradient }
    ));
    appearance.push(swatchRow(
      "Cursor color",
      ["colorDark", "colorLight"],
      ["Dark", "Light"],
      "One for each theme. Neon colors that look right on a dark background wash out on a white page.",
      { when: off("gradientEnabled") }
    ));
    appearance.push(slider("Cursor opacity", "How see-through the cursor is.", "cursorOpacity", [0.1, 1, 0.05]));
    appearance.push(toggle(
      "Translucent",
      "Blends the cursor into the page instead of painting over it.",
      "cursorTranslucent"
    ));
    appearance.push(toggle(
      "Rounded corners",
      "Softens the corners: rounded bars for Line and Underline, a gentle curve for Box.",
      "cursorRounded"
    ));
    card = "Blinking";
    const blinking = [];
    blinking.push(toggle("Blinking", "Makes the cursor blink.", "blinkingEnabled", { gate: true }));
    const blink = on("blinkingEnabled");
    blinking.push(slider("Blink speed", "How fast the cursor blinks.", "blinkSpeed", [0.1, 3, 0.1], { depth: 1, when: blink }));
    blinking.push(slider("Blink balance", "How the blink cycle is split between lit and dark.", "blinkOnOffBalance", [0.1, 0.9, 0.05], { depth: 1, when: blink }));
    blinking.push(slider("Fade smoothness", "How gradually the cursor fades in and out.", "blinkFade", [0.05, 0.5, 0.05], { depth: 1, fallback: 0.15, when: blink }));
    blinking.push(toggle("Don't blink while typing", "Keeps the cursor fully lit while you type or move it.", "smoothStopBlinking", { depth: 1, when: blink }));
    blinking.push(slider("Blink delay", "How long the cursor stays lit after a keystroke, in ms.", "blinkDelayMs", [0, 2e3, 50], { depth: 1, fallback: 0, when: blink }));
    blinking.push(slider("Stop after", "Blink this many times after each move, then stay lit. 0 blinks forever.", "blinkStopAfter", [0, 20, 1], { depth: 1, fallback: 0, when: blink }));
    blinking.push(toggle("Breathing", "The cursor swells and shrinks instead of fading out.", "blinkBreathing", { depth: 1, gate: true, when: blink }));
    blinking.push(slider(
      "Breath depth",
      "How far the cursor shrinks at the bottom of the breath.",
      "blinkBreathDepth",
      [0.05, 0.5, 0.05],
      { depth: 2, fallback: 0.2, when: all(blink, on("blinkBreathing")) }
    ));
    card = "Smooth movement";
    const smooth = [];
    smooth.push(toggle("Smooth movement", "The cursor glides to its new spot instead of jumping.", "smoothEnabled", { gate: true }));
    const gliding = on("smoothEnabled");
    smooth.push(slider("Glide amount", "How much the cursor eases as it travels.", "smoothness", [0.05, 0.3, 0.05], { depth: 1, when: gliding }));
    smooth.push(slider("Catch-up speed", "How quickly the cursor chases the real caret.", "catchUpSpeed", [0.3, 0.8, 0.05], { depth: 1, when: gliding }));
    smooth.push(toggle("Speed up when typing fast", "Goes past Catch-up speed while you type, so it never falls behind.", "smoothAdaptive", { depth: 1, gate: true, when: gliding }));
    smooth.push(slider(
      "Max catch-up speed",
      "The fastest the speed-up is allowed to get.",
      "maxCatchUpSpeed",
      [0.5, 1, 0.05],
      { depth: 2, when: all(gliding, on("smoothAdaptive")) }
    ));
    smooth.push(slider("Movement delay", "Delay before the cursor sets off, in ms. 0 follows immediately.", "moveDelayMs", [0, 500, 10], { depth: 1, when: gliding }));
    card = "Effects";
    const effects = [];
    const pick = () => {
      if (_effectsPick) return _effectsPick;
      const first = RAIL_EFFECTS.find((e) => !!get(e.key));
      return first ? first.key : RAIL_EFFECTS[0].key;
    };
    const shown = (key) => () => {
      const p = pick();
      return p === "all" || p === key;
    };
    effects.push(railRow(get, pick, (key) => {
      _effectsPick = key;
      refresh();
    }));
    const needsGradient = { when: gradient, hint: "Needs Gradient, in Appearance." };
    const needsBlink = { when: on("blinkingEnabled"), hint: "Needs Blinking." };
    const showPop = shown("popEffects");
    effects.push(toggle("Pop effects", "Letters, lightning and fireworks thrown off as you type.", "popEffects", { gate: true, when: showPop }));
    const pop = all(showPop, on("popEffects"));
    effects.push(toggle("Popping letters", "Each letter you type springs out of the cursor and tumbles away.", "popLetters", { depth: 1, gate: true, when: pop }));
    effects.push(toggle(
      "Backspace disintegration",
      "Deleting throws a burst outward in flipped colors.",
      "backspaceDisintegrate",
      { depth: 1, gate: true, when: pop }
    ));
    effects.push(toggle("Thunderstrike", "Enter calls down a bolt of pixelated lightning onto the new line.", "thunderstrike", { depth: 1, gate: true, when: pop }));
    effects.push(slider("Bolt size", "How fine the lightning is, in pixels per block.", "thunderstrikeSize", [1, 5, 1], { depth: 2, fallback: 2, when: all(pop, on("thunderstrike")) }));
    effects.push(slider(
      "Bolt strength",
      "How bright the strike is.",
      "thunderstrikeStrength",
      [0.1, 1, 0.05],
      { depth: 2, fallback: 0.5, when: all(pop, on("thunderstrike")) }
    ));
    effects.push(toggle("Fireworks", "Space and Enter send shells up from the cursor to burst above it.", "fireworks", { depth: 1, gate: true, when: pop }));
    effects.push(slider("Quantity", "How many shells go up per keypress, and how much each throws.", "fireworksQuantity", [0.2, 3, 0.1], { depth: 2, fallback: 1, when: all(pop, on("fireworks")) }));
    const anyPop = () => pop() && (!!get("popLetters") || !!get("backspaceDisintegrate") || !!get("thunderstrike") || !!get("fireworks"));
    effects.push(toggle("Rainbow", "Sweeps every pop effect around the color wheel as you type.", "popRainbow", { depth: 1, when: anyPop }));
    const showTrail = shown("flameTrail");
    effects.push(toggle("Pixel trail", "A puff of colored pixels wherever the cursor has just been.", "flameTrail", { gate: true, when: showTrail }));
    const trail = all(showTrail, on("flameTrail"));
    effects.push(slider("Pixel density", "How many pixels the trail sheds. 0 hides them entirely.", "flameTrailDensity", [0, 3, 0.1], { depth: 1, fallback: 1, when: trail }));
    effects.push(toggle("Trail on jump", "Lays pixels along the whole path of a jump, not just at the start.", "flameTrailOnJump", { depth: 1, when: trail }));
    effects.push(slider("Pixel lifetime", "How long each pixel lasts before it fades out, in milliseconds.", "flameTrailLifeMs", [100, 2e3, 50], { depth: 1, fallback: 400, when: trail }));
    effects.push(slider("Pixel size", "How big each pixel is.", "flameTrailPixelSize", [1, 12, 0.5], { depth: 1, fallback: 4, when: trail }));
    effects.push(toggle("Gradient colors", "Colors the pixels from the cursor's gradient.", "flameTrailGradientColors", { depth: 1, when: trail, needs: needsGradient }));
    effects.push(slider("Gravity", "A steady pull on the pixels. 0 leaves them drifting sideways.", "flameTrailGravity", [0, 1, 0.05], { depth: 1, fallback: 0, gate: true, when: trail }));
    effects.push(slider(
      "Gravity direction",
      "Where the pull goes, in degrees: 0 down, 90 right, 180 up, 270 left.",
      "flameTrailGravityAngle",
      [0, 359, 5],
      { depth: 2, fallback: 0, when: () => trail() && (get("flameTrailGravity") ?? 0) > 0 }
    ));
    const showStardust = shown("stardustEnabled");
    effects.push(toggle("Stardust", "A slow stream of floating pixels that drift up and fade.", "stardustEnabled", { gate: true, when: showStardust }));
    const stardust = all(showStardust, on("stardustEnabled"));
    effects.push(toggle("Always on", "Streams continuously instead of waiting for the cursor to settle.", "stardustAlwaysOn", { depth: 1, gate: true, when: stardust }));
    effects.push(slider(
      "Idle delay",
      "How long the cursor sits still before the stardust starts, in ms.",
      "stardustDelayMs",
      [500, 8e3, 250],
      { depth: 1, fallback: 2e3, when: all(stardust, off("stardustAlwaysOn")) }
    ));
    effects.push(slider("Stardust density", "How thickly the stardust streams off the cursor.", "stardustRate", [0.2, 3, 0.1], { depth: 1, fallback: 1, when: stardust }));
    effects.push(toggle("Orbit", "Motes circle the cursor like fireflies instead of drifting up.", "stardustOrbit", { depth: 1, gate: true, when: stardust }));
    effects.push(slider("Orbit radius", "How wide the motes circle, in pixels.", "stardustOrbitRadius", [10, 60, 2], { depth: 2, fallback: 22, when: all(stardust, on("stardustOrbit")) }));
    const showTether = shown("bracketTether");
    effects.push(toggle("Bracket tether", "Underlines the span between matching brackets or quotes.", "bracketTether", { gate: true, when: showTether }));
    effects.push(slider("Tether strength", "How visible the line is.", "bracketTetherStrength", [0.1, 1, 0.05], { depth: 1, fallback: 0.35, when: all(showTether, on("bracketTether")) }));
    const showSmear = shown("smear");
    effects.push(toggle("Motion smear", "The cursor stretches as it moves and snaps back when it arrives.", "smear", { gate: true, when: showSmear }));
    const smear = all(showSmear, on("smear"));
    effects.push(slider("Stiffness", "How hard the leading edge is pulled toward the new position.", "smearStiffness", [0.1, 1, 0.05], { depth: 1, when: smear }));
    effects.push(slider("Trailing stiffness", "The same for the edge left behind.", "smearTrailingStiffness", [0.05, 1, 0.05], { depth: 1, when: smear }));
    effects.push(slider("Damping", "How much the leading edge resists overshooting.", "smearDamping", [0.05, 1, 0.05], { depth: 1, when: smear }));
    effects.push(toggle("Tapered trail", "Narrows the smear to a point behind the cursor, like a comet tail.", "smearTaper", { depth: 1, gate: true, when: smear }));
    effects.push(slider("Taper amount", "How sharply the tail closes. At 1 it comes to a full point.", "smearTaperAmount", [0.1, 1, 0.05], { depth: 2, fallback: 0.7, when: all(smear, on("smearTaper")) }));
    effects.push(slider("Max length", "How far the tail may trail, in pixels. 0 is no limit.", "smearMaxLength", [0, 400, 10], { depth: 1, fallback: 0, when: smear }));
    effects.push(toggle("Conserve area", "A jump to another line thins as it stretches, keeping its area.", "smearConserveVolume", { depth: 1, gate: true, when: smear }));
    effects.push(slider("Thinning", "How strongly the area is held. At 1, twice as long is half as wide.", "smearVolumeStrength", [0.1, 1, 0.05], { depth: 2, fallback: 0.3, when: all(smear, on("smearConserveVolume")) }));
    const showEnergy = shown("energyEffect");
    effects.push(toggle("Energy beam", "A pulse of light along the cursor; with Gradient on, it scrolls your colors.", "energyEffect", { gate: true, when: showEnergy }));
    const energy = all(showEnergy, on("energyEffect"));
    effects.push(slider("Beam speed", "How fast the pulse travels along the cursor.", "energySpeed", [0.2, 3, 0.1], { depth: 1, when: energy }));
    effects.push(toggle("Aurora", "Swirls your gradient colors instead of scrolling them past.", "energyAurora", { depth: 1, gate: true, when: energy, needs: needsGradient }));
    effects.push(slider("Waviness", "How hard the bands bend. 0 keeps them flat.", "energyAuroraWaviness", [0, 2, 0.05], { depth: 2, fallback: 1, when: all(energy, on("energyAurora")), needs: needsGradient }));
    const showCrt = shown("crtEffect");
    effects.push(toggle("CRT effects", "Old-monitor phosphor look: the cursor leaves fading ghosts behind it.", "crtEffect", { gate: true, when: showCrt }));
    const crt = all(showCrt, on("crtEffect"));
    effects.push(slider("Trail length", "How many ghosts are kept behind the cursor. 0 leaves none.", "trailLength", [0, 30, 1], { depth: 1, when: crt }));
    effects.push(slider("Trail fade time", "How long (in ms) each ghost takes to fade out.", "trailFadeMs", [50, 1500, 25], { depth: 1, when: crt }));
    effects.push(toggle("Glow", "A soft halo around the cursor in its own color.", "glow", { depth: 1, when: crt }));
    effects.push(toggle("Neon trail", "Renders the ghosts as a glowing neon tube instead of fading boxes.", "crtNeon", { depth: 1, gate: true, when: crt }));
    effects.push(toggle("Gradient trail", "Runs the cursor's gradient along the streak, newest ghost to oldest.", "crtNeonGradient", { depth: 2, when: all(crt, on("crtNeon")), needs: needsGradient }));
    effects.push(toggle("Signal glitch", "Long jumps break up like a mistracked video signal.", "crtGlitch", { depth: 1, gate: true, when: crt }));
    const glitch = all(crt, on("crtGlitch"));
    effects.push(slider("Break-up", "How far the slices are thrown and how much the cursor's shape warps.", "crtGlitchStrength", [0.2, 2.5, 0.1], { depth: 2, fallback: 1, when: glitch }));
    effects.push(slider("Color split", "How far the color channels separate. 0 only tears the shape.", "crtGlitchAberration", [0, 3, 0.1], { depth: 2, fallback: 1, when: glitch }));
    effects.push(slider("Duration", "How long each burst lasts, in milliseconds.", "crtGlitchMs", [60, 600, 10], { depth: 2, fallback: 220, when: glitch }));
    const showDemon = shown("speedDemon");
    effects.push(toggle("Speed demon", "Heats from gray to white-hot as you type, cools when you stop.", "speedDemon", { gate: true, when: showDemon }));
    const demon = all(showDemon, on("speedDemon"));
    effects.push(toggle("Fire sparks", "Throws embers off the cursor once it is hot enough.", "speedDemonSparks", { depth: 1, gate: true, when: demon }));
    const sparks = all(demon, on("speedDemonSparks"));
    effects.push(slider("Spark quantity", "How many embers per burst. 0 stops them.", "speedDemonSparkQuantity", [0, 3, 0.1], { depth: 2, fallback: 1, when: sparks }));
    effects.push(slider("Spark trail", "Gives each spark a fading comet tail, in pixels. 0 = no trail.", "speedDemonSparkTrail", [0, 30, 1], { depth: 2, fallback: 0, when: sparks }));
    effects.push(toggle("Keep cursor color", "The cursor keeps your color; only the sparks react to speed.", "speedDemonNoCursorHeat", { depth: 1, gate: true, when: demon }));
    effects.push(slider("Sensitivity", "How fast typing and caret movement heat the cursor up.", "speedDemonSensitivity", [0.5, 2, 0.1], { depth: 1, when: demon }));
    const heatRamp = all(demon, off("speedDemonNoCursorHeat"));
    effects.push(toggle("Custom gradient", "Replaces the built-in heat curve with four colors of your own.", "speedDemonGradient", { depth: 1, gate: true, when: heatRamp }));
    const stages = all(heatRamp, on("speedDemonGradient"));
    const heat = (prefix) => [1, 2, 3, 4].map((i) => prefix + i);
    const stageLabels = ["Warm", "Hot", "Hotter", "Flat out"];
    effects.push(swatchRow(
      "Stages (dark theme)",
      heat("speedHeatDark"),
      stageLabels,
      "Warming to flat out. At rest the cursor keeps its own color.",
      { depth: 2, when: stages }
    ));
    effects.push(swatchRow(
      "Stages (light theme)",
      heat("speedHeatLight"),
      stageLabels,
      "The same four stages for light themes, where a white-hot final stage disappears into the page.",
      { depth: 2, when: stages }
    ));
    const showHot = shown("hotHead");
    effects.push(toggle("Hot-head", "Sets the text you're working on alight.", "hotHead", { gate: true, when: showHot }));
    const hot = all(showHot, on("hotHead"));
    effects.push(slider("Fire quantity", "How much fire. 0 puts it out.", "hotHeadQuantity", [0, 3, 0.1], { depth: 1, fallback: 1, when: hot }));
    effects.push(slider("Fire spread", "How many characters around the cursor catch. 0 burns only its own column.", "hotHeadSpread", [0, 14, 1], { depth: 1, fallback: 4, when: hot }));
    effects.push(slider("Trail over text", "Fire left along the path. 0 keeps it where the cursor stops.", "hotHeadTrail", [0, 30, 1], { depth: 1, fallback: 6, when: hot }));
    effects.push(slider("Flame height", "How high the flames climb before they burn out.", "hotHeadHeight", [0.15, 1.5, 0.05], { depth: 1, fallback: 0.55, when: hot }));
    effects.push(slider("Fade time", "How long a single fire particle lasts, in milliseconds.", "hotHeadFade", [200, 1600, 20], { depth: 1, fallback: 620, when: hot }));
    effects.push(slider("Idle timeout", "Idle time before the fire burns out. 0 keeps it burning forever.", "hotHeadIdleMs", [0, 6e3, 100], { depth: 1, fallback: 1500, when: hot }));
    effects.push(slider("Fire opacity", "How solid the fire is, independent of the cursor's own opacity.", "hotHeadOpacity", [0.1, 1, 0.05], { depth: 1, fallback: 1, when: hot }));
    effects.push(toggle("Use cursor color", "Paints the fire in the cursor's color instead of the heat gradient.", "hotHeadFlat", { depth: 1, gate: true, when: hot }));
    effects.push(toggle(
      "Heat with speed demon",
      "The fire warms up as you type, following Speed demon's heat.",
      "hotHeadSpeedHeat",
      { depth: 2, when: all(hot, on("hotHeadFlat")), needs: { when: on("speedDemon"), hint: "Needs Speed demon." } }
    ));
    const showTorch = shown("torchEffect");
    effects.push(row(
      "Torch spotlight",
      "Darkens everything except a pool of light around the cursor.",
      (s) => renderTorchToggleSetting(s, afterWrite("torchEffect")),
      { when: showTorch }
    ));
    const torch = all(showTorch, on("torchEffect"));
    effects.push(subheading("Spotlight", 1, torch));
    effects.push(dropdown(
      "Follow",
      "What the light tracks.",
      "overlayFollowMode",
      { caret: "Text cursor only", mouse: "Mouse pointer only", auto: "Auto intelligent swap" },
      { depth: 1, when: torch }
    ));
    effects.push(slider("Light size", "How far the lit circle reaches, in pixels.", "overlayRadius", [100, 800, 10], { depth: 1, when: torch }));
    effects.push(toggle("Sync with blink", "The light closes as the cursor blinks out and opens as it returns.", "overlayBlinkSync", { depth: 1, gate: true, when: torch, needs: needsBlink }));
    effects.push(slider(
      "Pulse depth",
      "How far the light closes at its darkest. At 1 it goes out.",
      "overlayBlinkDepth",
      [0.05, 1, 0.05],
      { depth: 2, fallback: 0.25, when: all(torch, on("overlayBlinkSync")), needs: needsBlink }
    ));
    owns("overlayColor");
    effects.push(row(
      "Light color",
      "The color of the light at its center.",
      (s) => {
        s.addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor")));
      },
      { depth: 1, when: torch }
    ));
    effects.push(slider("Follow speed", "How quickly the light catches up when the cursor moves.", "overlaySpeed", [0.05, 1, 0.05], { depth: 1, when: torch }));
    effects.push(subheading("Environment", 1, torch));
    effects.push(slider("Darkness", "How far everything outside the light is dimmed.", "overlayDarkness", [0.2, 1, 0.01], { depth: 1, when: torch }));
    effects.push(slider("Glow strength", "Strength of the warm glow. 0 gives a pure spotlight.", "overlayIntensity", [0, 1, 0.05], { depth: 1, when: torch }));
    effects.push(toggle("Flicker", "The light gutters like a candle.", "overlayFlicker", { depth: 1, gate: true, when: torch }));
    effects.push(slider(
      "Flicker depth",
      "How far the flame swings. At 1 it gutters right out.",
      "overlayFlickerAmount",
      [0.05, 1, 0.05],
      { depth: 2, fallback: 0.35, when: all(torch, on("overlayFlicker")) }
    ));
    effects.push(toggle("Keep sidebars lit", "Darkens every note tab; sidebars, ribbon and other views stay lit. Desktop only.", "overlaySpareSidebars", { depth: 1, when: torch }));
    appearance.push(resetLinkRow("Appearance", resetCard("Appearance")));
    blinking.push(resetLinkRow("Blinking", resetCard("Blinking")));
    smooth.push(resetLinkRow("Smooth movement", resetCard("Smooth movement")));
    effects.push(resetLinkRow("Effects", resetCard("Effects")));
    const summaries = {
      Appearance: () => {
        const parts = [String(get("cursorStyle") || "Box")];
        if (get("gradientEnabled")) parts.push("gradient");
        if (get("cursorTranslucent")) parts.push("translucent");
        if (get("cursorStyle") === "Box" && get("showChar")) parts.push("letter inside");
        if (get("cursorRounded")) parts.push("rounded");
        return parts.join(" \xB7 ");
      },
      Blinking: () => get("blinkingEnabled") ? `On \xB7 ${Number(get("blinkSpeed") ?? 1).toFixed(1)}\xD7` + (get("blinkBreathing") ? " \xB7 breathing" : "") : "Off",
      "Smooth movement": () => get("smoothEnabled") ? "On" : "Off",
      // Every effect that is on, by name; Obsidian ellipsizes a long one.
      Effects: () => {
        const on2 = RAIL_EFFECTS.filter((e) => !!get(e.key));
        return on2.length ? on2.map((e) => e.name).join(" \xB7 ") : "Off";
      }
    };
    const cards = [
      hostSection("Appearance", appearance),
      hostSection("Blinking", blinking),
      hostSection("Smooth movement", smooth),
      hostSection("Effects", effects)
    ];
    cards.gates = gates;
    cards.cardKeys = cardKeys;
    cards.summaries = summaries;
    cards.effectsOn = () => RAIL_EFFECTS.filter((e) => !!get(e.key));
    return cards;}

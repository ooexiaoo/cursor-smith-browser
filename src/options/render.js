// Renders the look schema into DOM.
//
// The schema from look-schema.js is plain data: rows with a name, a description,
// a nesting depth, and controls carrying their own value and onChange. Nothing
// here knows what a cursor is. It draws rows, wires controls, and applies the
// `visible` predicate the schema attached to anything gated.
//
// Gating is the one piece of real logic. When a gate flips, the affected rows
// have to appear or disappear, and re-rendering the whole panel would be both
// slow and wrong - it would rebuild the slider the user is currently dragging.
// So a gate change re-runs the schema and diffs the result against the rows
// already on screen, toggling `hidden` on the ones that changed. Rows keep their
// DOM, so a slider keeps its drag, its focus and its value.

import { h, clear } from "./dom.js";
import { iconSvg } from "./icons.js";
import { RAIL_EFFECTS } from "./rail.js";

const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)))) : String(v));

// --- controls ---------------------------------------------------------------
//
// Each one installs a `ctl.impl` and immediately replays onto it whatever the
// schema already recorded, so a control is built once, in one place, with no
// second pass over the spec.

function renderToggle(ctl) {
  const input = h("input", { type: "checkbox", class: "cs-switch-input" });
  const label = h("label", { class: "cs-switch" }, input, h("span", { class: "cs-switch-track" }, h("span", { class: "cs-switch-thumb" })));
  ctl.impl = {
    setValue: (v) => (input.checked = !!v),
    onChange: (fn) => input.addEventListener("change", () => fn(input.checked)),
  };
  ctl.impl.setValue(ctl.value);
  ctl.impl.onChange(ctl.onChange);
  return label;
}

function renderSlider(ctl) {
  const input = h("input", { type: "range", class: "cs-range" });
  const out = h("output", { class: "cs-range-value" });
  ctl.impl = {
    setLimits: (min, max, step) => {
      input.min = min;
      input.max = max;
      input.step = step;
    },
    setValue: (v) => {
      input.value = v;
      out.textContent = fmt(v);
    },
    onChange: (fn) =>
      input.addEventListener("input", () => {
        out.textContent = fmt(Number(input.value));
        fn(Number(input.value));
      }),
  };
  ctl.impl.setLimits(ctl.min, ctl.max, ctl.step);
  ctl.impl.setValue(ctl.value);
  ctl.impl.onChange(ctl.onChange);
  return h("div", { class: "cs-control-stack" }, input, out);
}

function renderDropdown(ctl) {
  const sel = h("select", { class: "cs-select" });
  for (const o of ctl.options) sel.append(h("option", { value: o.value }, o.label));
  ctl.impl = {
    addOption: (v, label) => sel.append(h("option", { value: v }, label)),
    addOptions: (opts) => Object.entries(opts || {}).forEach(([v, label]) => sel.append(h("option", { value: v }, label))),
    setValue: (v) => (sel.value = v),
    onChange: (fn) => sel.addEventListener("change", () => fn(sel.value)),
  };
  ctl.impl.setValue(ctl.value);
  ctl.impl.onChange(ctl.onChange);
  return h("div", { class: "cs-control-wrap" }, sel, h("span", { class: "cs-chevron", html: iconSvg("chevron-down", { size: 14 }) }));
}

function renderColor(ctl) {
  const input = h("input", { type: "color", class: "cs-color-input" });
  const hex = h("span", { class: "cs-color-hex" });
  ctl.impl = {
    setValue: (v) => {
      input.value = normaliseHex(v);
      hex.textContent = String(v).toUpperCase();
    },
    onChange: (fn) => input.addEventListener("input", () => fn(input.value)),
  };
  ctl.impl.setValue(ctl.value);
  ctl.impl.onChange(ctl.onChange);
  return h("div", { class: "cs-control-wrap" }, h("span", { class: "cs-color" }, input), hex);
}

function renderExtraButton(ctl) {
  const btn = h("button", { class: "cs-icon-btn", type: "button", title: ctl.tooltip || "" }, h("span", { html: iconSvg(ctl.icon || "rotate-ccw", { size: 15 }) }));
  ctl.impl = {
    setIcon: (i) => (btn.firstChild.innerHTML = iconSvg(i, { size: 15 })),
    setTooltip: (t) => (btn.title = t),
    onClick: (fn) => btn.addEventListener("click", fn),
  };
  ctl.impl.setIcon(ctl.icon || "rotate-ccw");
  ctl.impl.setTooltip(ctl.tooltip || "");
  if (ctl.onClick) ctl.impl.onClick(ctl.onClick);
  return btn;
}

function renderButton(ctl) {
  const label = h("span", {}, ctl.text);
  const btn = h("button", { class: "cs-btn", type: "button" }, ctl.icon ? h("span", { html: iconSvg(ctl.icon, { size: 14 }) }) : null, label);
  ctl.impl = {
    setButtonText: (t) => (label.textContent = t),
    setIcon: (i) => (btn.firstChild.innerHTML = iconSvg(i, { size: 14 })),
    onClick: (fn) => btn.addEventListener("click", fn),
  };
  if (ctl.onClick) ctl.impl.onClick(ctl.onClick);
  return btn;
}

// A toggle row owns the nested block under it, and the key it writes is the one
// the schema recorded on that toggle. That pairing is what lets a depth-1 run
// collapse with the switch above it.
function gateKeyOf(item) {
  const toggle = (item.controls || []).find((c) => c.type === "toggle");
  return toggle?.key ?? null;
}

const CONTROL_RENDERERS = { toggle: renderToggle, slider: renderSlider, dropdown: renderDropdown, color: renderColor, "extra-button": renderExtraButton, button: renderButton };
const renderControl = (ctl) => (CONTROL_RENDERERS[ctl.type] || (() => h("span")))(ctl);

// Obsidian accepts "#abc" and "rgb(...)"; <input type=color> only takes #rrggbb.
function normaliseHex(v) {
  const s = String(v || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  const m = s.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (m) return "#" + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, "0")).join("");
  return "#ffffff";
}

// --- rows -------------------------------------------------------------------

function renderRow(spec, ctx) {
  switch (spec.type) {
    case "effects-rail":
      return renderRail(ctx);
    case "subheading":
      return h("div", { class: "cs-subheading", style: { paddingLeft: spec.depth * 20 + "px" } }, spec.title);
    case "reset-link": {
      const btn = h("button", { class: "cs-reset-link", type: "button" },
        h("span", { html: iconSvg("rotate-ccw", { size: 13 }) }),
        h("span", {}, "Reset ", spec.title.toLowerCase()));
      btn.addEventListener("click", () => ctx.resetCard(spec.title));
      return btn;
    }
    default:
      break;
  }
  const row = h("div", { class: "cs-row" + (spec.depth ? " cs-row-nested" : ""), "data-name": spec.name });
  row.style.setProperty("--depth", spec.depth || 0);
  row.append(
    h("div", { class: "cs-row-text" },
      h("div", { class: "cs-row-name" }, spec.name),
      spec.desc ? h("div", { class: "cs-row-desc" }, spec.desc) : null),
    h("div", { class: "cs-row-controls" }, (spec.controls || []).map(renderControl)));
  return row;
}

function renderRail(ctx) {
  const rail = h("div", { class: "cs-rail" });
  const inputs = new Map();
  for (const e of RAIL_EFFECTS) {
    const input = h("input", { type: "checkbox", class: "cs-switch-input" });
    input.checked = !!ctx.get(e.key);
    // Each rail switch is a gate for the block of rows below it, so it has to
    // drive the same visibility pass a schema row would.
    input.addEventListener("change", () => ctx.set(e.key)(input.checked).then(() => ctx.rerender?.()));
    inputs.set(e.key, input);
    rail.append(
      h("button", { class: "cs-chip", type: "button", title: e.desc, "data-key": e.key, on: { click: () => input.click() } },
        h("span", { class: "cs-chip-icon", html: iconSvg(e.icon, { size: 15 }) }),
        h("span", { class: "cs-chip-name" }, e.name),
        h("span", { class: "cs-switch cs-switch-sm" }, input, h("span", { class: "cs-switch-track" }, h("span", { class: "cs-switch-thumb" })))));
  }
  rail._sync = () => inputs.forEach((input, k) => (input.checked = !!ctx.get(k)));
  return rail;
}

// --- panel ------------------------------------------------------------------

/**
 * A rendered look panel, kept across gate changes.
 *
 * `build` is the schema function; it is called with the same accessors the
 * options page uses, and its output is turned into DOM on the first call. Later
 * calls only diff.
 */
export function createLookPanel(root, { build, get, set, onEdit, onTorchToggle, afterReset }) {
  const ctx = {
    get,
    set: (k) => async (v) => {
      await set(k)(v);
      onEdit?.(k, v);
      if (k === "torchEffect") onTorchToggle?.(v);
    },
    resetCard: (title) => afterReset?.(title),
  };
  // Every gate in the panel (schema rows and effects-rail chips alike) ends up
  // here after a write, to re-run the visibility pass. Assigned once the
  // function exists so the rail can reach it.
  ctx.rerender = () => rerender();
  const cards = [];
  const rows = new Map(); // row name -> element, for the diff
  const groups = new Map(); // top-level row name -> its nested rows
  const rails = [];
  let lastSchema = [];

  // The schema's own `rerender` is what every gated control calls when it needs
  // the visible set recomputed. Route it through the diff.
  const schemaCtx = { get, set: ctx.set, rerender, onEdit: (k, v) => onEdit?.(k, v), onTorchToggle, afterReset };

  function draw() {
    const next = build(schemaCtx);
    lastSchema = next;
    const railHost = h("div", { class: "cs-rail-host" });
    clear(root);
    // A full redraw (after a card reset, or a settings import) rebuilds every
    // node, so the maps that point at the old ones have to go too. Stale
    // entries would make rerender() poke detached nodes and quietly stop
    // updating anything on screen.
    cards.length = 0;
    rows.clear();
    groups.clear();
    rails.length = 0;
    for (const card of next) {
      const summary = h("span", { class: "cs-card-summary" });
      const el = h("section", { class: "cs-card", "data-card": card.title },
        h("header", { class: "cs-card-head" },
          h("div", { class: "cs-card-titles" }, h("h2", { class: "cs-card-title" }, card.title), summary)),
        h("div", { class: "cs-card-body" }));
      const body = el.querySelector(".cs-card-body");
      // Upstream shows all 83 effects rows at once and relies on indentation to
      // say what belongs to what. That is a wall of settings. So the depth-1 run
      // under each top-level row collapses with that row's switch: still all
      // there, just not all open at once.
      let parent = null;
      for (const item of card.items) {
        const node = renderRow(item, ctx);
        if (item.type === "row") {
          rows.set(item.name, node);
          node._gated = !!item.visible;
          if (item.visible) node.hidden = !item.visible();
          if (!item.depth) {
            parent = (item.controls || []).some((c) => c.type === "toggle") ? item : null;
            if (parent) groups.set(parent.name, { rows: [], gate: gateKeyOf(item) });
          } else if (parent) {
            node.dataset.parent = parent.name;
            groups.get(parent.name).rows.push(node);
          }
        }
        if (item.type === "effects-rail") rails.push(node);
        body.append(node);
      }
      el._summary = () => {
        const s = card.summaries?.[card.title]?.() || "";
        summary.textContent = s;
        summary.hidden = !s;
      };
      el._summary();
      root.append(el);
      cards.push(el);
    }
    rails.forEach((r) => r._sync());
    syncGroups();
    root.append(railHost);
  }

  // Show or hide each nested block to match its parent's switch.
  function syncGroups() {
    for (const [, group] of groups) {
      if (!group.gate) continue;
      const open = !!ctx.get(group.gate);
      for (const kid of group.rows) if (!kid._gated) kid.hidden = !open;
    }
  }

  // A gate flipped. Re-run the schema for the new visible set, then apply it
  // without touching anything else's DOM.
  function rerender() {
    const next = build(schemaCtx);
    for (const card of next) {
      const el = cards.find((c) => c.dataset.card === card.title);
      if (!el) return draw(); // shape changed; a full redraw is simpler and rare
      el._summary();
      for (const item of card.items) {
        if (item.type !== "row") continue;
        const row = rows.get(item.name);
        if (!row) continue;
        row._gated = !!item.visible;
        row.hidden = !(!item.visible || item.visible());
      }
    }
    syncGroups();
    rails.forEach((r) => r._sync());
  }

  draw();
  return {
    rerender,
    redraw: draw,
    // Which keys each card owns, so a per-card reset can restore exactly those.
    cardKeys: () => lastSchema.cardKeys || {},
  };
}

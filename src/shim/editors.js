// What kind of thing is the user typing into?
//
// Two questions the ported engine keeps asking, which Obsidian answered with
// its own object model and a browser has to answer from the DOM:
//
//   isRichEditorHost  - a full text editor (CodeMirror, Monaco, Ace, ...),
//                       which is where Vim cursor modes are meaningful.
//   siteKind          - coarse origin classification, used to decide whether
//                       this extension should draw at all and which palette
//                       to render on.

// Surfaces that host a real editor rather than a single-line form field.
const RICH_EDITOR_SELECTORS = [
  ".cm-editor", // CodeMirror 6
  ".CodeMirror", // CodeMirror 5
  ".monaco-editor", // Monaco
  ".monaco-workbench", // Monaco, outer wrapper
  ".ace_editor", // Ace
  ".ProseMirror", // ProseMirror / Slate
  ".monaco-workbench .overflow-guard", // Monaco scroller
];

// Our own injected layer. Never treat it as a text host, and never let the
// engine measure inside it - it is a canvas, so there is nothing to measure,
// but a caret parked on a canvas wrapper would still draw.
const OWN_SELECTORS = [
  ".cursor-smith-wrapper",
  ".cursor-smith-torch-glow",
  ".cursor-smith-toasts",
  ".cursor-smith-toast",
  "#cursor-smith-dynamic-styles",
];

export const isOwnElement = (el) => !!el?.closest?.(OWN_SELECTORS.join(","));

export function isRichEditorHost(el) {
  if (!el || el.nodeType !== 1) return false;
  try {
    return !!el.closest(RICH_EDITOR_SELECTORS.join(","));
  } catch {
    return false;
  }
}

// Hosts whose native caret we should never take over: password fields, and the
// handful of controls that fake a caret with their own art.
const NEVER_DRAW = [
  'input[type="password"]',
  'input[type="range"]',
  'input[type="color"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="file"]',
  "[contenteditable='false']",
  '[readonly]',
  ".ProseMirror-gapcursor",
];

export function isNeverDrawHost(el) {
  if (!el || el.nodeType !== 1) return false;
  try {
    return !!el.closest(NEVER_DRAW.join(","));
  } catch {
    return false;
  }
}

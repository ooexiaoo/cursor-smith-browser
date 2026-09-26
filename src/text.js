// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

export var BRACKET_OPEN = { "(": ")", "[": "]", "{": "}", "<": ">" };
export var BRACKET_CLOSE = { ")": "(", "]": "[", "}": "{", ">": "<" };
export var BRACKET_SCAN_LIMIT = 2e4;
export var CODE_FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
export var CODE_FENCE_PREFIX = 8;
export var BLOCK_PREFIX_MAX = 64;
export var BLOCK_HEAD_MAX = BLOCK_PREFIX_MAX + CODE_FENCE_PREFIX;
export var BLOCK_LINE_LOOKBACK = 1024;
export function blockLineInfo(line) {
  let i = 0;
  let depth = 0;
  for (; ; ) {
    let j = i;
    let spaces = 0;
    while (j < line.length && (line[j] === " " || line[j] === "	") && spaces < 3) {
      j++;
      spaces++;
    }
    if (line[j] !== ">") break;
    depth++;
    i = j + 1;
    if (line[i] === " ") i++;
  }
  return { depth, fence: CODE_FENCE_RE.test(line.slice(i, i + CODE_FENCE_PREFIX)) };
}
export function isBlockquoteMarker(text, i, textStart) {
  const floor = Math.max(0, i - BLOCK_PREFIX_MAX);
  for (let j = i - 1; j >= floor; j--) {
    const c = text[j];
    if (c === "\n") return true;
    if (c !== ">" && c !== " " && c !== "	") return false;
  }
  return floor === 0 && textStart === 0;
}
export var QUOTE_CHARS = ['"', "'", "`"];
export var CURLY_QUOTE_OPEN = { "\u201C": "\u201D", "\u2018": "\u2019" };
export var QUOTE_LINE_SCAN = 4e3;
export var WORD_CHAR = /[\p{L}\p{N}_]/u;
export function isQuoteDelimiter(text, i) {
  return !(WORD_CHAR.test(text[i - 1] || "") && WORD_CHAR.test(text[i + 1] || ""));
}

// src/paint-tether.ts

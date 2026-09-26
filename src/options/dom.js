// Minimal DOM helpers. The extension ships no framework: the options page is a
// few hundred controls that need to be rebuilt wholesale when a gate changes, and
// virtual DOM would cost more than it saves.

/**
 * Create an element.
 *
 * `props` keys: `class`, `text`, `html`, `style` (object), `on` (event map),
 * `data` (attribute map), `title`, `value`, `type`, `min`, `max`, `step`, plus
 * any other key, which is set as an attribute when it is a string and as a
 * property otherwise.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "data") for (const [dk, dv] of Object.entries(v)) { if (dv != null) el.dataset[dk] = dv; }
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  for (const c of children.flat(Infinity)) if (c != null && c !== false) f.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return f;
};

export const clear = (el) => {
  while (el.firstChild) el.firstChild.remove();
  return el;
};

/** Trailing-edge debounce, used for the search boxes and the live engine. */
export function debounce(fn, ms = 120) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

/** Read a CSS custom property off the document root. */
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

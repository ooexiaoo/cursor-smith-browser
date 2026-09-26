// Obsidian's element helpers, on real elements.
//
// The engine's preview code was written against Obsidian's convenience API
// (createSpan, setCssStyles, attr, ...). Rather than rewrite that drawing code,
// teach it to a real DOM element. The options page is the only consumer, so the
// patch is scoped to this page.

const EL = window.HTMLElement.prototype;

const make = (tag, o) => {
  const el = document.createElement(tag);
  if (o?.cls) el.className = o.cls;
  if (o?.text != null) el.textContent = o.text;
  for (const [k, v] of Object.entries(o?.attr || {})) el.setAttribute(k, v === true ? "" : String(v));
  return el;
};

if (!EL.createSpan) {
  // Obsidian accepts a class as a string or an array, so flatten before handing
  // anything to classList.
  const classes = (cls) => (Array.isArray(cls) ? cls : String(cls).split(/\s+/)).filter(Boolean);

  EL.createSpan = (o) => make("span", o);
  EL.createDiv = (o) => make("div", o);
  EL.createEl = (tag, o) => make(tag, o);

  EL.setCssStyles = function (styles) {
    Object.assign(this.style, styles);
    return this;
  };
  EL.setCssProps = function (styles) {
    for (const [k, v] of Object.entries(styles)) this.style.setProperty(k, v);
    return this;
  };
  EL.addClass = function (...cls) {
    this.classList.add(...cls.flatMap(classes));
    return this;
  };
  EL.removeClass = function (...cls) {
    this.classList.remove(...cls.flatMap(classes));
    return this;
  };
  EL.toggleClass = function (cls, on) {
    this.classList.toggle(cls, on);
    return this;
  };
  EL.setText = function (t) {
    this.textContent = t;
    return this;
  };
  EL.empty = function () {
    this.replaceChildren();
    return this;
  };
}

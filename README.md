# Cursor-Smith for the browser

A browser port of [**Cursor-Smith**](https://github.com/SadSnake1/cursor-smith), the
Obsidian cursor engine by [SadSnake1](https://github.com/SadSnake1).

Upstream replaces the caret inside Obsidian's editors. This is the same engine,
running on **every website**, in Chrome, Edge and Brave.

> **The engine is SadSnake1's work.** Everything under `src/paint/`, plus the
> caret, physics, effect and Vim logic, is upstream's code extracted from the
> released Obsidian bundle. This project is the browser shell around it. See
> [CREDITS.md](CREDITS.md) for exactly where the line is, and please credit
> upstream if you fork or redistribute this.

---

## Install

```bash
git clone https://github.com/ooexiaoo/cursor-smith-extension
cd cursor-smith-extension
npm install
npm run build
```

Then load it:

| Browser | Extensions page |
|---|---|
| Chrome | `chrome://extensions` |
| Edge | `edge://extensions` |
| Brave | `brave://extensions` |

Enable **Developer mode**, click **Load unpacked**, and pick the `dist/` folder
in the project directory.

Visit any page with a text field and you should see your cursor.

### Importing your Obsidian setup

If you already run Cursor-Smith in Obsidian, you can bring your configuration
across: **Settings → Data → Import**, and select your vault's
`.obsidian/plugins/cursor-smith/data.json`.

All six presets (`Jell-O`, `Torch-Crt`, `mr.Blue`, `FairyDust`, `DarkMatter`,
`old_Joe`) and all five Vim modes come with it. Settings are stored per-browser
account, not synced from Obsidian, so the import is a one-time copy.

## Use it

Click the toolbar icon for the popup: master switch, preset cycling, and a link
to the full settings page. On first run the engine is already on.

Everything upstream exposes is here — cursor style, thickness, glow, gradients,
opacity and blink, plus each effect individually (pixel trails, stardust, motion
smear, CRT ghosts, torch spotlighting, bracket span highlighting) and full
CUA/Vim cursor setups.

### Shortcuts

| Keys | Action |
|---|---|
| `Alt+Shift+C` | Toggle on this site |
| `Alt+Shift+.` | Cycle preset |
| `Alt+Shift+V` | Switch CUA / Vim cursor |
| `Alt+Shift+X` | Off everywhere |

All four are rebundable at `chrome://extensions/shortcuts`. The last one is a
synced kill switch: it turns the engine off on every site and every device
signed into the same browser profile, and takes precedence over every other
setting. Clear it from the popup.

### Sites

By default the engine runs everywhere, excluding video-call, payment and banking
domains. Settings → Sites offers three modes:

- **Everywhere** — on all sites
- **Only the sites below** — an allow-list; nothing runs outside it
- **Everywhere except the sites below** — a deny-list

The list of sites you have to be signed in to, plus streaming services, is always
excluded and is not editable.

## What this port changed

The engine needed no rewriting. What it needed was everything around it, because
Obsidian provides a lot of its environment.

**The `Host` facade** (`src/shim/host.js`) replaces Obsidian's `Plugin`, `View`,
`Notice`, `Modal`, `Setting` and `PluginSettingTab`. The engine is written
against those, so it now runs against browser equivalents.

**The DOM shim** (`src/shim/dom.js`) is the interesting one. The engine calls
Obsidian's DOM helpers — `createDiv`, `createEl`, `setCssStyles`, `detach` — and
none of them exist on a web page. The shim installs them onto `Element.prototype`,
once per realm and only when absent, so it never clobbers a site's own methods.
It is what makes the engine work on a real page at all.

**Site gating** (`src/shim/sites.js`) replaces Obsidian's "editors only" rule
with real browser site matching, and keeps upstream's built-in sensitive-site
exclusions.

**Persistence** (`src/shim/storage.js`) maps `saveData`/`loadData` onto
`chrome.storage.sync`. The live config is ~36 KB, over the 8 KB per-item sync
quota, so it is split across numbered chunks and reassembled on read, then
compacted back to one key when it shrinks.

**The options page** (`src/options/`) is upstream's own declarative settings-tab
code, running against a recording `Setting` stand-in. The 117-row look schema is
upstream's; this port adds the rail, the collapsible effect groups and the
reset/import/export actions around it.

Beyond the port proper, a few things the engine had no concept of on the web:

- a `Host`-driven lifecycle, so synced settings changes now enable or disable
  already-open pages instead of applying on next load
- the synced global kill switch and its `Alt+Shift+X` command
- **Firefox is not supported.** MV3 there still wants `background.scripts` as a
  blocking array, which the build does not emit.

There were also three real bugs that only a real browser exposed, all fixed and
all now covered by tests: the missing DOM shim, `build()` never appending its
element, and caret measurement anchoring to the offscreen mirror's viewport
coordinates — which made the engine paint nothing at all on a plain `<textarea>`,
its most common case.

### Layout

```
src/
  paint/        the engine - upstream's code, minimal substitutions
  shim/         everything that replaces Obsidian
  options/      settings UI (upstream's schema, this port's page)
  core.js       plugin lifecycle
  content.js    content script entry
  background.js service worker, command relay
scripts/
  build.mjs     esbuild -> dist/
  test.mjs      runs every suite
  extract.mjs   one-time upstream extraction, see CREDITS.md
test/           7 source suites + a real-Chromium extension suite
```

## Develop

```bash
npm run build       # -> dist/
npm run build:watch # rebuild on change
npm test            # everything, including real Chromium
npm run typecheck
npm run lint
```

`npm test` runs seven source suites, the MV3 packaging validator, a mocked-browser
UI smoke test, and a suite that loads `dist/` as an actual unpacked extension to
confirm the service worker registers, the content script injects, and the canvas
really paints. It needs a Chromium:

```bash
CHROME_PATH=/usr/bin/chromium npm test
# or
npx playwright install chromium
```

`scripts/extract.mjs` is a one-time bootstrap tool, not part of the build. It
pulled the engine out of the released Obsidian bundle to seed `src/`. The modules
have been adapted since, and it refuses to overwrite them without `--force`.

## Limitations

- **Browser UI is out of reach.** The address bar, find-in-page bar, DevTools and
  extension settings pages are browser chrome, not pages, and no extension can
  inject into them. The omnibox caret is always the browser's own.
- **Google Docs and similar** render text into a canvas, so there is no DOM
  element to measure. Other canvas editors (Monaco, CodeMirror) are handled.
- **`file://` URLs** need *Allow access to file URLs* on the extension card.
- Password and other restricted input types are deliberately left alone, so the
  native caret is never hidden without a replacement drawn.

## License

MIT, the same terms upstream uses. See [LICENSE](LICENSE) and
[CREDITS.md](CREDITS.md).

# Credits

## Cursor-Smith

This extension is a browser port of **Cursor-Smith**, an Obsidian plugin by
**SadSnake1**.

- Upstream: <https://github.com/SadSnake1/cursor-smith>
- Version ported from: 1.6.5
- License: MIT, the same terms upstream publishes under
- Upstream describes the engine as carried to other editors and asks ports to
  open an issue so it can be listed: <https://github.com/SadSnake1/cursor-smith/issues>

The caret engine under `src/` - the parts that draw, measure, animate and
composite the cursor - is upstream's code, mechanically extracted from the
released Obsidian bundle and adapted to run outside Obsidian. Every extracted
module carries a header pointing back here. Nothing in the engine was rewritten
from scratch; the credit for the effects, the physics, the Vim modes and the
preset system belongs upstream.

What this port adds is everything around that engine:

- the MV3 extension shell: manifest, content script, service worker, popup
- the `Host` facade in `src/shim/`, which replaces Obsidian's `Plugin`, `View`,
  `Notice`, `Modal`, `Setting` and `PluginSettingTab`
- browser site gating in `src/shim/sites.js`, in place of Obsidian's
  "editors only" rule
- `chrome.storage` persistence in `src/shim/storage.js`, including chunking to
  stay inside the sync per-item quota
- the options page, whose declarative schema is upstream's own settings-tab code
  run against a recording `Setting` stand-in

## Lucide

Interface icons are [Lucide](https://lucide.dev), ISC licensed. The subset used
is inlined in `src/options/icons.js`, generated from `lucide-static`.

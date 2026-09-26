// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { effectsDustMethods } from "./dust.js";
import { effectsFireMethods } from "./fire.js";
import { effectsPopsMethods } from "./pops.js";
import { effectsTrailMethods } from "./trail.js";

export var effectsMethods = {
  ...effectsFireMethods,
  ...effectsPopsMethods,
  ...effectsDustMethods,
  ...effectsTrailMethods
};

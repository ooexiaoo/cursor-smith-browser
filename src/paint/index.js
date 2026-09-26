// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

import { paintBlinkMethods } from "./blink.js";
import { paintColorMethods } from "./color.js";
import { paintEnergyMethods } from "./energy.js";
import { paintFrameMethods } from "./frame.js";
import { paintSecondariesMethods } from "./secondaries.js";
import { paintShapeMethods } from "./shape.js";
import { paintSmearMethods } from "./smear.js";
import { paintTetherMethods } from "./tether.js";

export var paintMethods = {
  ...paintColorMethods,
  ...paintBlinkMethods,
  ...paintShapeMethods,
  ...paintEnergyMethods,
  ...paintTetherMethods,
  ...paintSecondariesMethods,
  ...paintSmearMethods,
  ...paintFrameMethods
};

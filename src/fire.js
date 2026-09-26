// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

export var HOT_STOP_POS = [0, 0.12, 0.42, 0.72, 1];
export var HOT_HSV = [
  [44, 1, 1],
  // amber-yellow (a touch warmer than a pure 48 gold,
  // which reads green-ish next to orange)
  [30, 1, 1],
  // orange
  [12, 0.95, 1],
  // red-orange
  [26, 0.2, 1]
  // white-hot, faintly warm
];
export var HOT_TEMP_GAMMA = 0.55;
export var HOT_PX_DIVISOR = 4.5;
export var HOT_PX_MIN = 2;
export var HOT_PX_MAX = 5;
export var HOT_STAGE_PIXEL = 0.22;
export var HOT_BLOCK_SHAPES = [
  ["11", "11", "11", "11"],
  // 2x4 column, the recording's chunk
  ["011", "111", "111"],
  // 3x3 notched, the widest
  ["110", "111", "111"],
  ["11", "11", "11"],
  // 2x3
  ["01", "11", "11"],
  // 2x3 notched at the top
  ["10", "11", "11"],
  ["111", "111"],
  // 3x2 wide
  ["1", "1", "1", "1"],
  // 1x4 thin column
  ["11", "11"],
  // 2x2, the original's fresh block
  ["1", "1", "1"],
  // 1x3 tall
  ["01", "11"],
  // small L
  ["10", "11"],
  ["111"],
  // 3x1
  ["11"],
  // 2x1 wide
  ["1", "1"],
  // 1x2 tall
  ["1"]
  // 1x1, the original's pixel
];
export var hotShapeStage = (area) => area >= 6 ? 3 : area >= 4 ? 2 : area >= 2 ? 1.5 : 1;
export var HOT_COLOR_LEVELS = 3;
export var HOT_TEMP_MAX = 0.5;
export var HOT_ALPHA_LEVELS = 3;
export var hotQuant = (v, levels) => Math.round(Math.max(0, Math.min(1, v)) * levels) / levels;
export var HOT_SPARKS_PER_CHUNK = 1;
export var HOT_SPARK_MAX = 60;
export var HOT_BUDGET_CARETS = 8;
export var HOT_SPECK_SCALE = 0.85;
export var HOT_FINE_SCALE = 0.5;
export var HOT_FINE_CHANCE = 0.4;
export var HOT_ENGULF_MS = 260;
export var HOT_ENGULF_RATE = 200;
export var HOT_ENGULF_PAD_X = 1.1;
export var HOT_SPARK_LIFT = 1.9;
export var HOT_SPARK_RISE = 5;
export var FLAME_LEVELS = 16;
export var FLAME_MAX_NUM = 110;
export var FLAME_MAX_LIFETIME = 620;
export var FLAME_LIFETIME_EXP = 2.2;
export var HOT_LIFE_FLOOR = 0.25;
export var HOT_SHAPE_EASE = 1.6;
export var FLAME_PER_SECOND = 125;
export var FLAME_PER_LENGTH = 0.8;
export var FLAME_SPREAD = 0.5;
export var FLAME_INITIAL_VELOCITY = 6;
export var HOT_START_CONE = 0.45;
export var FLAME_RANDOM_VELOCITY = 62;
export var HOT_TURB_X = 0.15;
export var HOT_TURB_Y = 0.5;
export var HOT_SWAY_CW = 0.3;
export var HOT_SWAY_HZ = 1.3;
export var HOT_SWAY_GROW_MS = 260;
export var FLAME_DAMPING = 0.2;
export var FLAME_BUOYANCY = -85;
export var HOT_FLAT_HUE_SPAN = 26;
export var HOT_FLAT_LIGHTEN = 0.55;
export var HOT_HEAD_LIFT = -0.06;
export var HOT_HEAD_JITTER_UP = 0.07;
export var HOT_HEAD_JITTER_DOWN = 0.02;
export var HOT_BURN_LINGER_MS = 240;
export var HOT_BURN_MAX = 64;
export var HOT_TRAIL_FADE_POW = 1;
export var HOT_TRAIL_STEP_CW = 1;
export var HOT_TRAIL_PATH_MAX = 24;
export var HOT_TRAIL_PATH_AGE = 0.35;
export var HOT_TRAIL_EMIT_MAX = 2.4;

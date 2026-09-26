// Derived from Cursor-Smith (Obsidian plugin) by SadSnake1.
// Engine logic reused under the terms of the upstream project; see CREDITS.md.

export var DIRTY_RECT_CLEAR = true;
export var CANVAS_REGION_MARGIN_X = 96;
export var CANVAS_REGION_MARGIN_Y = 1.5;
export var CANVAS_REGION_GRID = 64;
export var CANVAS_REGION_SHRINK_MS = 2e3;
export var CANVAS_REGION_SHRINK_RATIO = 2;
export var CANVAS_REGION_MOTION_PAD = 32;
export var SPEED_RAMP_LIFTOFF = 0.12;
export var GLOW_HEAT_GAIN = 1.6;
export function keystrokeHeatWeight(kind, repeat) {
  if (kind === "nav") return repeat ? 0.45 : 0.7;
  if (kind === "delete") return repeat ? 0.7 : 1;
  return repeat ? 0 : 1;
}
export var CARET_COVERS = ".ws-mask, .ws-status-bar";
export var GEOMETRY_TTL_MS = 400;
export var DEVICE_ENABLED_KEY = "cursor-smith-enabled-on-this-device";
export var INPUT_HOT_MS = 500;
export var SCROLL_LOCK_MS = 120;
export var CARET_STYLE_TTL_MS = 1e3;
export var SMEAR_SETTLE_V = 30;
export var WATCHDOG_INTERVAL_MS = 2e3;
export var WATCHDOG_STALE_MS = 3e3;
export var TORCH_CANVAS_SCALE = 0.25;
export var FRAME_CAPS = {
  normal: { hotMinMs: 14, warmMs: 33, energyMs: 50, idleMs: 200, torchPulseMs: 33, torchIdleMs: 150 },
  lowPower: { hotMinMs: 30, warmMs: 50, energyMs: 80, idleMs: 250, torchPulseMs: 50, torchIdleMs: 250 }
};
export var THUNDER_LIFE_MS = 280;
export var THUNDER_MAX_ANGLE = 0.95;
export var THUNDER_MIN_REACH = 150;
export var THUNDER_PASSES = 5;
export var THUNDER_MAX_LIVE = 3;
export var THUNDER_PALETTE = [
  [110, 165, 255],
  // blue
  [175, 120, 255],
  // purple
  [255, 95, 115],
  // red
  [255, 216, 120],
  // yellow
  [255, 255, 255]
  // white
];
export var THUNDER_BANDS = 14;
export var FIREWORK_RISE_MS = 260;
export var FIREWORK_FALL_MS = 620;
export var FIREWORK_RISE_LINES = 3.4;
export var FIREWORK_RISE_JITTER = 1.2;
export var FIREWORK_DRIFT = 26;
export var FIREWORK_GRAVITY = 420;
export var FIREWORK_CELL = 3;
export var FIREWORK_ALPHA = 0.55;
export var FIREWORK_MAX_LIVE = 10;
export var FIREWORK_MIN_GAP_MS = 70;
export var FIREWORK_SPARK_BUDGET = 260;
export var FIREWORK_SPARK_MIN = 5;
export var FIREWORK_PRESSURE = 0.55;
export var FIREWORK_TRAIL_LEN = 2;
export var FIREWORK_TWINKLE_AT = 0.42;
export var FIREWORK_PALETTE_MAX = 6;
export var FIREWORK_SECOND_MAX = 3;
export var FIREWORK_SECOND_SPARKS = 5;
export var FIREWORK_SECOND_AT = [0.3, 0.55];
export var TORCH_FLICKER_RATES = [8.7, 13.1, 21.3];
export var TORCH_FLICKER_PHASES = [0, 1.7, 4.2];
export var TORCH_FLICKER_WEIGHTS = [0.5, 0.3, 0.2];
export var SMEAR_LEAD_BOOST_CAP = 6;
export var SMEAR_VOLUME_MIN_FACTOR = 0.35;
export var TAPER_MIN_LAG = 26;
export var TAPER_FULL_LAG = 90;
export var JUMP_TRAIL_MIN_DIST = 40;
export var JUMP_TRAIL_STEP = 18;
export var JUMP_TRAIL_MAX_PUFFS = 40;
export var TRANSLUCENT_ALPHA = 0.95;
export var CATCHUP_BOOST_RATE = 8;
export var ROUNDED_THIN_PX = 6;
export var ROUNDED_BLOCK_FRACTION = 0.25;
export var SERIF_STEM_RATIO = 0.9;
export var SERIF_HEIGHT_RATIO = 0.08;
export var SERIF_MIN_SPAN_PX = 5;
export var SERIF_MAX_SPAN_RATIO = 1.25;
export var SECONDARY_FULL_MAX = 64;
export var SECONDARY_MATCH_WINDOW = 32;
export var CARET_STATE_FIELDS = [
  "lastActive",
  "pending",
  "animActive",
  "smearQuad",
  "smearShape",
  "smearCenterPrev",
  "_taperBuf",
  "_volumeBuf",
  "_smearDir",
  // The two-point quad's points (1.5.6). They were missing here until 1.5.8,
  // so a secondary's spring integrated the primary's points toward its own
  // target and the two carets' smears fought over one spring.
  "_smearLead",
  "_smearTrail",
  "_smearMoving",
  "_smearDtT",
  "smearQuadLastMoveT",
  "trail",
  "glitch",
  "_smoothMoving",
  "_smoothLastT",
  "_catchUpBoost",
  "_typingBoostSm",
  "typingSpeedMod",
  "_hotPrev",
  "_hotEmitFrom",
  "_hotActiveT",
  "_lastHotT",
  "hotBurns",
  "_hotShiftTick",
  "_hotEngulfUntil",
  "_lastStardustT",
  "_lastSparkT",
  "_lastFireworkT",
  "_tetherKey",
  "_tetherFrom",
  "_tetherTo",
  "_tetherSegs",
  "_tetherSegKey",
  "_tetherAnchorA",
  "_tetherAnchorB"
];
export var STARDUST_MAX_PER_CARET = 60;
export var SERIF_TAPER = 0.3;

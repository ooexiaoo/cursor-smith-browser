// The effects rail: the master switch for each effect, in panel order.
//
// Each entry is a key that gates a block of sub-settings. The schema reads this
// list both to decide what the rail shows and to summarise a card ("every effect
// that is on, by name"), so the two can never disagree about what exists.
//
// `icon` is a Lucide name, matching what the Obsidian panel used.

export const RAIL_EFFECTS = [
  { key: "popEffects", name: "Pop effects", icon: "party-popper", desc: "Letters, lightning and fireworks thrown off as you type." },
  { key: "flameTrail", name: "Pixel trail", icon: "wind", desc: "A puff of colored pixels wherever the cursor has just been." },
  { key: "stardustEnabled", name: "Stardust", icon: "sparkles", desc: "Floating motes that drift up, or orbit the cursor." },
  { key: "bracketTether", name: "Bracket tether", icon: "brackets", desc: "A line under the span between matching brackets or quotes." },
  { key: "smear", name: "Motion smear", icon: "paintbrush", desc: "The cursor stretches as it moves and snaps back when it arrives." },
  { key: "energyEffect", name: "Energy beam", icon: "zap", desc: "A pulse of light along the cursor; an aurora with a gradient." },
  { key: "crtEffect", name: "CRT effects", icon: "circuit-board", desc: "Phosphor ghosts behind the cursor, neon and glitch options." },
  { key: "speedDemon", name: "Speed demon", icon: "gauge", desc: "Heats from gray to white-hot as you type, throwing sparks." },
  { key: "hotHead", name: "Hot-head", icon: "flame", desc: "Sets the text you are working on alight." },
  { key: "torchEffect", name: "Torch spotlight", icon: "sun", desc: "Darkens everything except a pool of light around the cursor." },
];

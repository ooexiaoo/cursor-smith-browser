import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSettings, saveSettings } from "../src/shim/storage.js";

// Minimal fake of chrome.storage.sync enforcing the real per-item quota.
const PER_ITEM = 8192, MAX_ITEMS = 512, MAX_TOTAL = 102400;
let db = {};
let writes = 0;
globalThis.chrome = { storage: { sync: {
  async get(k) {
    const ks = Array.isArray(k) ? k : typeof k === "string" ? [k] : Object.keys(k);
    return Object.fromEntries(ks.filter((x) => x in db).map((x) => [x, db[x]]));
  },
  async set(obj) {
    const entries = Object.entries(obj);
    const total = Object.keys({ ...db, ...obj }).length;
    if (total > MAX_ITEMS) throw new Error("QUOTA_BYTES_ITEM_COUNT");
    let sum = 0;
    for (const [k, v] of Object.entries({ ...db, ...obj })) sum += JSON.stringify(v).length + k.length;
    if (sum > MAX_TOTAL) throw new Error("QUOTA_BYTES_TOTAL");
    for (const [k, v] of entries) {
      const size = JSON.stringify(v).length + k.length;
      if (size > PER_ITEM) throw new Error(`QUOTA_BYTES_PER_ITEM on ${k} (${size})`);
    }
    Object.assign(db, obj); writes++;
  },
  async remove(ks) { (Array.isArray(ks) ? ks : [ks]).forEach((k) => delete db[k]); },
  onChanged: { addListener() {}, removeListener() {} },
} } };

// The committed fixture is a real exported config, six presets included, which
// is what makes this a useful round-trip rather than a toy. Point CURSOR_SMITH_DATA
// at your own vault's data.json to test a bigger one.
// These suites are bundled into a temp dir, so the fixture is located from the
// project root, which the runner passes in.
const fixture = join(process.env.CURSOR_SMITH_ROOT || process.cwd(), "test/fixtures/live-settings.json");
const live = JSON.parse(readFileSync(process.env.CURSOR_SMITH_DATA || fixture, "utf8"));
const payload = live.settings ?? live;
const bytes = JSON.stringify(payload).length;
console.log("live data.json settings:", bytes, "bytes ->", Math.ceil(bytes / 7000), "chunks needed");

await saveSettings(payload);
console.log("save ok. keys written:", Object.keys(db).length, "| storage.total writes:", writes);
const back = await loadSettings();
console.log("round-trip equal:", JSON.stringify(back) === JSON.stringify(payload));

console.log("\n-- small config stays on one key --");
db = {}; await saveSettings({ enabled: true, cursorStyle: "Box" });
console.log("keys:", Object.keys(db));
console.log("round-trip:", JSON.stringify(await loadSettings()));

console.log("\n-- shrink back down after a big config --");
db = {}; await saveSettings(payload); const big = Object.keys(db).length;
await saveSettings({ enabled: true }); 
console.log(`keys ${big} -> ${Object.keys(db).length}:`, Object.keys(db));
console.log("round-trip:", JSON.stringify(await loadSettings()));

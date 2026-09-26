import { lookDefinitions } from "../src/options/look-schema.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";

const target = { ...DEFAULT_SETTINGS };
const cards = lookDefinitions({
  get: (k) => target[k],
  set: (k) => async (v) => { target[k] = v; },
});
for (const card of cards) {
  console.log(`\n## ${card.title}  (${card.items.length} rows)`);
  for (const it of card.items) {
    if (it.type === "row") {
      const kinds = it.controls.map(c => c.type).join("+") || "none";
      console.log(`  ${"  ".repeat(it.depth||0)}${it.name}  [${kinds}]`);
    } else {
      console.log(`  ${"  ".repeat(it.depth||0)}<${it.type}${it.title?": "+it.title:""}>`);
    }
  }
}

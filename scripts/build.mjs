import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const watch = process.argv.includes("--watch");
const outdir = "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// MV3 forbids remotely hosted code, and an unpacked extension has to work from
// disk, so everything is bundled inline: no import maps, no CDN, no eval.
const common = {
  bundle: true,
  format: "iife",
  target: ["chrome110"],
  charset: "utf8",
  legalComments: "inline",
  logLevel: "info",
};

const targets = [
  { ...common, entryPoints: ["src/content.js"], outfile: `${outdir}/content.js` },
  { ...common, entryPoints: ["src/background.js"], outfile: `${outdir}/background.js` },
  { ...common, entryPoints: ["src/options/options.js"], outfile: `${outdir}/options.js` },
  { ...common, entryPoints: ["src/options/popup.js"], outfile: `${outdir}/popup.js` },
];

const copy = [
  ["public/manifest.json", "manifest.json"],
  ["public/cursor-smith.css", "cursor-smith.css"],
  ["public/options.html", "options.html"],
  ["public/options.css", "options.css"],
  ["public/popup.html", "popup.html"],
  ["public/popup.css", "popup.css"],
  ["public/icons", "icons"],
  ["CREDITS.md", "CREDITS.md"],
];

function copyStatic() {
  for (const [from, to] of copy) {
    try {
      cpSync(resolve(from), resolve(outdir, to), { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      console.warn(`  skipped ${from}`);
    }
  }
}

if (watch) {
  for (const t of targets) {
    const ctx = await context(t);
    await ctx.watch();
  }
  copyStatic();
  console.log("watching...");
} else {
  await Promise.all(targets.map((t) => build(t)));
  copyStatic();
  console.log("built ->", outdir);
}

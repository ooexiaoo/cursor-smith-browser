// Locating a Chromium to drive.
//
// playwright-core does not download browsers, so a path has to be found by
// hand. CHROME_PATH wins; otherwise try where the common installers put one.
// A clear error beats a cryptic ENOENT from deep inside Playwright.

import { existsSync, globSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/microsoft-edge",
  "/usr/bin/brave-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  // A Playwright-managed build, if one happens to be installed.
  const cache = join(
    process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright"),
    "chromium-*/chrome-linux64/chrome"
  );
  for (const hit of globSync(cache)) return hit;
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  console.error(
    "No Chromium found. Install one, or point CHROME_PATH at it:\n" +
      "  CHROME_PATH=/usr/bin/chromium npm test\n" +
      "or run: npx playwright install chromium"
  );
  process.exit(1);
}

// Background service worker.
//
// Owns no engine. Its whole job is to give the keyboard shortcuts somewhere to
// land: chrome.commands fires here, and the handler relays to the active tab's
// content script, which is the only place the engine exists.

// Commands that need a page to land in.
const COMMANDS = {
  "cycle-preset": "cyclePreset",
  toggle: "toggle",
  "toggle-cua-vim-mode": "toggleVim",
  "performance-report": "performanceReport",
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// "Off everywhere" is the one command the service worker handles itself. It
// writes the synced kill switch instead of messaging a tab, so it works from any
// machine and even on a page with no content script to talk to. Every open tab
// sees the storage change and tears its canvas down.
chrome.commands?.onCommand.addListener(async (command) => {
  if (command === "disable-everywhere") {
    const { loadSettings, saveSettings } = await import("./shim/storage.js");
    const settings = (await loadSettings()) ?? {};
    await saveSettings({ ...settings, globalOff: true });
    return;
  }
  if (!COMMANDS[command]) return;
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "cursor-smith:command", command });
  } catch {
    // The tab has no content script: a chrome:// page, the Web Store, a PDF
    // viewer, or a page that loaded before the extension did. Nothing to do.
  }
});

// Extension reload or disable should leave open tabs clean rather than stranding
// a canvas that can no longer be told anything.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((t) =>
      chrome.tabs.sendMessage(t.id, { type: "cursor-smith:shutdown" }).catch(() => {})
    )
  );
});

// Settings persistence for the extension.
//
// Two tiers, matching what the Obsidian plugin did with loadData/saveData and
// loadLocalStorage/saveLocalStorage:
//
//   synced   chrome.storage.sync    - the look, the presets, the site list.
//                                     Travels with the signed-in profile.
//   local    chrome.storage.local   - the per-device master switch, which must
//                                     not follow you to a machine you have not
//                                     enabled it on.
//
// Both are promise-based, and both are reachable from a content script, so the
// engine's saveSettings() is unchanged apart from its await.
//
// WHY CHUNKS: a stock config with six presets serialises to roughly 52 KB, and
// chrome.storage.sync caps a single item at 8 KB (QUOTA_BYTES_PER_ITEM). Writing
// the settings object under one key throws QUOTA_BYTES_PER_ITEM once the Vim
// starters, presets or site rules grow. So the settings are serialised once and
// split across as many chunk keys as it takes, with a manifest key recording how
// many there are. Sync's other limits (512 items, 100 KB total) leave plenty of
// headroom, and the read path degrades to a single key for small configs anyway.

const SYNC_PREFIX = "cursor-smith-settings:";
const CHUNK_COUNT_KEY = SYNC_PREFIX + "n";
const CHUNK_SIZE = 7000; // stay under the 8192-byte per-item cap with room to spare
const DEVICE_KEY = "cursor-smith-device-enabled";

const area = (name) => (globalThis.chrome?.storage?.[name] ?? null);

const keysBetween = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export async function loadSettings() {
  const sync = area("sync");
  if (!sync) return null;
  const manifest = await sync.get(CHUNK_COUNT_KEY);
  const count = manifest?.[CHUNK_COUNT_KEY];
  if (!count) {
    const raw = (await sync.get(SYNC_PREFIX))[SYNC_PREFIX];
    return raw && typeof raw === "object" ? raw : null;
  }
  const got = await sync.get(keysBetween(0, count - 1).map((i) => SYNC_PREFIX + i));
  // A short read means a write is still in flight or a chunk was evicted; bail
  // rather than hand back a half-parsed config.
  if (keysBetween(0, count - 1).some((i) => typeof got[SYNC_PREFIX + i] !== "string")) return null;
  try {
    return JSON.parse(keysBetween(0, count - 1).map((i) => got[SYNC_PREFIX + i]).join(""));
  } catch {
    return null;
  }
}

export async function saveSettings(settings) {
  const sync = area("sync");
  if (!sync) return;
  const payload = JSON.stringify(settings);
  if (payload.length <= CHUNK_SIZE) {
    // Small config: one key, so the common case stays readable in devtools.
    await sync.set({ [SYNC_PREFIX]: settings });
    await sync.remove([CHUNK_COUNT_KEY, ...keysBetween(0, 63).map((i) => SYNC_PREFIX + i)]);
    return;
  }
  const chunks = [];
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) chunks.push(payload.slice(i, i + CHUNK_SIZE));
  const write = { [CHUNK_COUNT_KEY]: chunks.length };
  chunks.forEach((chunk, i) => (write[SYNC_PREFIX + i] = chunk));
  await sync.set(write);
  // Drop the single-key form and any chunks left over from a larger previous write.
  await sync.remove([SYNC_PREFIX, ...keysBetween(chunks.length, 63).map((i) => SYNC_PREFIX + i)]);
}

export async function loadDeviceEnabled() {
  const local = area("local");
  if (!local) return true;
  const got = await local.get(DEVICE_KEY);
  return got?.[DEVICE_KEY] !== false;
}

export async function saveDeviceEnabled(on) {
  const local = area("local");
  if (!local) return;
  await local.set({ [DEVICE_KEY]: !!on });
}

// Cross-context change notification. The options page writes; every open tab
// re-reads and restyles itself, so a tweak shows up without a reload.
export function onSettingsChanged(cb) {
  const sync = area("sync");
  if (!sync?.onChanged) return { unload: () => {} };
  const listener = (changes, areaName) => {
    // The key prefix is the real filter, and it is what these keys are named
    // for. Chrome does pass the area name, but a content script cannot always
    // see it, and a guard that bails on a missing argument silently drops every
    // settings change: the page keeps drawing a cursor it was told to stop.
    if (areaName && areaName !== "sync") return;
    if (!changes || typeof changes !== "object") return;
    if (!(CHUNK_COUNT_KEY in changes) && !Object.keys(changes).some((k) => k.startsWith(SYNC_PREFIX))) return;
    // Chunked writes fire one event per key, and a multi-chunk write would
    // otherwise re-read N times mid-write. Coalesce to the next tick so the
    // listener only ever sees the finished payload.
    clearTimeout(onSettingsChanged._t);
    onSettingsChanged._t = setTimeout(async () => cb(await loadSettings()), 50);
  };
  sync.onChanged.addListener(listener);
  return { unload: () => sync.onChanged.removeListener(listener) };
}

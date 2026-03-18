/**
 * Settings management using chrome.storage.sync.
 */

import { DEFAULT_SETTINGS, type ExtensionSettings } from './types';

const STORAGE_KEY = 'zitan_settings';
const OLD_STORAGE_KEY = 'tenzhong_settings';

/** Load settings, merging with defaults for any missing keys. */
export async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY, OLD_STORAGE_KEY], (result) => {
      // Migrate from old storage key if needed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let stored: any = result[STORAGE_KEY] || {};
      if (Object.keys(stored).length === 0 && result[OLD_STORAGE_KEY]) {
        stored = result[OLD_STORAGE_KEY];
        // Migrate to new key and remove old
        chrome.storage.sync.set({ [STORAGE_KEY]: stored });
        chrome.storage.sync.remove(OLD_STORAGE_KEY);
      }
      // Migrate old 'blacklist' key to 'blocklist'
      if (stored.blacklist && !stored.blocklist) {
        stored.blocklist = stored.blacklist;
        delete stored.blacklist;
      }
      resolve({ ...DEFAULT_SETTINGS, ...stored });
    });
  });
}

/** Save settings (partial update). */
export async function saveSettings(
  partial: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const updated = { ...current, ...partial };
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: updated }, () => {
      resolve(updated);
    });
  });
}

/** Listen for settings changes. */
export function onSettingsChanged(
  callback: (settings: ExtensionSettings) => void
): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEY]) {
      const newVal = changes[STORAGE_KEY].newValue || {};
      callback({ ...DEFAULT_SETTINGS, ...newVal });
    }
  });
}

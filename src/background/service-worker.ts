/**
 * MV3 Background Service Worker.
 *
 * Handles:
 * - Loading CC-CEDICT into IndexedDB on first install
 * - Processing lookup requests from content scripts
 * - Managing extension state (enabled/disabled)
 * - Context menu integration
 */

import {
  isDictLoaded,
  loadDictionary,
  longestPrefixLookup,
} from '../common/db';
import { loadSettings, saveSettings, onSettingsChanged } from '../common/settings';
import type {
  ContentToBackground,
  DictEntry,
  ExtensionSettings,
  LookupResult,
} from '../common/types';

let settings: ExtensionSettings | null = null;

// Singleton promise prevents the race condition where onInstalled + top-level
// startup both call ensureDictLoaded() concurrently, causing double inserts.
let dictLoadPromise: Promise<void> | null = null;

// ---- Dictionary Loading ----

function ensureDictLoaded(): Promise<void> {
  if (!dictLoadPromise) {
    dictLoadPromise = doLoadDict();
  }
  return dictLoadPromise;
}

async function doLoadDict(): Promise<void> {
  const loaded = await isDictLoaded();
  if (loaded) return;

  console.log('[TenZhong] Loading dictionary into IndexedDB...');

  try {
    const url = chrome.runtime.getURL('assets/cedict.json');
    const response = await fetch(url);
    const data = await response.json();

    const entries: DictEntry[] = data.entries.map(
      (e: { t: string; s: string; p: string; r: string; d: string[] }) => ({
        traditional: e.t,
        simplified: e.s,
        pinyin: e.p,
        pinyinRaw: e.r,
        definitions: e.d,
        source: 'cedict',
      })
    );

    await loadDictionary(entries, 'cedict', data.version);
    console.log(
      `[TenZhong] Dictionary loaded: ${entries.length} entries (v${data.version})`
    );
  } catch (err) {
    console.error('[TenZhong] Failed to load dictionary:', err);
    // Reset so a retry can happen
    dictLoadPromise = null;
  }
}

// ---- Message Handling ----

async function handleLookup(
  text: string,
  maxResults: number = 7
): Promise<LookupResult | null> {
  await ensureDictLoaded();

  const result = await longestPrefixLookup(text, 10);
  if (!result) return null;

  return {
    entries: result.entries.slice(0, maxResults),
    matchLen: result.matchLen,
    matchText: text.substring(0, result.matchLen),
  };
}

chrome.runtime.onMessage.addListener(
  (
    message: ContentToBackground,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    switch (message.type) {
      case 'lookup':
        handleLookup(message.text, message.maxResults).then(sendResponse);
        return true; // async response

      case 'getState':
        loadSettings().then((s) =>
          sendResponse({ enabled: s.enabled, settings: s })
        );
        return true;

      case 'toggleEnabled':
        loadSettings().then(async (s) => {
          const save = saveSettings;
          const updated = await save({ enabled: !s.enabled });
          sendResponse({ enabled: updated.enabled });
          // Notify all tabs
          broadcastState(updated);
        });
        return true;
    }
  }
);

async function broadcastState(s: ExtensionSettings): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'stateChanged',
        enabled: s.enabled,
      }).catch(() => {
        // Tab may not have content script
      });
    }
  }
}

// ---- Context Menu ----

chrome.contextMenus?.create(
  {
    id: 'tenzhong-toggle',
    title: 'Toggle TenZhong Dictionary',
    contexts: ['action'],
  },
  () => chrome.runtime.lastError // Suppress duplicate error
);

chrome.contextMenus?.onClicked.addListener((info) => {
  if (info.menuItemId === 'tenzhong-toggle') {
    loadSettings().then(async (s) => {
      const save = saveSettings;
      const updated = await save({ enabled: !s.enabled });
      broadcastState(updated);
    });
  }
});

// ---- Action Click (toolbar icon) ----

chrome.action.onClicked.addListener(() => {
  loadSettings().then(async (s) => {
    const save = saveSettings;
    const updated = await save({ enabled: !s.enabled });
    broadcastState(updated);
    // Update icon badge
    chrome.action.setBadgeText({
      text: updated.enabled ? '' : 'OFF',
    });
    chrome.action.setBadgeBackgroundColor({ color: '#666' });
  });
});

// ---- Initialization ----

chrome.runtime.onInstalled.addListener(() => {
  console.log('[TenZhong] Extension installed, loading dictionary...');
  ensureDictLoaded();
});

// Also ensure loaded on service worker startup
ensureDictLoaded();

// Watch for settings changes
onSettingsChanged((s) => {
  settings = s;
});

/**
 * MV3 Background Service Worker.
 *
 * Handles:
 * - Loading CC-CEDICT into IndexedDB on first install
 * - Loading Dong Chinese word + character data
 * - Processing lookup requests from content scripts
 * - Managing extension state (enabled/disabled)
 * - Context menu integration
 */

import {
  isDictLoaded,
  isDongLoaded,
  loadDictionary,
  loadDongWords,
  loadDongChars,
  longestPrefixLookup,
  lookupDongWord,
  lookupDongChar,
  getMeta,
} from '../common/db';
import { loadSettings, saveSettings, onSettingsChanged } from '../common/settings';
import type {
  ContentToBackground,
  DictEntry,
  DongWordEntry,
  DongCharEntry,
  ExtensionSettings,
  WordLookupResult,
  CharLookupResult,
} from '../common/types';

let settings: ExtensionSettings | null = null;

// Singleton promise prevents the race condition where onInstalled + top-level
// startup both call ensureDictLoaded() concurrently, causing double inserts.
let dictLoadPromise: Promise<void> | null = null;
let dongLoadPromise: Promise<void> | null = null;

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

  console.log('[ZiTan] Loading dictionary into IndexedDB...');

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
      `[ZiTan] Dictionary loaded: ${entries.length} entries (v${data.version})`
    );
  } catch (err) {
    console.error('[ZiTan] Failed to load dictionary:', err);
    // Reset so a retry can happen
    dictLoadPromise = null;
  }
}

function ensureDongDictsLoaded(): Promise<void> {
  if (!dongLoadPromise) {
    dongLoadPromise = doLoadDongDicts();
  }
  return dongLoadPromise;
}

async function doLoadDongDicts(): Promise<void> {
  const loaded = await isDongLoaded();
  if (loaded) return;

  console.log('[ZiTan] Loading Dong Chinese data into IndexedDB...');

  try {
    const [wordsResponse, charsResponse] = await Promise.all([
      fetch(chrome.runtime.getURL('assets/dong-words.json')),
      fetch(chrome.runtime.getURL('assets/dong-chars.json')),
    ]);

    const [wordsData, charsData] = await Promise.all([
      wordsResponse.json(),
      charsResponse.json(),
    ]);

    await Promise.all([
      loadDongWords(wordsData.entries),
      loadDongChars(charsData.entries),
    ]);

    console.log(
      `[ZiTan] Dong Chinese data loaded: ${wordsData.count} words, ${charsData.count} chars`
    );
  } catch (err) {
    console.error('[ZiTan] Failed to load Dong Chinese data:', err);
    dongLoadPromise = null;
  }
}

// ---- Message Handling ----

async function handleLookup(
  text: string,
  maxResults: number = 7
): Promise<WordLookupResult | null> {
  await ensureDictLoaded();
  await ensureDongDictsLoaded();

  const result = await longestPrefixLookup(text, 10);
  if (!result) return null;

  const matchText = text.substring(0, result.matchLen);

  // Also look up Dong Chinese word entries for the matched text
  let dongEntries: DongWordEntry[] = [];
  try {
    dongEntries = await lookupDongWord(matchText);
  } catch {
    // Non-critical, continue without Dong data
  }

  return {
    entries: result.entries.slice(0, maxResults),
    matchLen: result.matchLen,
    matchText,
    dongEntries,
  };
}

async function handleLookupChar(
  char: string
): Promise<CharLookupResult> {
  await ensureDongDictsLoaded();

  let entry: DongCharEntry | null = null;
  try {
    entry = await lookupDongChar(char);
  } catch {
    // Non-critical
  }

  return { char, entry };
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

      case 'lookupChar':
        handleLookupChar(message.char).then(sendResponse);
        return true;

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
    id: 'zitan-toggle',
    title: 'Toggle ZiTan Dictionary',
    contexts: ['action'],
  },
  () => chrome.runtime.lastError // Suppress duplicate error
);

chrome.contextMenus?.onClicked.addListener((info) => {
  if (info.menuItemId === 'zitan-toggle') {
    loadSettings().then(async (s) => {
      const save = saveSettings;
      const updated = await save({ enabled: !s.enabled });
      broadcastState(updated);
    });
  }
});

// ---- Action Click (toolbar icon) ----

function updateIcon(enabled: boolean): void {
  const suffix = enabled ? '' : '-off';
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
      128: `icons/icon128${suffix}.png`,
    },
  });
}

chrome.action.onClicked.addListener(() => {
  loadSettings().then(async (s) => {
    const save = saveSettings;
    const updated = await save({ enabled: !s.enabled });
    broadcastState(updated);
    updateIcon(updated.enabled);
  });
});

// ---- Initialization ----

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[ZiTan] Extension installed, loading dictionaries...');
  ensureDictLoaded();
  ensureDongDictsLoaded();

  // Re-inject content script into existing tabs so the user doesn't have to reload
  if (details.reason === 'install' || details.reason === 'update') {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        }).catch(() => {
          // Tab might not be scriptable
        });
      }
    }
  }
});

// Also ensure loaded on service worker startup
ensureDictLoaded();
ensureDongDictsLoaded();

// Set icon based on current enabled state
loadSettings().then((s) => {
  updateIcon(s.enabled);
});

// Watch for settings changes and broadcast to all tabs
onSettingsChanged((s) => {
  settings = s;
  // Broadcast settings changes to all content scripts
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'settingsChanged',
          settings: s,
        }).catch(() => {
          // Tab may not have content script
        });
      }
    }
  });
});

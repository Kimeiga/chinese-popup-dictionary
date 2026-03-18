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
  lookupEntries,
  lookupDongWord,
  lookupDongChar,
  getMeta,
} from '../common/db';
import { loadSettings, saveSettings, onSettingsChanged } from '../common/settings';
import type {
  ContentToBackground,
  DictEntry,
  DongWordEntry,
  DongWordEntryRaw,
  DongCharEntry,
  DongCharEntryRaw,
  DongTopWord,
  DongTopWordRaw,
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

/** Expand compact topWords from raw format */
function expandTopWords(raw?: DongTopWordRaw[]): DongTopWord[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map(tw => ({
    word: tw.w,
    trad: tw.t,
    share: tw.s,
    gloss: tw.g,
  }));
}

/** Expand compact word entry to full format */
function expandWordEntry(simp: string, raw: DongWordEntryRaw): DongWordEntry {
  const entry: DongWordEntry = {
    simp,
    trad: raw.t,
    items: raw.i as DongWordEntry['items'],
  };
  if (raw.g) entry.gloss = raw.g;
  if (raw.s) {
    entry.statistics = {
      ...raw.s,
      topWords: expandTopWords(raw.s.topWords as unknown as DongTopWordRaw[]),
    };
  }
  return entry;
}

/** Expand compact char entry to full format */
function expandCharEntry(char: string, raw: DongCharEntryRaw): DongCharEntry {
  const entry: DongCharEntry = { char };
  if (raw.cp) entry.codepoint = raw.cp;
  if (raw.sc) entry.strokeCount = raw.sc;
  if (raw.co) entry.components = raw.co;
  if (raw.g) entry.gloss = raw.g;
  if (raw.h) entry.hint = raw.h;
  if (raw.op) entry.oldPronunciations = raw.op;
  if (raw.pf) entry.pinyinFrequencies = raw.pf;
  if (raw.om) entry.originalMeaning = raw.om;
  if (raw.vo) entry.variantOf = raw.vo;
  if (raw.tv) entry.tradVariants = raw.tv;
  if (raw.sv) entry.simpVariants = raw.sv;
  if (raw.s) {
    entry.statistics = {
      ...raw.s,
      topWords: expandTopWords(raw.s.topWords as unknown as DongTopWordRaw[]),
    };
  }
  return entry;
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

    const [wordsRaw, charsRaw] = await Promise.all([
      wordsResponse.json() as Promise<Record<string, DongWordEntryRaw[]>>,
      charsResponse.json() as Promise<Record<string, DongCharEntryRaw>>,
    ]);

    // Expand compact entries to full format for IndexedDB
    const wordIndex: Record<string, DongWordEntry[]> = {};
    let wordCount = 0;
    for (const [simp, rawEntries] of Object.entries(wordsRaw)) {
      wordIndex[simp] = rawEntries.map(r => expandWordEntry(simp, r));
      wordCount += rawEntries.length;
    }

    const charMap: Record<string, DongCharEntry> = {};
    for (const [char, rawEntry] of Object.entries(charsRaw)) {
      charMap[char] = expandCharEntry(char, rawEntry);
    }

    await Promise.all([
      loadDongWords(wordIndex),
      loadDongChars(charMap),
    ]);

    console.log(
      `[ZiTan] Dong Chinese data loaded: ${wordCount} words, ${Object.keys(charMap).length} chars`
    );
  } catch (err) {
    console.error('[ZiTan] Failed to load Dong Chinese data:', err);
    dongLoadPromise = null;
  }
}

// ---- Variant Resolution & Entry Ordering ----

// Matches: "variant of 臺灣|台湾[Tai2 wan1]" or "old variant of 來[lai2]"
const VARIANT_RE = /^(.*?variant) of (?:(\S+?)\|)?(\S+?)\[([^\]]+)\]$/i;

/**
 * Check if a CEDICT entry is purely a variant reference (all definitions
 * are "variant of X" with no real content). If so, return the parsed
 * reference(s). Mixed entries (some variant, some real defs) are left as-is.
 */
function parseVariantRef(
  entry: DictEntry
): { type: string; simplified: string; traditional?: string; pinyin: string } | null {
  // Only resolve if ALL definitions are variant references
  for (const def of entry.definitions) {
    if (!VARIANT_RE.test(def)) return null;
  }

  // Use the first variant reference
  const match = entry.definitions[0].match(VARIANT_RE);
  if (!match) return null;

  return {
    type: match[1],           // e.g. "variant", "old variant"
    traditional: match[2],    // may be undefined if no TRAD|SIMP format
    simplified: match[3],
    pinyin: match[4],
  };
}

/**
 * Resolve variant entries:
 * - Self-referencing variants ("old variant of 和[he2]" when looking at 和)
 *   are removed entirely.
 * - Variants pointing to a different word get their definitions replaced
 *   with the target's definitions + a variantOf label.
 */
async function resolveVariants(
  entries: DictEntry[],
  matchText: string
): Promise<DictEntry[]> {
  const resolved: DictEntry[] = [];

  for (const entry of entries) {
    const ref = parseVariantRef(entry);
    if (!ref) {
      resolved.push(entry);
      continue;
    }

    // Self-referencing variant: the referenced word is the same as
    // what's highlighted. This entry adds no value — skip it.
    if (ref.simplified === matchText || ref.simplified === entry.simplified ||
        (ref.traditional && ref.traditional === entry.traditional)) {
      continue;
    }

    // Look up the referenced entry
    let refEntries = await lookupEntries(ref.simplified, 'simplified');
    if (refEntries.length === 0 && ref.traditional) {
      refEntries = await lookupEntries(ref.traditional, 'traditional');
    }

    if (refEntries.length > 0) {
      // Filter out variant-only entries from the target to avoid chains
      const realRef = refEntries.find(e => !parseVariantRef(e));
      if (realRef) {
        resolved.push({
          ...entry,
          definitions: realRef.definitions,
          variantOf: `${ref.type} of ${ref.simplified}`,
        });
      }
    } else {
      resolved.push(entry);
    }
  }

  return resolved;
}

/**
 * Sort entries so the most common pronunciation comes first.
 * Uses dong word items order (first item = primary pronunciation)
 * and puts variant/surname entries at the bottom.
 */
function sortEntries(entries: DictEntry[], dongEntries: DongWordEntry[]): DictEntry[] {
  if (entries.length <= 1) return entries;

  // Get the primary pinyin from dong data (first item = most common)
  let primaryPinyin: string | null = null;
  if (dongEntries.length > 0) {
    const items = dongEntries[0].items;
    if (items.length > 0) {
      const firstItem = items[0] as { pinyin?: string };
      if (firstItem.pinyin) {
        primaryPinyin = firstItem.pinyin.toLowerCase();
      }
    }
  }

  return [...entries].sort((a, b) => {
    const aScore = entryPriority(a, primaryPinyin);
    const bScore = entryPriority(b, primaryPinyin);
    return aScore - bScore;
  });
}

function entryPriority(entry: DictEntry, primaryPinyin: string | null): number {
  // Variants always go to the bottom
  if (entry.variantOf) return 100;

  // Surname entries go near the bottom
  if (entry.definitions.some(d => d.startsWith('surname '))) return 90;

  // If we have dong data, boost entries matching the primary pinyin
  if (primaryPinyin) {
    const entryPinyin = entry.pinyinRaw.toLowerCase();
    if (entryPinyin === primaryPinyin) return 0;
  }

  // Default: keep original order
  return 50;
}

// ---- Message Handling ----

async function handleLookup(
  text: string,
  maxResults: number = 7
): Promise<WordLookupResult | null> {
  await ensureDictLoaded();

  const result = await longestPrefixLookup(text, 10);
  if (!result) return null;

  const matchText = text.substring(0, result.matchLen);

  // Try Dong Chinese enrichment without blocking — if dicts aren't loaded
  // yet, just return without dong data so the popup appears instantly.
  let dongEntries: DongWordEntry[] = [];
  try {
    const dongLoaded = await isDongLoaded();
    if (dongLoaded) {
      dongEntries = await lookupDongWord(matchText);
    }
  } catch {
    // Non-critical, continue without Dong data
  }

  // Resolve variant entries (e.g. "variant of X") and filter self-references
  let resolvedEntries = await resolveVariants(
    result.entries.slice(0, maxResults + 5), // extra buffer since some get filtered
    matchText
  );

  // Sort by frequency: primary pronunciation first, surnames/variants last
  resolvedEntries = sortEntries(resolvedEntries, dongEntries);

  // Apply limit after filtering and sorting
  resolvedEntries = resolvedEntries.slice(0, maxResults);

  return {
    entries: resolvedEntries,
    matchLen: result.matchLen,
    matchText,
    dongEntries,
  };
}

async function handleLookupChar(
  char: string
): Promise<CharLookupResult> {
  // Don't block — if dong dicts aren't loaded yet, return null entry
  let entry: DongCharEntry | null = null;
  try {
    const dongLoaded = await isDongLoaded();
    if (dongLoaded) {
      entry = await lookupDongChar(char);
    }
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

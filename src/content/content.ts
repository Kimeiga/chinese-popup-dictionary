/**
 * Content script - injected into web pages.
 *
 * Keyboard shortcuts (when popup visible, not in input):
 *   Shift   (keyup) - switch Word ↔ Character tab
 *   c       - copy word (simplified hanzi)
 *   t       - copy traditional hanzi
 *   r       - copy pinyin reading
 *   g       - copy gloss (Dong short definition)
 *   e       - copy full entry (word + pinyin + defs)
 *   n / b   - select next / previous entry
 *   1-9     - select nth entry
 *   d       - toggle definitions on/off
 *   [ / ]   - shrink / extend highlighted text length
 *   Escape  - close popup
 */

import { getTextAtPoint, clearTextAtPointCache } from './text-at-point';
import {
  showPopup,
  hidePopup,
  removePopup,
  updatePopupSettings,
  isPopupVisible,
  getCurrentTab,
  setCurrentTab,
  setCharResult,
  rerenderPopup,
  toggleDefinitions,
  getCurrentWordResult,
  getCharResult,
  getEntryCount,
  getHoveredChar,
  getSelectedIndex,
  setSelectedIndex,
  showCopiedFeedback,
  setTabClickHandler,
} from './popup/popup';
import type {
  BackgroundToContent,
  ExtensionSettings,
  WordLookupResult,
  CharLookupResult,
} from '../common/types';
import { DEFAULT_SETTINGS } from '../common/types';

let enabled = true;
let settings: ExtensionSettings = DEFAULT_SETTINGS;
let lastLookupText = '';
let highlightedRange: Range | null = null;

// Cached character results
const cachedCharResults = new Map<string, CharLookupResult>();

// Current lookup context for [ ] highlight adjustment
let currentTextNode: Text | null = null;
let currentTextOffset: number = 0;
let currentMatchLen: number = 0;
let currentFullText: string = '';
let currentCursorX: number = 0;
let currentCursorY: number = 0;

// ---- Domain Matching ----

/** Proper suffix matching: "example.com" matches "example.com" and "sub.example.com" but not "notexample.com" */
function domainMatches(hostname: string, pattern: string): boolean {
  const p = pattern.toLowerCase().trim();
  const h = hostname.toLowerCase();
  if (h === p) return true;
  return h.endsWith('.' + p);
}

// ---- Initialization ----

async function init(): Promise<void> {
  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  if (state) {
    enabled = state.enabled;
    if (state.settings) {
      settings = state.settings;
      updatePopupSettings(settings);
    }
  }

  if (settings.blocklist.some((d) => domainMatches(window.location.hostname, d))) {
    enabled = false;
    return;
  }

  // Wire up tab click handler for popup tab buttons
  setTabClickHandler((tab) => {
    if (tab === 'character') {
      const hoveredChar = getHoveredChar();
      if (hoveredChar) lookupCharAndUpdate(hoveredChar);
    }
  });

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mousedown', onMouseDown, { passive: true });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  chrome.runtime.onMessage.addListener(onBackgroundMessage);
}

// ---- Event Handlers ----

function onMouseMove(e: MouseEvent): void {
  if (!enabled) return;
  doLookup(e.clientX, e.clientY);
}

function onMouseDown(): void {
  dismissPopup();
}

function dismissPopup(): void {
  clearHighlight();
  clearTextAtPointCache();
  hidePopup();
  lastLookupText = '';
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    dismissPopup();
    return;
  }

  if (isInputFocused()) return;
  if (!isPopupVisible()) return;

  switch (e.key) {
    case 'c': copyWord(); e.preventDefault(); break;
    case 't': copyTraditional(); e.preventDefault(); break;
    case 'r': copyPinyin(); e.preventDefault(); break;
    case 'g': copyGloss(); e.preventDefault(); break;
    case 'e': copyFullEntry(); e.preventDefault(); break;
    case 'n': selectNext(); e.preventDefault(); break;
    case 'b': selectPrev(); e.preventDefault(); break;
    case 'd': toggleDefinitions(); e.preventDefault(); break;
    case '[': adjustHighlight(-1); e.preventDefault(); break;
    case ']': adjustHighlight(+1); e.preventDefault(); break;
    default:
      // 1-9 to select entry
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < getEntryCount()) {
          setSelectedIndex(idx);
          e.preventDefault();
        }
      }
      break;
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Shift' && !isInputFocused() && isPopupVisible()) {
    const newTab = getCurrentTab() === 'word' ? 'character' as const : 'word' as const;
    setCurrentTab(newTab);

    if (newTab === 'character') {
      const hoveredChar = getHoveredChar();
      if (hoveredChar) lookupCharAndUpdate(hoveredChar);
    }

    rerenderPopup();
  }
}

function onScroll(): void {
  dismissPopup();
}

function onBackgroundMessage(message: BackgroundToContent): void {
  switch (message.type) {
    case 'stateChanged':
      enabled = message.enabled;
      if (!enabled) { dismissPopup(); }
      break;
    case 'settingsChanged':
      settings = message.settings;
      updatePopupSettings(settings);
      if (settings.blocklist.some((d) => domainMatches(window.location.hostname, d))) {
        enabled = false;
        dismissPopup();
      }
      break;
  }
}

// ---- Lookup ----

async function doLookup(x: number, y: number): Promise<void> {
  const textInfo = getTextAtPoint(x, y);
  if (!textInfo || !textInfo.text) {
    // getTextAtPoint returns null only when cursor is truly outside CJK text
    // (it handles hysteresis and bbox caching internally)
    if (isPopupVisible()) {
      dismissPopup();
    }
    return;
  }

  // getTextAtPoint's bbox cache ensures same-character hovers return the same
  // text, so this dedup check is sufficient to prevent redundant lookups
  if (textInfo.text === lastLookupText) return;
  lastLookupText = textInfo.text;

  try {
    const result: WordLookupResult | null = await chrome.runtime.sendMessage({
      type: 'lookup',
      text: textInfo.text,
      maxResults: settings.maxEntries,
    });

    if (!result || result.entries.length === 0) {
      clearHighlight();
      hidePopup();
      return;
    }

    // Store lookup context for [ ] adjustment
    currentTextNode = textInfo.node;
    currentTextOffset = textInfo.offset;
    currentMatchLen = result.matchLen;
    currentFullText = textInfo.text;
    currentCursorX = x;
    currentCursorY = y;

    highlightMatch(textInfo.node!, textInfo.offset, result.matchLen);

    const hoveredChar = result.matchText.charAt(0);
    const charResult = cachedCharResults.get(hoveredChar) || null;

    showPopup(result, charResult, hoveredChar, x, y);

    if (!charResult && hoveredChar) {
      lookupCharAndUpdate(hoveredChar);
    }
  } catch (err) {
    console.debug('[ZiTan] Lookup failed:', err);
  }
}

async function lookupCharAndUpdate(char: string): Promise<void> {
  if (cachedCharResults.has(char)) {
    const cached = cachedCharResults.get(char)!;
    setCharResult(cached);
    if (getCurrentTab() === 'character') rerenderPopup();
    return;
  }

  try {
    const charResult: CharLookupResult = await chrome.runtime.sendMessage({
      type: 'lookupChar',
      char,
    });
    if (charResult) {
      cachedCharResults.set(char, charResult);
      setCharResult(charResult);
      if (getCurrentTab() === 'character' && isPopupVisible()) rerenderPopup();
    }
  } catch { /* non-critical */ }
}

// ---- Highlight Length Adjustment ----

async function adjustHighlight(delta: number): Promise<void> {
  if (!currentTextNode || !currentFullText) return;

  const newLen = currentMatchLen + delta;
  if (newLen < 1 || newLen > currentFullText.length) return;

  // Re-lookup with the new text length
  const newText = currentFullText.substring(0, newLen);

  try {
    const result: WordLookupResult | null = await chrome.runtime.sendMessage({
      type: 'lookup',
      text: newText,
      maxResults: settings.maxEntries,
    });

    if (result && result.entries.length > 0) {
      currentMatchLen = newLen;
      highlightMatch(currentTextNode, currentTextOffset, newLen);

      const hoveredChar = newText.charAt(0);
      const charResult = cachedCharResults.get(hoveredChar) || null;
      showPopup(result, charResult, hoveredChar, currentCursorX, currentCursorY);
    } else if (delta < 0) {
      currentMatchLen = newLen;
      highlightMatch(currentTextNode, currentTextOffset, newLen);
    }
  } catch { /* non-critical */ }
}

// ---- Copy Operations ----

function copyWord(): void {
  if (getCurrentTab() === 'character') {
    const char = getHoveredChar();
    if (char) doCopy(char, 'char');
    return;
  }

  const result = getCurrentWordResult();
  if (!result) return;
  const idx = getSelectedIndex();
  const entry = result.entries[idx];
  if (entry) doCopy(entry.simplified, 'word');
}

function copyTraditional(): void {
  const result = getCurrentWordResult();
  if (!result) return;
  const idx = getSelectedIndex();
  const entry = result.entries[idx];
  if (entry) doCopy(entry.traditional, 'trad');
}

function copyPinyin(): void {
  if (getCurrentTab() === 'character') {
    const charResult = getCharResult();
    if (charResult?.entry?.pinyinFrequencies?.length) {
      const pinyins = charResult.entry.pinyinFrequencies.map(pf => pf.pinyin).join(', ');
      doCopy(pinyins, 'pinyin');
    }
    return;
  }

  const result = getCurrentWordResult();
  if (!result) return;
  const idx = getSelectedIndex();
  const entry = result.entries[idx];
  if (entry) doCopy(entry.pinyin, 'pinyin');
}

function copyGloss(): void {
  if (getCurrentTab() === 'character') {
    const charResult = getCharResult();
    if (charResult?.entry?.gloss) doCopy(charResult.entry.gloss, 'gloss');
    return;
  }

  const result = getCurrentWordResult();
  if (!result) return;
  const dongEntries = result.dongEntries;
  if (dongEntries.length > 0 && dongEntries[0].gloss) {
    doCopy(dongEntries[0].gloss, 'gloss');
  } else {
    const idx = getSelectedIndex();
    const entry = result.entries[idx];
    if (entry && entry.definitions.length > 0) {
      doCopy(entry.definitions[0], 'def');
    }
  }
}

function copyFullEntry(): void {
  const result = getCurrentWordResult();
  if (!result) return;
  const idx = getSelectedIndex();
  const entry = result.entries[idx];
  if (!entry) return;

  const text = `${entry.simplified}${entry.traditional !== entry.simplified ? ` (${entry.traditional})` : ''} [${entry.pinyin}] ${entry.definitions.join('; ')}`;
  doCopy(text, 'entry');
}

function selectNext(): void {
  const count = getEntryCount();
  if (count === 0) return;
  const idx = (getSelectedIndex() + 1) % count;
  setSelectedIndex(idx);
}

function selectPrev(): void {
  const count = getEntryCount();
  if (count === 0) return;
  const idx = (getSelectedIndex() - 1 + count) % count;
  setSelectedIndex(idx);
}

async function doCopy(text: string, what: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showCopiedFeedback(what);
  } catch {
    console.debug('[ZiTan] Clipboard write failed');
  }
}

// ---- Text Highlighting (CSS Custom Highlight API — no DOM mutation) ----

const HIGHLIGHT_NAME = 'zitan-highlight';

function ensureHighlightStyle(): void {
  if (document.querySelector('style[data-zitan-highlight]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-zitan-highlight', '');
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 220, 100, 0.35); }`;
  document.head.appendChild(style);
}

function highlightMatch(node: Text, offset: number, length: number): void {
  clearHighlight();
  try {
    ensureHighlightStyle();
    const range = document.createRange();
    const endOffset = Math.min(offset + length, node.textContent?.length || 0);
    range.setStart(node, offset);
    range.setEnd(node, endOffset);
    highlightedRange = range;
    // @ts-ignore — CSS Custom Highlight API
    const highlight = new Highlight(range);
    // @ts-ignore
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  } catch {
    // Fallback: no highlight, but lookup still works
  }
}

function clearHighlight(): void {
  try {
    // @ts-ignore
    CSS.highlights?.delete(HIGHLIGHT_NAME);
  } catch { /* ok */ }
  highlightedRange = null;
}

// ---- Cleanup ----

function cleanup(): void {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('scroll', onScroll);
  clearHighlight();
  clearTextAtPointCache();
  removePopup();
}

// Start
init().catch((err) => console.debug('[ZiTan] Init failed:', err));

/**
 * Content script - the main entry point injected into web pages.
 *
 * Listens for mouse movement over CJK text, sends lookup requests
 * to the background service worker, and displays results in a
 * Shadow DOM popup.
 */

import { getTextAtPoint } from './text-at-point';
import { showPopup, hidePopup, removePopup, updatePopupSettings } from './popup/popup';
import type {
  BackgroundToContent,
  ExtensionSettings,
  LookupResult,
} from '../common/types';
import { DEFAULT_SETTINGS } from '../common/types';

let enabled = true;
let settings: ExtensionSettings = DEFAULT_SETTINGS;
let lastLookupText = '';
let lookupTimeout: ReturnType<typeof setTimeout> | null = null;
let highlightedRange: Range | null = null;
let highlightMark: HTMLElement | null = null;

// ---- Initialization ----

async function init(): Promise<void> {
  // Get initial state from background
  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  if (state) {
    enabled = state.enabled;
    if (state.settings) {
      settings = state.settings;
      updatePopupSettings(settings);
    }
  }

  // Check if current domain is blacklisted
  if (settings.blacklist.some((d) => window.location.hostname.includes(d))) {
    enabled = false;
    return;
  }

  // Register event listeners
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mousedown', onMouseDown, { passive: true });
  document.addEventListener('keydown', onKeyDown, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(onBackgroundMessage);
}

// ---- Event Handlers ----

function onMouseMove(e: MouseEvent): void {
  if (!enabled) return;

  // Debounce: wait for mouse to settle
  if (lookupTimeout) clearTimeout(lookupTimeout);
  lookupTimeout = setTimeout(() => {
    doLookup(e.clientX, e.clientY);
  }, 50);
}

function onMouseDown(): void {
  clearHighlight();
  hidePopup();
  lastLookupText = '';
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    clearHighlight();
    hidePopup();
    lastLookupText = '';
  }
}

function onScroll(): void {
  clearHighlight();
  hidePopup();
  lastLookupText = '';
}

function onBackgroundMessage(message: BackgroundToContent): void {
  switch (message.type) {
    case 'stateChanged':
      enabled = message.enabled;
      if (!enabled) {
        clearHighlight();
        hidePopup();
      }
      break;
    case 'settingsChanged':
      settings = message.settings;
      updatePopupSettings(settings);
      // Re-check blacklist
      if (
        settings.blacklist.some((d) => window.location.hostname.includes(d))
      ) {
        enabled = false;
        clearHighlight();
        hidePopup();
      }
      break;
  }
}

// ---- Lookup Logic ----

async function doLookup(x: number, y: number): Promise<void> {
  const textInfo = getTextAtPoint(x, y);
  if (!textInfo || !textInfo.text) {
    clearHighlight();
    hidePopup();
    lastLookupText = '';
    return;
  }

  // Skip if we already looked up this exact text
  if (textInfo.text === lastLookupText) return;
  lastLookupText = textInfo.text;

  try {
    const result: LookupResult | null = await chrome.runtime.sendMessage({
      type: 'lookup',
      text: textInfo.text,
      maxResults: settings.maxEntries,
    });

    if (!result || result.entries.length === 0) {
      clearHighlight();
      hidePopup();
      return;
    }

    // Highlight the matched text in the document
    highlightMatch(textInfo.node!, textInfo.offset, result.matchLen);

    // Show popup
    showPopup(result.entries, x, y);
  } catch (err) {
    // Service worker may be inactive, ignore gracefully
    console.debug('[TenZhong] Lookup failed:', err);
  }
}

// ---- Text Highlighting ----

function highlightMatch(
  node: Text,
  offset: number,
  length: number
): void {
  clearHighlight();

  try {
    const range = document.createRange();
    const endOffset = Math.min(offset + length, node.textContent?.length || 0);
    range.setStart(node, offset);
    range.setEnd(node, endOffset);

    // Use a <mark> element for highlighting
    highlightMark = document.createElement('mark');
    highlightMark.style.cssText =
      'background: rgba(255, 220, 100, 0.35); border-radius: 2px; padding: 0; margin: 0;';
    range.surroundContents(highlightMark);
    highlightedRange = range;
  } catch {
    // surroundContents can fail with cross-node ranges - that's OK
  }
}

function clearHighlight(): void {
  if (highlightMark && highlightMark.parentNode) {
    const parent = highlightMark.parentNode;
    while (highlightMark.firstChild) {
      parent.insertBefore(highlightMark.firstChild, highlightMark);
    }
    parent.removeChild(highlightMark);
    parent.normalize(); // Merge adjacent text nodes
  }
  highlightMark = null;
  highlightedRange = null;
}

// ---- Cleanup ----

function cleanup(): void {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('scroll', onScroll);
  clearHighlight();
  removePopup();
}

// Start
init().catch((err) => console.debug('[TenZhong] Init failed:', err));

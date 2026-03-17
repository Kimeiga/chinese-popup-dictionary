/**
 * Shadow DOM popup component.
 *
 * Creates a custom element with an attached shadow root to completely
 * isolate dictionary popup styles from the host page.
 */

import type { DictEntry, ExtensionSettings } from '../../common/types';
import { DEFAULT_SETTINGS } from '../../common/types';
import { getToneNumber, splitPinyin, pinyinToZhuyin, numberToToneMark } from '../../common/pinyin';
import { getPopupStyles } from './popup-styles';

const HOST_ID = 'tenzhong-popup-host';

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let popupEl: HTMLElement | null = null;
let currentSettings: ExtensionSettings = DEFAULT_SETTINGS;

export function updatePopupSettings(settings: ExtensionSettings): void {
  currentSettings = settings;
  // Update theme if popup exists
  if (shadowRoot) {
    const styleEl = shadowRoot.querySelector('style');
    if (styleEl) {
      styleEl.textContent = getPopupStyles(settings.theme);
    }
    if (hostEl) {
      hostEl.className = `font-${settings.fontSize}`;
    }
  }
}

function ensureHost(): { host: HTMLElement; shadow: ShadowRoot } {
  if (hostEl && shadowRoot) return { host: hostEl, shadow: shadowRoot };

  // Remove any stale host
  document.getElementById(HOST_ID)?.remove();

  hostEl = document.createElement('div');
  hostEl.id = HOST_ID;
  hostEl.className = `font-${currentSettings.fontSize}`;
  shadowRoot = hostEl.attachShadow({ mode: 'open' });

  // Inject styles
  const style = document.createElement('style');
  style.textContent = getPopupStyles(currentSettings.theme);
  shadowRoot.appendChild(style);

  document.documentElement.appendChild(hostEl);
  return { host: hostEl, shadow: shadowRoot };
}

/**
 * Show the popup with lookup results near the cursor position.
 */
export function showPopup(
  entries: DictEntry[],
  x: number,
  y: number
): void {
  const { shadow } = ensureHost();

  // Create or reuse popup element
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.className = 'tz-popup';
    shadow.appendChild(popupEl);
  }

  // Build content
  popupEl.innerHTML = entries
    .slice(0, currentSettings.maxEntries)
    .map((entry) => renderEntry(entry))
    .join('');

  popupEl.classList.remove('tz-hidden');

  // Position the popup
  requestAnimationFrame(() => {
    if (!popupEl) return;
    positionPopup(popupEl, x, y);
  });
}

/**
 * Hide the popup.
 */
export function hidePopup(): void {
  if (popupEl) {
    popupEl.classList.add('tz-hidden');
  }
}

/**
 * Remove the popup host entirely.
 */
export function removePopup(): void {
  hostEl?.remove();
  hostEl = null;
  shadowRoot = null;
  popupEl = null;
}

// ---- Rendering ----

function renderEntry(entry: DictEntry): string {
  const charDisplay = currentSettings.charDisplay;

  let primaryHanzi: string;
  let secondaryHanzi: string | null = null;

  if (charDisplay === 'simplified') {
    primaryHanzi = entry.simplified;
  } else if (charDisplay === 'traditional') {
    primaryHanzi = entry.traditional;
  } else {
    // 'both'
    primaryHanzi = entry.simplified;
    if (entry.traditional !== entry.simplified) {
      secondaryHanzi = entry.traditional;
    }
  }

  const pinyinHtml = renderPinyin(entry.pinyinRaw);
  const zhuyinHtml = currentSettings.showZhuyin
    ? `<div class="tz-zhuyin">${renderZhuyin(entry.pinyinRaw)}</div>`
    : '';

  const defsHtml = entry.definitions
    .map((d, i) => {
      const num =
        entry.definitions.length > 1
          ? `<span class="tz-def-num">${i + 1}.</span>`
          : '';
      return `<div class="tz-def-item">${num}${escapeHtml(d)}</div>`;
    })
    .join('');

  return `
    <div class="tz-entry">
      <div class="tz-hanzi-row">
        <span class="tz-hanzi">${escapeHtml(primaryHanzi)}</span>
        ${secondaryHanzi ? `<span class="tz-hanzi-alt">${escapeHtml(secondaryHanzi)}</span>` : ''}
      </div>
      <div class="tz-pinyin">${pinyinHtml}</div>
      ${zhuyinHtml}
      <div class="tz-definitions">${defsHtml}</div>
    </div>
  `;
}

function renderPinyin(pinyinRaw: string): string {
  const syllables = splitPinyin(pinyinRaw);
  return syllables
    .map((syl) => {
      const tone = getToneNumber(syl);
      const color = currentSettings.showToneColors
        ? currentSettings.toneColors[tone - 1]
        : 'inherit';
      // Convert to tone mark display
      const display = numberToToneMarkDisplay(syl);
      return `<span class="tz-pinyin-syllable" style="color:${color}">${escapeHtml(display)}</span>`;
    })
    .join(' ');
}

function renderZhuyin(pinyinRaw: string): string {
  return splitPinyin(pinyinRaw)
    .map((syl) => pinyinToZhuyin(syl))
    .join(' ');
}

/** Simple tone mark conversion for display */
function numberToToneMarkDisplay(syllable: string): string {
  return numberToToneMark(syllable);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Positioning ----

function positionPopup(el: HTMLElement, x: number, y: number): void {
  const OFFSET = 15;
  const PADDING = 8;

  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const popW = el.offsetWidth;
  const popH = el.offsetHeight;

  // Horizontal: prefer right of cursor, fall back to left
  let left = x + OFFSET;
  if (left + popW + PADDING > viewW) {
    left = x - popW - OFFSET;
  }
  left = Math.max(PADDING, Math.min(left, viewW - popW - PADDING));

  // Vertical: prefer below cursor, fall back to above
  let top = y + OFFSET;
  if (top + popH + PADDING > viewH) {
    top = y - popH - OFFSET;
  }
  top = Math.max(PADDING, Math.min(top, viewH - popH - PADDING));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

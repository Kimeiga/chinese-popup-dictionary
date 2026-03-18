/**
 * Shadow DOM popup component.
 *
 * Tabbed UI (Word / Character) with Dong Chinese enriched data.
 * Immediate-action copy shortcuts (no separate mode to enter).
 */

import type {
  DictEntry,
  DongWordEntry,
  DongWordItem,
  DongCharEntry,
  ExtensionSettings,
  WordLookupResult,
  CharLookupResult,
  PopupTab,
  CopyState,
} from '../../common/types';
import { DEFAULT_SETTINGS } from '../../common/types';
import { getToneNumber, splitPinyin, pinyinToZhuyin, numberToToneMark } from '../../common/pinyin';
import { getPopupStyles } from './popup-styles';

const HOST_ID = 'zitan-popup-host';

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let popupEl: HTMLElement | null = null;
let currentSettings: ExtensionSettings = DEFAULT_SETTINGS;

// Module state
let currentTab: PopupTab = 'word';
let currentWordResult: WordLookupResult | null = null;
let currentCharResult: CharLookupResult | null = null;
let currentHoveredChar: string = '';
let copyState: CopyState = { mode: 'inactive', selectedIndex: 0 };
let showDefinitions: boolean = true;
let lastX: number = 0;
let lastY: number = 0;
let copiedTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Callback for tab click events (set by content.ts)
let onTabClickCallback: ((tab: PopupTab) => void) | null = null;

export function setTabClickHandler(cb: (tab: PopupTab) => void): void {
  onTabClickCallback = cb;
}

export function updatePopupSettings(settings: ExtensionSettings): void {
  currentSettings = settings;
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

  document.getElementById(HOST_ID)?.remove();
  hostEl = document.createElement('div');
  hostEl.id = HOST_ID;
  hostEl.className = `font-${currentSettings.fontSize}`;
  shadowRoot = hostEl.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = getPopupStyles(currentSettings.theme);
  shadowRoot.appendChild(style);

  document.documentElement.appendChild(hostEl);
  return { host: hostEl, shadow: shadowRoot };
}

// ---- Public API ----

export function showPopup(
  wordResult: WordLookupResult,
  charResult: CharLookupResult | null,
  hoveredChar: string,
  x: number,
  y: number
): void {
  currentWordResult = wordResult;
  currentCharResult = charResult;
  currentHoveredChar = hoveredChar;
  currentTab = 'word';
  copyState = { mode: 'inactive', selectedIndex: 0 };
  showDefinitions = true;
  lastX = x;
  lastY = y;
  renderPopup();
}

export function rerenderPopup(): void {
  if (!currentWordResult) return;
  renderPopup();
}

export function isPopupVisible(): boolean {
  return !!popupEl && !popupEl.classList.contains('tz-hidden');
}

export function getCurrentTab(): PopupTab {
  return currentTab;
}

export function setCurrentTab(tab: PopupTab): void {
  currentTab = tab;
}

export function setCharResult(result: CharLookupResult): void {
  currentCharResult = result;
}

export function getCopyState(): CopyState {
  return copyState;
}

export function setCopyState(state: CopyState): void {
  copyState = state;
  rerenderPopup();
}

export function toggleDefinitions(): void {
  showDefinitions = !showDefinitions;
  rerenderPopup();
}

export function getCurrentWordResult(): WordLookupResult | null {
  return currentWordResult;
}

export function getCharResult(): CharLookupResult | null {
  return currentCharResult;
}

export function getEntryCount(): number {
  if (!currentWordResult) return 0;
  return currentWordResult.entries.length;
}

export function getHoveredChar(): string {
  return currentHoveredChar;
}

export function getSelectedIndex(): number {
  return copyState.selectedIndex;
}

export function setSelectedIndex(index: number): void {
  copyState = { ...copyState, selectedIndex: index, mode: 'inactive' };
  rerenderPopup();
}

export function showCopiedFeedback(what: string): void {
  const idx = copyState.selectedIndex;
  copyState = { mode: 'copied', what, selectedIndex: idx };
  rerenderPopup();
  if (copiedTimeoutId !== null) clearTimeout(copiedTimeoutId);
  copiedTimeoutId = setTimeout(() => {
    copiedTimeoutId = null;
    if (copyState.mode === 'copied') {
      copyState = { mode: 'inactive', selectedIndex: idx };
      rerenderPopup();
    }
  }, 600);
}

export function hidePopup(): void {
  if (popupEl) {
    popupEl.classList.add('tz-hidden');
  }
  currentWordResult = null;
  currentCharResult = null;
  copyState = { mode: 'inactive', selectedIndex: 0 };
}

export function removePopup(): void {
  hostEl?.remove();
  hostEl = null;
  shadowRoot = null;
  popupEl = null;
  currentWordResult = null;
  currentCharResult = null;
}

// ---- Rendering ----

function renderPopup(): void {
  const { shadow } = ensureHost();

  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.className = 'tz-popup';
    shadow.appendChild(popupEl);
  }

  let html = renderTabBar();

  if (currentTab === 'word') {
    html += renderWordTab();
  } else {
    html += renderCharacterTab();
  }

  // Always show shortcut hints at bottom
  html += renderFooter();

  popupEl.innerHTML = html;
  popupEl.classList.remove('tz-hidden');

  // Attach tab click handlers
  const tabButtons = popupEl.querySelectorAll('.tz-tab');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const text = (e.target as HTMLElement).textContent?.trim();
      const tab: PopupTab = text === 'Char' ? 'character' : 'word';
      if (tab !== currentTab) {
        currentTab = tab;
        if (onTabClickCallback) onTabClickCallback(tab);
        renderPopup();
      }
    });
  });

  requestAnimationFrame(() => {
    if (!popupEl) return;
    positionPopup(popupEl, lastX, lastY);
  });
}

function renderTabBar(): string {
  const wCls = currentTab === 'word' ? 'tz-tab-active' : '';
  const cCls = currentTab === 'character' ? 'tz-tab-active' : '';
  return `<div class="tz-tab-bar">
    <button class="tz-tab ${wCls}">Word</button>
    <button class="tz-tab ${cCls}">Char</button>
    <span class="tz-tab-hint">Shift</span>
  </div>`;
}

function renderFooter(): string {
  if (copyState.mode === 'copied') {
    return `<div class="tz-footer tz-copy-flash">Copied ${escapeHtml(copyState.what)}!</div>`;
  }

  const hints = currentTab === 'word'
    ? `<span class="tz-key">c</span>word <span class="tz-key">r</span>pinyin <span class="tz-key">g</span>gloss <span class="tz-key">e</span>entry <span class="tz-key">n</span>/<span class="tz-key">b</span>cycle <span class="tz-key">d</span>defs <span class="tz-key">[</span>/<span class="tz-key">]</span>len`
    : `<span class="tz-key">c</span>char <span class="tz-key">r</span>pinyin <span class="tz-key">g</span>gloss <span class="tz-key">d</span>defs`;

  return `<div class="tz-footer">${hints}</div>`;
}

// ---- Word Tab ----

function renderWordTab(): string {
  if (!currentWordResult) return '';

  const entries = currentWordResult.entries.slice(0, currentSettings.maxEntries);
  const dongEntries = currentWordResult.dongEntries;
  const dongEntry = dongEntries.length > 0 ? dongEntries[0] : null;
  const selectedIdx = copyState.selectedIndex;

  return entries
    .map((entry, i) => renderWordEntry(entry, dongEntry, i, i === selectedIdx))
    .join('');
}

function renderWordEntry(
  entry: DictEntry,
  dongEntry: DongWordEntry | null,
  index: number,
  isSelected: boolean
): string {
  const charDisplay = currentSettings.charDisplay;

  let primaryHanzi: string;
  let secondaryHanzi: string | null = null;

  if (charDisplay === 'simplified') {
    primaryHanzi = entry.simplified;
  } else if (charDisplay === 'traditional') {
    primaryHanzi = entry.traditional;
  } else {
    primaryHanzi = entry.simplified;
    if (entry.traditional !== entry.simplified) {
      secondaryHanzi = entry.traditional;
    }
  }

  // HSK badge
  let hskBadge = '';
  if (dongEntry?.statistics?.hskLevel && dongEntry.statistics.hskLevel <= 9) {
    const lvl = dongEntry.statistics.hskLevel;
    hskBadge = `<span class="tz-hsk tz-hsk-${lvl}">HSK${lvl}</span>`;
  }

  // Frequency rank (show book + movie if available)
  let freqHtml = '';
  const stats = dongEntry?.statistics;
  if (stats) {
    const parts: string[] = [];
    if (stats.bookWordRank) parts.push(`#${stats.bookWordRank}`);
    if (stats.movieWordRank) parts.push(`M#${stats.movieWordRank}`);
    if (parts.length) freqHtml = `<span class="tz-freq">${parts.join(' ')}</span>`;
  }

  // Pinyin
  const pinyinHtml = renderPinyin(entry.pinyinRaw);
  const zhuyinHtml = currentSettings.showZhuyin
    ? `<div class="tz-zhuyin">${renderZhuyin(entry.pinyinRaw)}</div>`
    : '';

  // Dong gloss (compact summary)
  let glossHtml = '';
  if (dongEntry?.gloss && showDefinitions) {
    glossHtml = `<div class="tz-gloss">${escapeHtml(dongEntry.gloss)}</div>`;
  }

  // CEDICT definitions
  let defsHtml = '';
  if (showDefinitions) {
    defsHtml = entry.definitions
      .map((d, i) => {
        const num = entry.definitions.length > 1
          ? `<span class="tz-def-num">${i + 1}.</span>`
          : '';
        return `<div class="tz-def">${num}${escapeHtml(d)}</div>`;
      })
      .join('');
  }

  // Dong items: show additional readings with their definitions (grouped by pinyin)
  let dongItemsHtml = '';
  if (dongEntry && showDefinitions) {
    // Group items by pinyin, skipping the one that matches CEDICT entry
    const readings = groupDongReadings(dongEntry.items, entry.pinyinRaw, entry.definitions);
    if (readings.length > 0) {
      dongItemsHtml = readings.map(r => {
        const defs = r.definitions.length > 0
          ? ` ${r.definitions.map(d => escapeHtml(d)).join('; ')}`
          : '';
        const tangHtml = r.tang ? ` <span class="tz-tang">Tang: ${escapeHtml(r.tang)}</span>` : '';
        return `<div class="tz-dong-reading"><span class="tz-dong-pinyin">${escapeHtml(r.pinyin)}</span>${defs}${tangHtml}</div>`;
      }).join('');
    }
  }

  // Top words (show for single-char words or when only 1 entry)
  let topWordsHtml = '';
  if (dongEntry?.statistics?.topWords && dongEntry.statistics.topWords.length > 0 && showDefinitions) {
    const words = dongEntry.statistics.topWords.slice(0, 5);
    const chips = words.map(w =>
      `<span class="tz-chip">${escapeHtml(w.word)}${w.gloss ? ` <span class="tz-chip-g">${escapeHtml(w.gloss)}</span>` : ''}</span>`
    ).join('');
    topWordsHtml = `<div class="tz-top-words">${chips}</div>`;
  }

  // Variant label
  let variantHtml = '';
  if (entry.variantOf && showDefinitions) {
    variantHtml = `<div class="tz-variant">${escapeHtml(entry.variantOf)}</div>`;
  }

  const selCls = isSelected ? 'tz-selected' : '';

  return `<div class="tz-entry ${selCls}" data-idx="${index}">
    <div class="tz-row">
      <span class="tz-hanzi">${escapeHtml(primaryHanzi)}</span>
      ${secondaryHanzi ? `<span class="tz-hanzi-alt">${escapeHtml(secondaryHanzi)}</span>` : ''}
      <span class="tz-pinyin">${pinyinHtml}</span>
      ${hskBadge}${freqHtml}
    </div>
    ${zhuyinHtml}
    ${variantHtml}
    ${showDefinitions ? `<div class="tz-defs">${glossHtml}${defsHtml}${dongItemsHtml}</div>` : ''}
    ${topWordsHtml}
  </div>`;
}

/**
 * Group Dong items by unique pinyin, merging definitions.
 * Skip definitions that duplicate CEDICT — only show extra readings or Tang data.
 */
function groupDongReadings(
  items: DongWordItem[],
  cedictPinyinRaw: string,
  cedictDefinitions: string[]
): { pinyin: string; definitions: string[]; tang?: string }[] {
  // Normalize CEDICT pinyin for comparison (strip tone marks and spaces)
  const cedictNorm = cedictPinyinRaw.toLowerCase().replace(/\s+/g, '').replace(/[0-5]/g, '');

  // Build a set of CEDICT definitions (lowercased) for dedup
  const cedictDefsSet = new Set(cedictDefinitions.map(d => d.toLowerCase().trim()));

  const byPinyin = new Map<string, { definitions: string[]; tang?: string; isSameReading: boolean }>();

  for (const item of items) {
    if (!item.pinyin) continue;

    // Check if this reading matches the CEDICT pinyin
    const itemNorm = item.pinyin.toLowerCase().replace(/\s+/g, '').replace(/[̄́̌̀āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, (c) => {
      const map: Record<string, string> = {
        'ā':'a','á':'a','ǎ':'a','à':'a',
        'ē':'e','é':'e','ě':'e','è':'e',
        'ī':'i','í':'i','ǐ':'i','ì':'i',
        'ō':'o','ó':'o','ǒ':'o','ò':'o',
        'ū':'u','ú':'u','ǔ':'u','ù':'u',
        'ǖ':'v','ǘ':'v','ǚ':'v','ǜ':'v',
      };
      return map[c] || c;
    });
    const isSameReading = itemNorm === cedictNorm;

    const key = item.pinyin;
    const existing = byPinyin.get(key);
    if (existing) {
      if (item.definitions) {
        for (const d of item.definitions) {
          if (!existing.definitions.includes(d)) existing.definitions.push(d);
        }
      }
      if (item.tang && !existing.tang) {
        existing.tang = item.tang.join(', ');
      }
    } else {
      byPinyin.set(key, {
        definitions: item.definitions ? [...item.definitions] : [],
        tang: item.tang ? item.tang.join(', ') : undefined,
        isSameReading,
      });
    }
  }

  const results: { pinyin: string; definitions: string[]; tang?: string }[] = [];
  for (const [pinyin, data] of byPinyin) {
    if (data.isSameReading) {
      // Same reading as CEDICT: only show Tang data, skip duplicate definitions
      if (data.tang) {
        results.push({ pinyin, definitions: [], tang: data.tang });
      }
    } else {
      // Different reading: filter out definitions already in CEDICT, show the rest
      const uniqueDefs = data.definitions.filter(d => !cedictDefsSet.has(d.toLowerCase().trim()));
      if (uniqueDefs.length > 0 || data.tang) {
        results.push({ pinyin, definitions: uniqueDefs, tang: data.tang });
      }
    }
  }

  return results;
}

// ---- Character Tab ----

function renderCharacterTab(): string {
  const entry = currentCharResult?.entry;
  const char = currentCharResult?.char || currentHoveredChar;

  if (!char) return '<div class="tz-entry"><div class="tz-empty">No character data</div></div>';

  let html = '<div class="tz-char-view">';

  // Header: large char + meta on right
  html += `<div class="tz-char-header">`;
  html += `<span class="tz-char-big">${escapeHtml(char)}</span>`;

  if (entry) {
    html += `<div class="tz-char-info">`;

    // Stroke count
    if (entry.strokeCount) {
      html += `<div class="tz-char-strokes">${entry.strokeCount} strokes</div>`;
    }

    // HSK + rank
    const badges: string[] = [];
    if (entry.statistics?.hskLevel && entry.statistics.hskLevel <= 9) {
      badges.push(`<span class="tz-hsk tz-hsk-${entry.statistics.hskLevel}">HSK${entry.statistics.hskLevel}</span>`);
    }
    if (entry.statistics?.bookCharRank) {
      badges.push(`<span class="tz-freq">#${entry.statistics.bookCharRank}</span>`);
    }
    if (entry.statistics?.movieCharRank) {
      badges.push(`<span class="tz-freq">M#${entry.statistics.movieCharRank}</span>`);
    }
    if (badges.length) html += `<div class="tz-char-badges">${badges.join(' ')}</div>`;

    // Codepoint
    if (entry.codepoint) {
      html += `<div class="tz-char-code">${escapeHtml(entry.codepoint)}</div>`;
    }

    html += `</div>`; // tz-char-info
  }
  html += `</div>`; // tz-char-header

  if (entry) {
    // Gloss
    if (entry.gloss && showDefinitions) {
      html += `<div class="tz-char-gloss">${escapeHtml(entry.gloss)}</div>`;
    }

    // Original meaning + variant info
    if (showDefinitions) {
      const variantParts: string[] = [];
      if (entry.originalMeaning) variantParts.push(`Original meaning: ${escapeHtml(entry.originalMeaning)}`);
      if (entry.variantOf) variantParts.push(`Variant of ${escapeHtml(entry.variantOf)}`);
      if (entry.tradVariants?.length) variantParts.push(`Trad: ${entry.tradVariants.map(v => escapeHtml(v)).join(', ')}`);
      if (entry.simpVariants?.length) variantParts.push(`Simp: ${entry.simpVariants.map(v => escapeHtml(v)).join(', ')}`);
      if (variantParts.length) {
        html += `<div class="tz-char-variant">${variantParts.join(' · ')}</div>`;
      }
    }

    // Pinyin frequencies
    if (entry.pinyinFrequencies && entry.pinyinFrequencies.length > 0 && showDefinitions) {
      const pfs = entry.pinyinFrequencies.map(pf =>
        `${escapeHtml(pf.pinyin)} <span class="tz-freq-count">(${pf.count})</span>`
      ).join(', ');
      html += `<div class="tz-char-pf">Readings: ${pfs}</div>`;
    }

    // Components
    if (entry.components && entry.components.length > 0 && showDefinitions) {
      const comps = entry.components.map(c => {
        const types = c.type.join('/');
        const hint = c.hint ? ` — ${escapeHtml(c.hint)}` : '';
        return `<span class="tz-comp">${escapeHtml(c.character)} <span class="tz-comp-type">${types}</span>${hint}</span>`;
      }).join(' + ');
      html += `<div class="tz-char-comps">${comps}</div>`;
    }

    // Etymology hint
    if (entry.hint && showDefinitions) {
      html += `<div class="tz-char-hint">${escapeHtml(entry.hint)}</div>`;
    }

    // Old pronunciations
    if (entry.oldPronunciations && entry.oldPronunciations.length > 0 && showDefinitions) {
      const rows = entry.oldPronunciations.map(p => {
        const cells: string[] = [escapeHtml(p.pinyin)];
        if (p.MC) cells.push(`MC ${escapeHtml(p.MC)}`);
        if (p.OC) cells.push(`OC ${escapeHtml(p.OC)}`);
        if (p.gloss) cells.push(`"${escapeHtml(p.gloss)}"`);
        return cells.join(' · ');
      });
      html += `<div class="tz-char-hist">${rows.join('<br>')}</div>`;
    }

    // Top words
    if (entry.statistics?.topWords && entry.statistics.topWords.length > 0 && showDefinitions) {
      const words = entry.statistics.topWords.slice(0, 8);
      const chips = words.map(w => {
        const pct = Math.round(w.share * 100);
        return `<span class="tz-chip">${escapeHtml(w.word)} <span class="tz-chip-g">${w.gloss ? escapeHtml(w.gloss) : ''}</span>${pct > 1 ? ` <span class="tz-chip-pct">${pct}%</span>` : ''}</span>`;
      }).join('');
      html += `<div class="tz-char-words">${chips}</div>`;
    }
  } else {
    html += '<div class="tz-empty">Loading character data...</div>';
  }

  html += '</div>';
  return html;
}

// ---- Rendering helpers ----

function renderPinyin(pinyinRaw: string): string {
  const syllables = splitPinyin(pinyinRaw);
  return syllables
    .map((syl) => {
      const tone = getToneNumber(syl);
      const color = currentSettings.showToneColors
        ? currentSettings.toneColors[tone - 1]
        : 'inherit';
      const display = numberToToneMark(syl);
      return `<span class="tz-py" style="color:${color}">${escapeHtml(display)}</span>`;
    })
    .join(' ');
}

function renderZhuyin(pinyinRaw: string): string {
  return splitPinyin(pinyinRaw)
    .map((syl) => pinyinToZhuyin(syl))
    .join(' ');
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
  const PAD = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;

  let left = x + OFFSET;
  if (left + pw + PAD > vw) left = x - pw - OFFSET;
  left = Math.max(PAD, Math.min(left, vw - pw - PAD));

  let top = y + OFFSET;
  if (top + ph + PAD > vh) top = y - ph - OFFSET;
  top = Math.max(PAD, Math.min(top, vh - ph - PAD));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

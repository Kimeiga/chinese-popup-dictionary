/**
 * Shadow DOM popup styles.
 * Compact, information-dense layout optimized for dictionary popups.
 * Dark mode inspired by 10ten Japanese Reader.
 */

export function getPopupStyles(theme: 'light' | 'dark' | 'auto'): string {
  const lightVars = `
    --tz-bg: #ffffff;
    --tz-bg2: #f5f6f8;
    --tz-text: #1a1a2e;
    --tz-text2: #666;
    --tz-border: #d8d8d8;
    --tz-shadow: rgba(0, 0, 0, 0.15);
    --tz-divider: #eaeaea;
    --tz-sel: rgba(66, 133, 244, 0.08);
    --tz-sel-border: rgba(66, 133, 244, 0.35);
    --tz-hanzi-color: #1a1a2e;
    --tz-accent: #2563eb;
  `;

  const darkVars = `
    --tz-bg: #1d1a19;
    --tz-bg2: #2a2725;
    --tz-text: #f0ecea;
    --tz-text2: #a09c9a;
    --tz-border: #504c4b;
    --tz-shadow: rgba(0, 0, 0, 0.5);
    --tz-divider: #3e3a39;
    --tz-sel: rgba(75, 191, 251, 0.1);
    --tz-sel-border: rgba(75, 191, 251, 0.4);
    --tz-hanzi-color: #ffffff;
    --tz-accent: #4bbffb;
  `;

  const themeVars =
    theme === 'dark' ? darkVars
      : theme === 'light' ? lightVars
        : lightVars;

  return `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "Microsoft YaHei", sans-serif;
      ${themeVars}
    }
    ${theme === 'auto' ? `@media (prefers-color-scheme: dark) { :host { ${darkVars} } }` : ''}

    .tz-popup {
      position: fixed;
      pointer-events: auto;
      background: var(--tz-bg);
      border: 1px solid var(--tz-border);
      border-radius: 8px;
      box-shadow: 0 4px 24px var(--tz-shadow);
      max-width: 440px;
      min-width: 220px;
      padding: 0;
      overflow: hidden;
      animation: tz-in 0.1s ease-out;
      color: var(--tz-text);
      display: flex;
      flex-direction: column;
    }
    .tz-body {
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .tz-scroll-fade {
      position: relative;
    }
    .tz-scroll-fade.has-more::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 24px;
      background: linear-gradient(transparent, var(--tz-bg));
      pointer-events: none;
    }
    @keyframes tz-in {
      from { opacity: 0; transform: translateY(2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Tab bar */
    .tz-tab-bar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 3px 8px;
      background: var(--tz-bg2);
      border-bottom: 1px solid var(--tz-divider);
    }
    .tz-tab {
      all: unset;
      padding: 2px 8px;
      font-size: 11px;
      color: var(--tz-text2);
      border-radius: 3px;
      cursor: pointer;
      user-select: none;
    }
    .tz-tab:hover { background: var(--tz-border); }
    .tz-tab-active {
      color: var(--tz-text);
      background: var(--tz-bg);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }
    .tz-tab-hint {
      margin-left: auto;
      font-size: 9px;
      color: var(--tz-text2);
      opacity: 0.5;
      padding: 1px 4px;
      border: 1px solid var(--tz-divider);
      border-radius: 2px;
    }

    /* Entries */
    .tz-entry {
      padding: 7px 12px;
      border-bottom: 1px solid var(--tz-divider);
    }
    .tz-entry:last-of-type { border-bottom: none; }
    .tz-selected {
      background: var(--tz-sel);
      border-left: 2px solid var(--tz-sel-border);
      padding-left: 10px;
    }

    /* Word entry header row: hanzi + pinyin + badges inline */
    .tz-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 2px;
    }
    .tz-hanzi {
      font-size: 22px;
      font-weight: 600;
      color: var(--tz-hanzi-color);
      line-height: 1.2;
    }
    .tz-hanzi-alt {
      font-size: 16px;
      color: var(--tz-text2);
    }
    .tz-pinyin, .tz-py {
      font-size: 14px;
      letter-spacing: 0.2px;
    }
    .tz-py { margin-right: 1px; }
    .tz-zhuyin {
      font-size: 12px;
      color: var(--tz-text2);
      margin-bottom: 2px;
    }

    /* Definitions */
    .tz-defs {
      font-size: 13px;
      color: var(--tz-text);
      line-height: 1.45;
    }
    .tz-def { margin: 0; }
    .tz-def-num {
      color: var(--tz-text2);
      font-size: 11px;
      margin-right: 3px;
    }
    .tz-gloss {
      font-size: 12px;
      color: var(--tz-text2);
      font-style: italic;
      margin-bottom: 1px;
    }
    .tz-variant {
      font-size: 11px;
      color: var(--tz-text2);
      font-style: italic;
      opacity: 0.8;
      margin-bottom: 2px;
    }

    /* HSK badges */
    .tz-hsk {
      font-size: 9px;
      font-weight: 700;
      padding: 0 4px;
      border-radius: 2px;
      color: #fff;
      white-space: nowrap;
      line-height: 1.6;
      vertical-align: middle;
    }
    .tz-hsk-1 { background: #43a047; }
    .tz-hsk-2 { background: #7cb342; color: #fff; }
    .tz-hsk-3 { background: #f9a825; color: #1a1a1a; }
    .tz-hsk-4 { background: #ef6c00; }
    .tz-hsk-5 { background: #e53935; }
    .tz-hsk-6 { background: #c62828; }
    .tz-hsk-7, .tz-hsk-8, .tz-hsk-9 { background: #7b1fa2; }

    .tz-freq {
      font-size: 10px;
      color: var(--tz-text2);
      opacity: 0.6;
    }

    /* Top words chips */
    .tz-top-words, .tz-char-words {
      margin-top: 3px;
      line-height: 1.7;
    }
    .tz-chip {
      display: inline-block;
      font-size: 13px;
      background: var(--tz-bg2);
      border: 1px solid var(--tz-divider);
      padding: 0 5px;
      border-radius: 3px;
      margin: 1px 2px 1px 0;
      color: var(--tz-text);
    }
    .tz-chip-g {
      color: var(--tz-text2);
      font-size: 12px;
    }
    .tz-chip-pct {
      color: var(--tz-text2);
      font-size: 9px;
      opacity: 0.6;
    }

    /* Character view */
    .tz-char-view {
      padding: 8px 12px;
    }
    .tz-char-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 6px;
    }
    .tz-char-big {
      font-size: 44px;
      font-weight: 600;
      color: var(--tz-hanzi-color);
      line-height: 1.1;
    }
    .tz-char-info {
      flex: 1;
      padding-top: 4px;
    }
    .tz-char-strokes {
      font-size: 13px;
      color: var(--tz-text2);
      margin-bottom: 2px;
    }
    .tz-char-badges {
      display: flex;
      gap: 4px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 2px;
    }
    .tz-char-code {
      font-size: 10px;
      color: var(--tz-text2);
      opacity: 0.5;
      font-family: monospace;
    }
    .tz-char-gloss {
      font-size: 14px;
      color: var(--tz-text);
      margin-bottom: 4px;
      line-height: 1.4;
    }
    .tz-char-variant {
      font-size: 11px;
      color: var(--tz-text2);
      margin-bottom: 3px;
    }
    .tz-char-pf {
      font-size: 12px;
      color: var(--tz-text2);
      margin-bottom: 3px;
    }
    .tz-freq-count {
      font-size: 10px;
      opacity: 0.6;
    }
    .tz-char-comps {
      font-size: 12px;
      color: var(--tz-text2);
      margin-bottom: 3px;
      line-height: 1.4;
    }
    .tz-comp {
      white-space: nowrap;
    }
    .tz-comp-type {
      font-size: 10px;
      opacity: 0.7;
    }
    .tz-char-hint {
      font-size: 12px;
      color: var(--tz-text2);
      font-style: italic;
      margin-bottom: 4px;
      line-height: 1.4;
    }
    .tz-char-hist {
      font-size: 11px;
      color: var(--tz-text2);
      margin-bottom: 3px;
      line-height: 1.5;
    }
    .tz-empty {
      text-align: center;
      color: var(--tz-text2);
      font-size: 12px;
      padding: 6px;
    }

    /* Footer / keyboard hints */
    .tz-footer {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
      padding: 3px 8px;
      background: var(--tz-bg2);
      border-top: 1px solid var(--tz-divider);
      font-size: 10px;
      color: var(--tz-text2);
      opacity: 0.8;
    }
    .tz-copy-flash {
      justify-content: center;
      font-weight: 600;
      color: #4CAF50;
      opacity: 1;
    }
    .tz-key {
      display: inline-block;
      padding: 0 3px;
      background: var(--tz-bg);
      border: 1px solid var(--tz-border);
      border-radius: 2px;
      font-size: 9px;
      font-family: monospace;
      font-weight: 600;
      color: var(--tz-text);
      line-height: 1.5;
    }

    /* Font size variants */
    :host(.font-small) .tz-hanzi { font-size: 18px; }
    :host(.font-small) .tz-py { font-size: 12px; }
    :host(.font-small) .tz-defs { font-size: 11px; }
    :host(.font-small) .tz-char-big { font-size: 36px; }

    :host(.font-large) .tz-hanzi { font-size: 26px; }
    :host(.font-large) .tz-py { font-size: 16px; }
    :host(.font-large) .tz-defs { font-size: 15px; }
    :host(.font-large) .tz-char-big { font-size: 52px; }

    .tz-hidden { display: none !important; }
  `;
}

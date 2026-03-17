/**
 * Shadow DOM popup styles.
 * Injected into the shadow root to prevent host-page CSS from affecting us.
 */

export function getPopupStyles(theme: 'light' | 'dark' | 'auto'): string {
  const lightVars = `
    --tz-bg: #ffffff;
    --tz-bg-secondary: #f8f9fa;
    --tz-text: #1a1a2e;
    --tz-text-secondary: #555;
    --tz-border: #e0e0e0;
    --tz-shadow: rgba(0, 0, 0, 0.15);
    --tz-divider: #eee;
  `;

  const darkVars = `
    --tz-bg: #1e1e2e;
    --tz-bg-secondary: #2a2a3e;
    --tz-text: #e0e0e0;
    --tz-text-secondary: #aaa;
    --tz-border: #444;
    --tz-shadow: rgba(0, 0, 0, 0.4);
    --tz-divider: #333;
  `;

  const themeVars =
    theme === 'dark'
      ? darkVars
      : theme === 'light'
        ? lightVars
        : `
    ${lightVars}
    @media (prefers-color-scheme: dark) {
      :host { ${darkVars} }
    }
  `;

  return `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "Microsoft YaHei", sans-serif;
      ${theme !== 'auto' ? themeVars : lightVars}
    }

    ${theme === 'auto' ? `@media (prefers-color-scheme: dark) { :host { ${darkVars} } }` : ''}

    .tz-popup {
      position: fixed;
      pointer-events: auto;
      background: var(--tz-bg);
      border: 1px solid var(--tz-border);
      border-radius: 8px;
      box-shadow: 0 4px 20px var(--tz-shadow);
      max-width: 420px;
      min-width: 200px;
      padding: 0;
      overflow: hidden;
      animation: tz-fadeIn 0.12s ease-out;
    }

    @keyframes tz-fadeIn {
      from { opacity: 0; transform: translateY(2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .tz-entry {
      padding: 10px 14px;
      border-bottom: 1px solid var(--tz-divider);
    }

    .tz-entry:last-child {
      border-bottom: none;
    }

    .tz-hanzi-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 4px;
    }

    .tz-hanzi {
      font-size: 24px;
      font-weight: 600;
      color: var(--tz-text);
      line-height: 1.3;
    }

    .tz-hanzi-alt {
      font-size: 18px;
      color: var(--tz-text-secondary);
      line-height: 1.3;
    }

    .tz-pinyin {
      font-size: 15px;
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }

    .tz-pinyin-syllable {
      margin-right: 2px;
    }

    .tz-zhuyin {
      font-size: 13px;
      color: var(--tz-text-secondary);
      margin-bottom: 4px;
    }

    .tz-definitions {
      font-size: 14px;
      color: var(--tz-text);
      line-height: 1.5;
    }

    .tz-def-item {
      margin: 0;
      padding: 0;
    }

    .tz-def-item::before {
      content: none;
    }

    .tz-def-num {
      color: var(--tz-text-secondary);
      font-size: 12px;
      margin-right: 4px;
    }

    /* Font size variants */
    :host(.font-small) .tz-hanzi { font-size: 20px; }
    :host(.font-small) .tz-pinyin { font-size: 13px; }
    :host(.font-small) .tz-definitions { font-size: 12px; }

    :host(.font-large) .tz-hanzi { font-size: 28px; }
    :host(.font-large) .tz-pinyin { font-size: 17px; }
    :host(.font-large) .tz-definitions { font-size: 16px; }

    .tz-hidden {
      display: none !important;
    }

    /* Highlight the matched text range */
    .tz-highlight {
      background: rgba(255, 220, 100, 0.35);
      border-radius: 2px;
    }
  `;
}

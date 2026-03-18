/**
 * Options page script.
 * Loads settings from chrome.storage.sync, renders them into the form,
 * and saves changes immediately on interaction.
 */

import type { ExtensionSettings } from '../common/types';
import { DEFAULT_SETTINGS } from '../common/types';

const STORAGE_KEY = 'zitan_settings';

const $$ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] || {}) });
    });
  });
}

async function saveSettings(
  partial: Partial<ExtensionSettings>
): Promise<void> {
  const current = await loadSettings();
  const updated = { ...current, ...partial };
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: updated }, () => {
      showSaved();
      // If theme changed, apply to settings page too
      if (partial.theme !== undefined) {
        applyPageTheme(partial.theme);
      }
      resolve();
    });
  });
}

function showSaved(): void {
  const el = $$('saved');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

function applyPageTheme(theme: ExtensionSettings['theme']): void {
  if (theme === 'light') {
    document.body.classList.add('light');
  } else if (theme === 'dark') {
    document.body.classList.remove('light');
  } else {
    // Auto: check system preference
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.body.classList.add('light');
    } else {
      document.body.classList.remove('light');
    }
  }
}

async function init(): Promise<void> {
  const s = await loadSettings();

  // Apply theme to settings page
  applyPageTheme(s.theme);

  // Listen for system theme changes when in auto mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const current = await loadSettings();
    if (current.theme === 'auto') applyPageTheme('auto');
  });

  // Populate form
  ($$<HTMLSelectElement>('charDisplay')).value = s.charDisplay;
  ($$<HTMLSelectElement>('theme')).value = s.theme;
  ($$<HTMLSelectElement>('fontSize')).value = s.fontSize;
  ($$<HTMLSelectElement>('maxEntries')).value = String(s.maxEntries);
  ($$<HTMLInputElement>('showToneColors')).checked = s.showToneColors;
  ($$<HTMLInputElement>('showZhuyin')).checked = s.showZhuyin;

  // Tone colors
  for (let i = 0; i < 5; i++) {
    ($$<HTMLInputElement>(`tone${i + 1}`)).value = s.toneColors[i];
  }

  // Block list
  ($$<HTMLTextAreaElement>('blocklist')).value = s.blocklist.join('\n');

  // Event listeners
  $$('charDisplay').addEventListener('change', (e) =>
    saveSettings({
      charDisplay: (e.target as HTMLSelectElement).value as ExtensionSettings['charDisplay'],
    })
  );

  $$('theme').addEventListener('change', (e) =>
    saveSettings({
      theme: (e.target as HTMLSelectElement).value as ExtensionSettings['theme'],
    })
  );

  $$('fontSize').addEventListener('change', (e) =>
    saveSettings({
      fontSize: (e.target as HTMLSelectElement).value as ExtensionSettings['fontSize'],
    })
  );

  $$('maxEntries').addEventListener('change', (e) =>
    saveSettings({ maxEntries: parseInt((e.target as HTMLSelectElement).value, 10) })
  );

  $$('showToneColors').addEventListener('change', (e) =>
    saveSettings({ showToneColors: (e.target as HTMLInputElement).checked })
  );

  $$('showZhuyin').addEventListener('change', (e) =>
    saveSettings({ showZhuyin: (e.target as HTMLInputElement).checked })
  );

  for (let i = 0; i < 5; i++) {
    $$(`tone${i + 1}`).addEventListener('input', async () => {
      const colors: [string, string, string, string, string] = [
        ($$<HTMLInputElement>('tone1')).value,
        ($$<HTMLInputElement>('tone2')).value,
        ($$<HTMLInputElement>('tone3')).value,
        ($$<HTMLInputElement>('tone4')).value,
        ($$<HTMLInputElement>('tone5')).value,
      ];
      saveSettings({ toneColors: colors });
    });
  }

  $$('blocklist').addEventListener('change', (e) => {
    const val = (e.target as HTMLTextAreaElement).value;
    const list = val
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    saveSettings({ blocklist: list });
  });
}

init();

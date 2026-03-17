/** A single CC-CEDICT dictionary entry */
export interface DictEntry {
  /** Traditional Chinese characters */
  traditional: string;
  /** Simplified Chinese characters */
  simplified: string;
  /** Raw pinyin with tone numbers (e.g. "zhong1 guo2") */
  pinyinRaw: string;
  /** Pinyin with tone marks (e.g. "zhōng guó") */
  pinyin: string;
  /** Array of English definitions */
  definitions: string[];
  /** Source dictionary identifier for extensibility */
  source: string;
}

/** Result of a dictionary lookup at a text position */
export interface LookupResult {
  /** The matched entries, longest match first */
  entries: DictEntry[];
  /** Number of characters matched in the source text */
  matchLen: number;
  /** The original matched text */
  matchText: string;
}

/** Messages sent from content script to service worker */
export type ContentToBackground =
  | { type: 'lookup'; text: string; maxResults?: number }
  | { type: 'getState' }
  | { type: 'toggleEnabled' };

/** Messages sent from service worker to content script */
export type BackgroundToContent =
  | { type: 'stateChanged'; enabled: boolean }
  | { type: 'settingsChanged'; settings: ExtensionSettings };

/** User-configurable settings */
export interface ExtensionSettings {
  /** Which characters to show: 'simplified', 'traditional', or 'both' */
  charDisplay: 'simplified' | 'traditional' | 'both';
  /** Whether to show tone colors on pinyin */
  showToneColors: boolean;
  /** Custom tone colors [tone1, tone2, tone3, tone4, tone5] */
  toneColors: [string, string, string, string, string];
  /** Popup theme */
  theme: 'light' | 'dark' | 'auto';
  /** Font size for popup */
  fontSize: 'small' | 'normal' | 'large';
  /** Domains to disable the extension on */
  blacklist: string[];
  /** Whether the extension is enabled */
  enabled: boolean;
  /** Whether to show zhuyin (bopomofo) */
  showZhuyin: boolean;
  /** Maximum entries to show in popup */
  maxEntries: number;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  charDisplay: 'both',
  showToneColors: true,
  toneColors: ['#E74C3C', '#F39C12', '#27AE60', '#3498DB', '#95A5A6'],
  theme: 'light',
  fontSize: 'normal',
  blacklist: [],
  enabled: true,
  showZhuyin: false,
  maxEntries: 7,
};

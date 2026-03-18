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

// ---- Dong Chinese types ----

/** A single item (pronunciation + definitions) within a Dong Chinese word entry */
export interface DongWordItem {
  source?: string;
  pinyin?: string;
  simpTrad?: string;
  definitions?: string[];
  tang?: string[];
}

/** Dong Chinese word entry (compact keys from build script) */
export interface DongWordEntry {
  /** simp is the key in the index, added at load time */
  simp: string;
  trad: string;
  items: DongWordItem[];
  gloss?: string;
  statistics?: DongStatistics;
}

/** Raw compact word entry from dong-words.json */
export interface DongWordEntryRaw {
  t: string;      // trad
  i: unknown[];   // items
  g?: string;     // gloss
  s?: DongStatisticsRaw; // statistics
}

/** Dong Chinese character component */
export interface DongComponent {
  character: string;
  type: string[];
  hint?: string | null;
}

/** Dong Chinese character entry (expanded from compact format) */
export interface DongCharEntry {
  char: string;
  codepoint?: string;
  strokeCount?: number;
  components?: DongComponent[];
  gloss?: string;
  hint?: string;
  oldPronunciations?: DongOldPronunciation[];
  pinyinFrequencies?: DongPinyinFrequency[];
  statistics?: DongCharStatistics;
  originalMeaning?: string;
  variantOf?: string;
  tradVariants?: string[];
  simpVariants?: string[];
}

/** Raw compact char entry from dong-chars.json */
export interface DongCharEntryRaw {
  cp?: string;    // codepoint
  sc?: number;    // strokeCount
  co?: DongComponent[]; // components
  g?: string;     // gloss
  h?: string;     // hint
  op?: DongOldPronunciation[]; // oldPronunciations
  pf?: DongPinyinFrequency[];  // pinyinFrequencies
  s?: DongCharStatisticsRaw;   // statistics
  om?: string;    // originalMeaning
  vo?: string;    // variantOf
  tv?: string[];  // tradVariants
  sv?: string[];  // simpVariants
}

export interface DongOldPronunciation {
  pinyin: string;
  MC?: string;
  OC?: string;
  gloss?: string;
  source?: string;
}

export interface DongPinyinFrequency {
  pinyin: string;
  count: number;
}

export interface DongStatistics {
  hskLevel?: number;
  bookWordRank?: number;
  movieWordRank?: number;
  topWords?: DongTopWord[];
}

export interface DongCharStatistics extends DongStatistics {
  bookCharRank?: number;
  movieCharRank?: number;
}

export interface DongTopWord {
  word: string;
  trad: string;
  share: number;
  gloss?: string;
}

/** Raw compact statistics from JSON (short keys) */
export interface DongStatisticsRaw {
  hskLevel?: number;
  bookWordRank?: number;
  movieWordRank?: number;
  bookCharRank?: number;
  movieCharRank?: number;
  topWords?: DongTopWordRaw[];
}

export type DongCharStatisticsRaw = DongStatisticsRaw;

export interface DongTopWordRaw {
  w: string;  // word
  t: string;  // trad
  s: number;  // share
  g?: string; // gloss
}

/** Word lookup result: CC-CEDICT entries + matching Dong Chinese word entries */
export interface WordLookupResult extends LookupResult {
  dongEntries: DongWordEntry[];
}

/** Character lookup result */
export interface CharLookupResult {
  char: string;
  entry: DongCharEntry | null;
}

/** Which popup tab is active */
export type PopupTab = 'word' | 'character';

/** Copy feedback state */
export type CopyState =
  | { mode: 'inactive'; selectedIndex: number }
  | { mode: 'copied'; what: string; selectedIndex: number };

/** Messages sent from content script to service worker */
export type ContentToBackground =
  | { type: 'lookup'; text: string; maxResults?: number }
  | { type: 'lookupChar'; char: string }
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
  blocklist: string[];
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
  theme: 'dark',
  fontSize: 'normal',
  blocklist: [],
  enabled: true,
  showZhuyin: false,
  maxEntries: 7,
};

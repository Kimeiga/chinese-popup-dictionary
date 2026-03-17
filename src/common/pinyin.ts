/**
 * Pinyin utilities: converting numbered pinyin to tone-marked pinyin,
 * tone color coding, and zhuyin (bopomofo) conversion.
 */

const TONE_MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à', 'a'],
  e: ['ē', 'é', 'ě', 'è', 'e'],
  i: ['ī', 'í', 'ǐ', 'ì', 'i'],
  o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
  u: ['ū', 'ú', 'ǔ', 'ù', 'u'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
};

/**
 * Convert a single numbered pinyin syllable to tone-marked.
 * E.g. "zhong1" → "zhōng", "lv4" → "lǜ", "r5" → "r"
 */
export function numberToToneMark(syllable: string): string {
  const match = syllable.match(
    /^([bcdfghjklmnpqrstwxyz]*)([aeiouüv:]+)([ngrng]*)([1-5])$/i
  );
  if (!match) return syllable;

  const [, initial, vowels, final, toneStr] = match;
  const tone = parseInt(toneStr, 10) - 1; // 0-indexed

  // Replace v/u: with ü
  let normalizedVowels = vowels.replace(/v/gi, 'ü').replace(/u:/gi, 'ü');

  // Tone placement rules:
  // 1. If there's an 'a' or 'e', it takes the tone mark
  // 2. If there's 'ou', the 'o' takes the mark
  // 3. Otherwise, the second vowel takes the mark
  let toneIndex = -1;
  const lowerVowels = normalizedVowels.toLowerCase();

  for (let i = 0; i < lowerVowels.length; i++) {
    if (lowerVowels[i] === 'a' || lowerVowels[i] === 'e') {
      toneIndex = i;
      break;
    }
  }
  if (toneIndex === -1 && lowerVowels.includes('ou')) {
    toneIndex = lowerVowels.indexOf('o');
  }
  if (toneIndex === -1) {
    // Second vowel gets the tone, or first if only one
    toneIndex = lowerVowels.length > 1 ? 1 : 0;
  }

  // Apply tone mark
  const chars = [...normalizedVowels];
  const baseChar = chars[toneIndex].toLowerCase();
  if (TONE_MARKS[baseChar]) {
    chars[toneIndex] = TONE_MARKS[baseChar][tone];
  }

  return initial + chars.join('') + final;
}

/**
 * Convert a full pinyin string (space-separated syllables) to tone-marked.
 * E.g. "zhong1 guo2" → "zhōng guó"
 */
export function pinyinToToneMarks(pinyin: string): string {
  return pinyin
    .split(/\s+/)
    .map((s) => numberToToneMark(s))
    .join(' ');
}

/**
 * Extract the tone number (1-5) from a numbered pinyin syllable.
 */
export function getToneNumber(syllable: string): number {
  const match = syllable.match(/[1-5]$/);
  return match ? parseInt(match[0], 10) : 5;
}

/**
 * Split a full pinyin string into individual syllables preserving tone numbers.
 */
export function splitPinyin(pinyin: string): string[] {
  return pinyin.trim().split(/\s+/);
}

// Zhuyin (Bopomofo) conversion table
const ZHUYIN_MAP: Record<string, string> = {
  b: 'ㄅ', p: 'ㄆ', m: 'ㄇ', f: 'ㄈ',
  d: 'ㄉ', t: 'ㄊ', n: 'ㄋ', l: 'ㄌ',
  g: 'ㄍ', k: 'ㄎ', h: 'ㄏ',
  j: 'ㄐ', q: 'ㄑ', x: 'ㄒ',
  zh: 'ㄓ', ch: 'ㄔ', sh: 'ㄕ', r: 'ㄖ',
  z: 'ㄗ', c: 'ㄘ', s: 'ㄙ',
  a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', ai: 'ㄞ',
  ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ',
  an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ',
  er: 'ㄦ', i: 'ㄧ', u: 'ㄨ', ü: 'ㄩ',
  // Combined finals
  ia: 'ㄧㄚ', ie: 'ㄧㄝ', iao: 'ㄧㄠ', iu: 'ㄧㄡ',
  ian: 'ㄧㄢ', in: 'ㄧㄣ', iang: 'ㄧㄤ', ing: 'ㄧㄥ',
  ua: 'ㄨㄚ', uo: 'ㄨㄛ', uai: 'ㄨㄞ', ui: 'ㄨㄟ',
  uan: 'ㄨㄢ', un: 'ㄨㄣ', uang: 'ㄨㄤ', ong: 'ㄨㄥ',
  üe: 'ㄩㄝ', üan: 'ㄩㄢ', ün: 'ㄩㄣ', iong: 'ㄩㄥ',
};

const ZHUYIN_TONES: Record<number, string> = {
  1: '', // First tone: no mark in zhuyin
  2: 'ˊ',
  3: 'ˇ',
  4: 'ˋ',
  5: '˙',
};

/**
 * Convert a numbered pinyin syllable to zhuyin (bopomofo).
 */
export function pinyinToZhuyin(syllable: string): string {
  const match = syllable
    .toLowerCase()
    .match(/^([bcdfghjklmnpqrstwxyz]*)([aeiouü:]+[ng]*)([1-5]?)$/);
  if (!match) return syllable;

  const [, initial, final, toneStr] = match;
  const tone = toneStr ? parseInt(toneStr, 10) : 5;

  const normalizedFinal = final.replace(/v/g, 'ü').replace(/u:/g, 'ü');

  const zhuyinInitial = ZHUYIN_MAP[initial] || '';
  const zhuyinFinal = ZHUYIN_MAP[normalizedFinal] || normalizedFinal;
  const zhuyinTone = ZHUYIN_TONES[tone] || '';

  return zhuyinInitial + zhuyinFinal + zhuyinTone;
}

#!/usr/bin/env npx tsx
/**
 * Dong Chinese data pipeline script.
 *
 * Processes dictionary_word and dictionary_char JSONL files from Dong Chinese,
 * strips large fields (SVG stroke data, images, medians, fragments, comments,
 * variants, customSources), and outputs compact JSON files for the extension.
 *
 * Usage: npx tsx src/scripts/build-dong-dict.ts
 */

import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { createInterface } from 'readline';

const DATA_DIR = 'data';
const WORD_JSONL = 'dictionary_word_2025-12-27.jsonl';
const CHAR_JSONL = 'dictionary_char_2025-12-27.jsonl';
const WORD_OUT = `${DATA_DIR}/dong-words.json`;
const CHAR_OUT = `${DATA_DIR}/dong-chars.json`;

// Fields to strip from character entries to reduce file size
const CHAR_STRIP_FIELDS = [
  'data',
  'images',
  'medians',
  'fragments',
  'comments',
  'variants',
  'customSources',
  'shuowen',
];

// Fields to strip from word entries
const WORD_STRIP_FIELDS = ['pinyinSearchString'];

interface RawDongWord {
  _id: string;
  simp: string;
  trad: string;
  items: unknown[];
  gloss?: string;
  statistics?: unknown;
  [key: string]: unknown;
}

interface RawDongChar {
  _id: string;
  char: string;
  codepoint?: string;
  strokeCount?: number | string;
  sources?: string[];
  // word entries mixed in have simp/trad instead of char
  simp?: string;
  trad?: string;
  [key: string]: unknown;
}

async function processWords(): Promise<void> {
  if (!existsSync(WORD_JSONL)) {
    console.error(`[build-dong] Missing ${WORD_JSONL}`);
    process.exit(1);
  }

  console.log(`[build-dong] Processing words from ${WORD_JSONL}...`);

  const wordIndex: Record<string, RawDongWord[]> = {};
  let count = 0;

  const rl = createInterface({
    input: createReadStream(WORD_JSONL, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as RawDongWord;
      if (!entry.simp || !entry.items) continue;

      // Strip unnecessary fields
      for (const field of WORD_STRIP_FIELDS) {
        delete entry[field];
      }

      // Index by simplified form
      const key = entry.simp;
      if (!wordIndex[key]) {
        wordIndex[key] = [];
      }
      wordIndex[key].push(entry);
      count++;
    } catch {
      // Skip malformed lines
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  const json = JSON.stringify({ entries: wordIndex, count });
  const ws = createWriteStream(WORD_OUT);
  ws.end(json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(
    `[build-dong] Wrote ${WORD_OUT} (${sizeMB} MB, ${count} word entries, ${Object.keys(wordIndex).length} keys)`
  );
}

function isValidCharEntry(entry: RawDongChar): boolean {
  // Must have 'char' field (not simp/trad which indicates a word entry mixed in)
  if (!entry.char) return false;
  // char field should be a single character (filter out multi-char entries like 杭州)
  if ([...entry.char].length !== 1) return false;
  // Must have codepoint and strokeCount for a complete entry (unless it has other useful data)
  // Allow entries that have at least char + some useful data
  return true;
}

async function processChars(): Promise<void> {
  if (!existsSync(CHAR_JSONL)) {
    console.error(`[build-dong] Missing ${CHAR_JSONL}`);
    process.exit(1);
  }

  console.log(`[build-dong] Processing characters from ${CHAR_JSONL}...`);

  const charMap: Record<string, RawDongChar> = {};
  let count = 0;
  let skipped = 0;

  const rl = createInterface({
    input: createReadStream(CHAR_JSONL, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as RawDongChar;

      // Filter bad entries: word entries mixed in (have simp/trad but no char)
      if (!entry.char && entry.simp) {
        skipped++;
        continue;
      }

      if (!isValidCharEntry(entry)) {
        skipped++;
        continue;
      }

      // Strip large fields
      for (const field of CHAR_STRIP_FIELDS) {
        delete entry[field];
      }

      // Normalize strokeCount to number
      if (typeof entry.strokeCount === 'string') {
        entry.strokeCount = parseInt(entry.strokeCount, 10) || undefined;
      }

      charMap[entry.char] = entry;
      count++;
    } catch {
      // Skip malformed lines
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  const json = JSON.stringify({ entries: charMap, count });
  const ws = createWriteStream(CHAR_OUT);
  ws.end(json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(
    `[build-dong] Wrote ${CHAR_OUT} (${sizeMB} MB, ${count} char entries, skipped ${skipped})`
  );
}

async function main(): Promise<void> {
  console.log('[build-dong] Starting Dong Chinese build pipeline...');
  await Promise.all([processWords(), processChars()]);
  console.log('[build-dong] Done!');
}

main().catch((err) => {
  console.error('[build-dong] Fatal error:', err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Dong Chinese data pipeline script.
 *
 * Processes dictionary_word and dictionary_char JSONL files from Dong Chinese,
 * strips unused fields and shortens keys to minimize file size.
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

// Statistics fields actually used in the popup UI
const USED_WORD_STATS = ['hskLevel', 'bookWordRank', 'movieWordRank', 'topWords'];
const USED_CHAR_STATS = ['hskLevel', 'bookCharRank', 'movieCharRank', 'topWords'];

// Max topWords to keep (UI caps at 5 for words, 8 for chars)
const MAX_TOP_WORDS_WORD = 5;
const MAX_TOP_WORDS_CHAR = 8;

interface RawEntry {
  [key: string]: unknown;
}

/**
 * Strip statistics down to only the fields the UI uses,
 * and cap topWords arrays.
 */
function trimStats(
  stats: Record<string, unknown> | undefined,
  usedFields: string[],
  maxTopWords: number
): Record<string, unknown> | undefined {
  if (!stats) return undefined;
  const result: Record<string, unknown> = {};
  for (const field of usedFields) {
    if (stats[field] !== undefined) {
      result[field] = stats[field];
    }
  }
  // Cap topWords
  if (Array.isArray(result.topWords)) {
    result.topWords = (result.topWords as unknown[]).slice(0, maxTopWords).map((tw: any) => ({
      w: tw.word || tw.w,
      t: tw.trad || tw.t,
      s: Math.round((tw.share ?? tw.s ?? 0) * 1000) / 1000,
      g: tw.gloss || tw.g || undefined,
    }));
  }
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

async function processWords(): Promise<void> {
  if (!existsSync(WORD_JSONL)) {
    console.error(`[build-dong] Missing ${WORD_JSONL}`);
    process.exit(1);
  }

  console.log(`[build-dong] Processing words from ${WORD_JSONL}...`);

  // Output format: { [simp]: [compact entries] }
  const wordIndex: Record<string, unknown[]> = {};
  let count = 0;

  const rl = createInterface({
    input: createReadStream(WORD_JSONL, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as RawEntry;
      if (!raw.simp || !raw.items) continue;

      const key = raw.simp as string;

      // Build compact entry — no _id, no redundant simp (it's the key)
      const compact: Record<string, unknown> = {
        t: raw.trad,      // trad
        i: raw.items,      // items
      };
      if (raw.gloss) compact.g = raw.gloss;

      const stats = trimStats(
        raw.statistics as Record<string, unknown> | undefined,
        USED_WORD_STATS,
        MAX_TOP_WORDS_WORD,
      );
      if (stats) compact.s = stats;

      if (!wordIndex[key]) wordIndex[key] = [];
      wordIndex[key].push(compact);
      count++;
    } catch {
      // Skip malformed lines
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  const json = JSON.stringify(wordIndex);
  const ws = createWriteStream(WORD_OUT);
  ws.end(json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(
    `[build-dong] Wrote ${WORD_OUT} (${sizeMB} MB, ${count} word entries, ${Object.keys(wordIndex).length} keys)`
  );
}

function isValidCharEntry(entry: RawEntry): boolean {
  if (!entry.char) return false;
  if ([...(entry.char as string)].length !== 1) return false;
  return true;
}

async function processChars(): Promise<void> {
  if (!existsSync(CHAR_JSONL)) {
    console.error(`[build-dong] Missing ${CHAR_JSONL}`);
    process.exit(1);
  }

  console.log(`[build-dong] Processing characters from ${CHAR_JSONL}...`);

  // Output format: { [char]: compact entry }
  const charMap: Record<string, unknown> = {};
  let count = 0;
  let skipped = 0;

  const rl = createInterface({
    input: createReadStream(CHAR_JSONL, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as RawEntry;

      // Filter bad entries: word entries mixed in (have simp/trad but no char)
      if (!raw.char && raw.simp) {
        skipped++;
        continue;
      }

      if (!isValidCharEntry(raw)) {
        skipped++;
        continue;
      }

      const ch = raw.char as string;

      // Build compact entry — no _id, no redundant char (it's the key),
      // no sources (unused in UI)
      const compact: Record<string, unknown> = {};
      if (raw.codepoint) compact.cp = raw.codepoint;

      // Normalize strokeCount to number
      const sc = typeof raw.strokeCount === 'string'
        ? parseInt(raw.strokeCount, 10) || undefined
        : raw.strokeCount;
      if (sc) compact.sc = sc;

      if (raw.components) compact.co = raw.components;
      if (raw.gloss) compact.g = raw.gloss;
      if (raw.hint) compact.h = raw.hint;
      if (raw.oldPronunciations) compact.op = raw.oldPronunciations;
      if (raw.pinyinFrequencies) compact.pf = raw.pinyinFrequencies;
      if (raw.originalMeaning) compact.om = raw.originalMeaning;
      if (raw.variantOf) compact.vo = raw.variantOf;
      if (raw.tradVariants) compact.tv = raw.tradVariants;
      if (raw.simpVariants) compact.sv = raw.simpVariants;

      const stats = trimStats(
        raw.statistics as Record<string, unknown> | undefined,
        USED_CHAR_STATS,
        MAX_TOP_WORDS_CHAR,
      );
      if (stats) compact.s = stats;

      charMap[ch] = compact;
      count++;
    } catch {
      // Skip malformed lines
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  const json = JSON.stringify(charMap);
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

#!/usr/bin/env npx tsx
/**
 * CC-CEDICT data pipeline script.
 *
 * Downloads the latest CC-CEDICT file from MDBG, parses it, and outputs
 * a compact JSON file optimized for bulk-loading into IndexedDB.
 *
 * Usage: npx tsx src/scripts/build-dict.ts
 */

import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { pinyinToToneMarks } from '../common/pinyin';

const CEDICT_URL =
  'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
const DATA_DIR = 'data';
const GZ_PATH = `${DATA_DIR}/cedict.txt.gz`;
const TXT_PATH = `${DATA_DIR}/cedict.txt`;
const JSON_PATH = `${DATA_DIR}/cedict.json`;

interface RawEntry {
  /** t = traditional */
  t: string;
  /** s = simplified */
  s: string;
  /** p = pinyin with tone marks */
  p: string;
  /** r = raw pinyin with tone numbers */
  r: string;
  /** d = definitions */
  d: string[];
}

async function downloadCEDICT(): Promise<void> {
  if (existsSync(TXT_PATH)) {
    console.log(`[build-dict] Using cached ${TXT_PATH}`);
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  console.log('[build-dict] Downloading CC-CEDICT from MDBG...');

  const response = await fetch(CEDICT_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  // Save the gzipped file
  const fileStream = createWriteStream(GZ_PATH);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);

  // Decompress
  console.log('[build-dict] Decompressing...');
  const gunzipStream = createGunzip();
  const outStream = createWriteStream(TXT_PATH);
  await pipeline(createReadStream(GZ_PATH), gunzipStream, outStream);
  await unlink(GZ_PATH);

  console.log('[build-dict] Download complete.');
}

function parseLine(line: string): RawEntry | null {
  // Skip comments and blank lines
  if (line.startsWith('#') || line.trim() === '') return null;

  // Format: Traditional Simplified [pinyin] /def1/def2/.../
  const match = line.match(
    /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s*\/(.+)\/\s*$/
  );
  if (!match) return null;

  const [, traditional, simplified, pinyinRaw, defsStr] = match;
  const definitions = defsStr.split('/').filter((d) => d.length > 0);
  const pinyin = pinyinToToneMarks(pinyinRaw);

  return {
    t: traditional,
    s: simplified,
    p: pinyin,
    r: pinyinRaw,
    d: definitions,
  };
}

async function parseCEDICT(): Promise<RawEntry[]> {
  console.log('[build-dict] Parsing CC-CEDICT...');

  const entries: RawEntry[] = [];
  const rl = createInterface({
    input: createReadStream(TXT_PATH, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const entry = parseLine(line);
    if (entry) entries.push(entry);
  }

  console.log(`[build-dict] Parsed ${entries.length} entries.`);
  return entries;
}

async function buildIndex(entries: RawEntry[]): Promise<void> {
  console.log('[build-dict] Building indexed dictionary...');

  // Output: entries array only. The index is built at load time in IndexedDB.
  const output = {
    version: new Date().toISOString().slice(0, 10),
    entries,
  };

  const json = JSON.stringify(output);
  await mkdir(DATA_DIR, { recursive: true });
  createWriteStream(JSON_PATH).end(json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(
    `[build-dict] Wrote ${JSON_PATH} (${sizeMB} MB, ${entries.length} entries)`
  );
}

async function main(): Promise<void> {
  console.log('[build-dict] Starting CC-CEDICT build pipeline...');
  await downloadCEDICT();
  const entries = await parseCEDICT();
  await buildIndex(entries);
  console.log('[build-dict] Done!');
}

main().catch((err) => {
  console.error('[build-dict] Fatal error:', err);
  process.exit(1);
});

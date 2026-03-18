/**
 * IndexedDB wrapper for the Chinese dictionary.
 *
 * Stores CC-CEDICT entries with indexes on both simplified and traditional
 * characters for efficient longest-prefix lookups.
 *
 * Also stores Dong Chinese word and character data in separate stores
 * for enriched popup display.
 */

import type { DictEntry, DongWordEntry, DongCharEntry } from './types';

const DB_NAME = 'zitan-dict';
const DB_VERSION = 2;
const ENTRIES_STORE = 'entries';
const META_STORE = 'meta';
const DONG_WORDS_STORE = 'dongWords';
const DONG_CHARS_STORE = 'dongChars';

let dbInstance: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // Entries store: auto-incrementing key, indexed by simplified & traditional
      if (oldVersion < 1) {
        const store = db.createObjectStore(ENTRIES_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('simplified', 'simplified', { unique: false });
        store.createIndex('traditional', 'traditional', { unique: false });
        store.createIndex('source', 'source', { unique: false });

        // Meta store: key-value for version info, load timestamps, etc.
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }

      // Dong Chinese stores (new in v2)
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(DONG_WORDS_STORE)) {
          const dongWords = db.createObjectStore(DONG_WORDS_STORE, {
            keyPath: 'id',
            autoIncrement: true,
          });
          dongWords.createIndex('simp', 'simp', { unique: false });
          dongWords.createIndex('trad', 'trad', { unique: false });
        }

        if (!db.objectStoreNames.contains(DONG_CHARS_STORE)) {
          db.createObjectStore(DONG_CHARS_STORE, { keyPath: 'char' });
        }
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if the dictionary has been loaded.
 */
export async function isDictLoaded(): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const req = store.get('loaded');
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => resolve(false);
  });
}

/**
 * Get a metadata value.
 */
export async function getMeta(key: string): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => resolve(undefined);
  });
}

/**
 * Bulk-load dictionary entries into IndexedDB.
 * Clears existing entries for the given source before loading.
 */
export async function loadDictionary(
  entries: DictEntry[],
  source: string,
  version: string
): Promise<void> {
  const db = await openDb();

  // Clear old entries for this source
  await clearSource(db, source);

  // Batch insert in chunks to avoid blocking
  const BATCH_SIZE = 5000;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ENTRIES_STORE, 'readwrite');
      const store = tx.objectStore(ENTRIES_STORE);
      for (const entry of batch) {
        store.add(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Set metadata
  await setMeta(db, 'loaded', true);
  await setMeta(db, `version_${source}`, version);
  await setMeta(db, `loadedAt_${source}`, Date.now());
}

/**
 * Look up all entries matching a given key (simplified or traditional).
 */
export async function lookupEntries(
  key: string,
  indexName: 'simplified' | 'traditional' = 'simplified'
): Promise<DictEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, 'readonly');
    const store = tx.objectStore(ENTRIES_STORE);
    const index = store.index(indexName);
    const req = index.getAll(key);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Perform longest-prefix matching on a text string.
 * Tries matching from the longest possible substring down to single characters.
 * Returns the longest match found along with its length.
 */
export async function longestPrefixLookup(
  text: string,
  maxLen: number = 10
): Promise<{ entries: DictEntry[]; matchLen: number } | null> {
  const searchLen = Math.min(text.length, maxLen);

  for (let len = searchLen; len >= 1; len--) {
    const candidate = text.substring(0, len);

    // Try simplified first, then traditional
    let entries = await lookupEntries(candidate, 'simplified');
    if (entries.length === 0) {
      entries = await lookupEntries(candidate, 'traditional');
    }

    if (entries.length > 0) {
      return { entries: deduplicateEntries(entries), matchLen: len };
    }
  }

  return null;
}

/**
 * Find all prefix matches at every substring length.
 * Returns groups sorted longest-first, each with their match length.
 * The longest match determines highlight length.
 */
export async function allPrefixLookup(
  text: string,
  maxLen: number = 10
): Promise<{ groups: { entries: DictEntry[]; matchLen: number }[]; matchLen: number } | null> {
  const searchLen = Math.min(text.length, maxLen);
  const groups: { entries: DictEntry[]; matchLen: number }[] = [];

  for (let len = searchLen; len >= 1; len--) {
    const candidate = text.substring(0, len);

    let entries = await lookupEntries(candidate, 'simplified');
    if (entries.length === 0) {
      entries = await lookupEntries(candidate, 'traditional');
    }

    if (entries.length > 0) {
      groups.push({ entries: deduplicateEntries(entries), matchLen: len });
    }
  }

  if (groups.length === 0) return null;

  return { groups, matchLen: groups[0].matchLen };
}

/**
 * Remove duplicate entries that share the same simplified + traditional + pinyin.
 * Guards against double-inserts from race conditions during dictionary loading.
 */
function deduplicateEntries(entries: DictEntry[]): DictEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.simplified}\t${e.traditional}\t${e.pinyinRaw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- Dong Chinese data ----

/**
 * Check if Dong Chinese dictionaries have been loaded.
 * Checks the actual database rather than a flag, so it survives DB renames.
 */
export async function isDongLoaded(): Promise<boolean> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(DONG_CHARS_STORE, 'readonly');
      const store = tx.objectStore(DONG_CHARS_STORE);
      const req = store.count();
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Load Dong Chinese word entries into IndexedDB.
 */
export async function loadDongWords(
  wordIndex: Record<string, DongWordEntry[]>
): Promise<void> {
  const db = await openDb();

  // Clear existing
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DONG_WORDS_STORE, 'readwrite');
    tx.objectStore(DONG_WORDS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Flatten all entries
  const allEntries: DongWordEntry[] = [];
  for (const entries of Object.values(wordIndex)) {
    allEntries.push(...entries);
  }

  // Batch insert
  const BATCH_SIZE = 5000;
  for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
    const batch = allEntries.slice(i, i + BATCH_SIZE);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DONG_WORDS_STORE, 'readwrite');
      const store = tx.objectStore(DONG_WORDS_STORE);
      for (const entry of batch) {
        store.add(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Load Dong Chinese character entries into IndexedDB.
 */
export async function loadDongChars(
  charMap: Record<string, DongCharEntry>
): Promise<void> {
  const db = await openDb();

  // Clear existing
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DONG_CHARS_STORE, 'readwrite');
    tx.objectStore(DONG_CHARS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Batch insert
  const entries = Object.values(charMap);
  const BATCH_SIZE = 5000;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DONG_CHARS_STORE, 'readwrite');
      const store = tx.objectStore(DONG_CHARS_STORE);
      for (const entry of batch) {
        store.put(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Look up Dong Chinese word entries by simplified form.
 */
export async function lookupDongWord(
  simp: string
): Promise<DongWordEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DONG_WORDS_STORE, 'readonly');
    const store = tx.objectStore(DONG_WORDS_STORE);
    const index = store.index('simp');
    const req = index.getAll(simp);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Look up a Dong Chinese character entry by character.
 */
export async function lookupDongChar(
  char: string
): Promise<DongCharEntry | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DONG_CHARS_STORE, 'readonly');
    const store = tx.objectStore(DONG_CHARS_STORE);
    const req = store.get(char);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete the entire database and reset state.
 */
export async function deleteDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// -- Internal helpers --

function clearSource(db: IDBDatabase, source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, 'readwrite');
    const store = tx.objectStore(ENTRIES_STORE);
    const index = store.index('source');
    const req = index.openCursor(IDBKeyRange.only(source));

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function setMeta(
  db: IDBDatabase,
  key: string,
  value: unknown
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * IndexedDB wrapper for the Chinese dictionary.
 *
 * Stores CC-CEDICT entries with indexes on both simplified and traditional
 * characters for efficient longest-prefix lookups.
 *
 * Designed to be extensible: secondary dictionaries can be loaded with a
 * different `source` tag so they coexist with CC-CEDICT data.
 */

import type { DictEntry } from './types';

const DB_NAME = 'tenzhong-dict';
const DB_VERSION = 1;
const ENTRIES_STORE = 'entries';
const META_STORE = 'meta';

let dbInstance: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Entries store: auto-incrementing key, indexed by simplified & traditional
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        const store = db.createObjectStore(ENTRIES_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('simplified', 'simplified', { unique: false });
        store.createIndex('traditional', 'traditional', { unique: false });
        store.createIndex('source', 'source', { unique: false });
      }

      // Meta store: key-value for version info, load timestamps, etc.
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
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
      return { entries, matchLen: len };
    }
  }

  return null;
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

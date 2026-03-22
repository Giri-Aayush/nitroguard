import type { SignedState } from '../channel/types.js';
import type { PersistenceAdapter } from './PersistenceAdapter.js';
import { PersistenceQuotaError } from '../errors/index.js';

const DB_NAME = 'nitroguard_v1';
const STORE_NAME = 'signed_states';
const CHANNEL_INDEX = 'channel_idx';
const DB_VERSION = 1;

/**
 * Key layout: `${channelId}:${version.toString().padStart(10, '0')}`
 *
 * The zero-padded version makes the key lexicographically sortable, so
 * IDBKeyRange scans return states in version-ascending order without extra
 * sorting. The highest version for a channel is always the last entry in
 * a forward scan over the channel's key range.
 */
function makeKey(channelId: string, version: number): string {
  return `${channelId}:${version.toString().padStart(10, '0')}`;
}

function channelKeyRange(channelId: string): IDBKeyRange {
  // Covers all keys from `${channelId}:0000000000` to `${channelId}:\uffff`
  return IDBKeyRange.bound(`${channelId}:`, `${channelId}:\uffff`);
}

/**
 * Browser-native IndexedDB persistence adapter.
 *
 * Uses the Structured Clone algorithm internally — bigint values are stored
 * and restored without any JSON serialization.
 *
 * Pass an `IDBFactory` instance to the constructor for testability
 * (e.g. `new IDBFactory()` from `fake-indexeddb`). If omitted, falls back
 * to `globalThis.indexedDB`.
 *
 * Phase 2 default for browser environments.
 */
export class IndexedDBAdapter implements PersistenceAdapter {
  private readonly _idb: IDBFactory;
  private _db: IDBDatabase | null = null;

  constructor(idb?: IDBFactory) {
    const factory = idb ?? (typeof globalThis !== 'undefined' ? (globalThis as { indexedDB?: IDBFactory }).indexedDB : undefined);
    if (!factory) {
      throw new Error(
        'IndexedDBAdapter: IndexedDB is not available in this environment. ' +
        'Pass an IDBFactory instance (e.g. from fake-indexeddb) or use MemoryAdapter.',
      );
    }
    this._idb = factory;
  }

  // ─── DB lifecycle ─────────────────────────────────────────────────────────

  private _open(): Promise<IDBDatabase> {
    if (this._db) return Promise.resolve(this._db);

    return new Promise((resolve, reject) => {
      const request = this._idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: '_key' });
          store.createIndex(CHANNEL_INDEX, 'channelId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this._db = (event.target as IDBOpenDBRequest).result;
        resolve(this._db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /** Close the database connection. Call when done to release resources. */
  close(): void {
    this._db?.close();
    this._db = null;
  }

  // ─── PersistenceAdapter ───────────────────────────────────────────────────

  async save(channelId: string, state: SignedState): Promise<void> {
    const db = await this._open();
    const key = makeKey(channelId, state.version);
    const record = { ...state, allocations: state.allocations.map(a => ({ ...a })), _key: key };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onerror = () => {
        const err = req.error;
        if (err?.name === 'QuotaExceededError') {
          reject(new PersistenceQuotaError(`IndexedDB quota exceeded while saving channel ${channelId}`));
        } else {
          reject(err);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        const err = tx.error;
        if (err?.name === 'QuotaExceededError') {
          reject(new PersistenceQuotaError(`IndexedDB quota exceeded while saving channel ${channelId}`));
        } else {
          reject(err);
        }
      };
    });
  }

  async loadLatest(channelId: string): Promise<SignedState | null> {
    const db = await this._open();
    const range = channelKeyRange(channelId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      // Open cursor in reverse — first result is the highest version
      const req = store.openCursor(range, 'prev');

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const { _key: _, ...state } = cursor.value as SignedState & { _key: string };
        resolve(state);
      };

      req.onerror = () => reject(req.error);
    });
  }

  async load(channelId: string, version: number): Promise<SignedState | null> {
    const db = await this._open();
    const key = makeKey(channelId, version);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        if (!req.result) { resolve(null); return; }
        const { _key: _, ...state } = req.result as SignedState & { _key: string };
        resolve(state);
      };

      req.onerror = () => reject(req.error);
    });
  }

  async loadAll(channelId: string): Promise<SignedState[]> {
    const db = await this._open();
    const range = channelKeyRange(channelId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll(range);

      req.onsuccess = () => {
        const results = (req.result as Array<SignedState & { _key: string }>)
          .map(({ _key: _, ...state }) => state)
          .sort((a, b) => a.version - b.version);
        resolve(results);
      };

      req.onerror = () => reject(req.error);
    });
  }

  async listChannels(): Promise<string[]> {
    const db = await this._open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index(CHANNEL_INDEX);
      const req = index.openKeyCursor(null, 'nextunique');
      const channels: string[] = [];

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(channels); return; }
        channels.push(cursor.key as string);
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async clear(channelId: string): Promise<void> {
    const db = await this._open();
    const range = channelKeyRange(channelId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(range);

      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

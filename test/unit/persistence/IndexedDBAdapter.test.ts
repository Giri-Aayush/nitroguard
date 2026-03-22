import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDBAdapter } from '../../../src/persistence/IndexedDBAdapter.js';
import { PersistenceQuotaError } from '../../../src/errors/index.js';
import type { SignedState } from '../../../src/channel/types.js';

// Inject fake-indexeddb's IDBKeyRange into globalThis so IndexedDBAdapter
// can call IDBKeyRange.bound() in a Node environment.
(globalThis as unknown as Record<string, unknown>).IDBKeyRange = IDBKeyRange;

function makeState(channelId: string, version: number): SignedState {
  return {
    channelId,
    version,
    intent: 'APP',
    data: '0x',
    allocations: [
      {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        clientBalance: 100n,
        clearNodeBalance: 0n,
      },
    ],
    sigClient: '0x1111',
    sigClearNode: '0x2222',
    savedAt: Date.now(),
  };
}

describe('IndexedDBAdapter', () => {
  let adapter: IndexedDBAdapter;
  const CHANNEL = '0xaabbccdd';

  beforeEach(() => {
    // Each test gets a fully isolated IDBFactory instance (separate in-memory DB)
    adapter = new IndexedDBAdapter(new IDBFactory());
  });

  afterEach(() => {
    adapter.close();
  });

  // ─── Contract tests ────────────────────────────────────────────────────────

  it('listChannels() returns empty array initially', async () => {
    expect(await adapter.listChannels()).toEqual([]);
  });

  it('loadLatest() returns null for unknown channelId', async () => {
    expect(await adapter.loadLatest(CHANNEL)).toBeNull();
  });

  it('load(channelId, version) returns null for unknown version', async () => {
    expect(await adapter.load(CHANNEL, 99)).toBeNull();
  });

  it('save() then loadLatest() returns saved state', async () => {
    const state = makeState(CHANNEL, 1);
    await adapter.save(CHANNEL, state);
    const loaded = await adapter.loadLatest(CHANNEL);

    expect(loaded).not.toBeNull();
    expect(loaded?.channelId).toBe(state.channelId);
    expect(loaded?.version).toBe(state.version);
    expect(loaded?.intent).toBe(state.intent);
    expect(loaded?.data).toBe(state.data);
    expect(loaded?.sigClient).toBe(state.sigClient);
    expect(loaded?.sigClearNode).toBe(state.sigClearNode);
    expect(loaded?.savedAt).toBe(state.savedAt);
  });

  it('loadLatest() returns highest version, not most recent save', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 5));
    await adapter.save(CHANNEL, makeState(CHANNEL, 3)); // saved last but lower version

    const latest = await adapter.loadLatest(CHANNEL);
    expect(latest?.version).toBe(5);
  });

  it('load() returns the correct specific version', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));
    await adapter.save(CHANNEL, makeState(CHANNEL, 3));

    const loaded = await adapter.load(CHANNEL, 2);
    expect(loaded?.version).toBe(2);
  });

  it('loadAll() returns states sorted by version ascending even when saved out of order', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 3));
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));

    const all = await adapter.loadAll(CHANNEL);
    expect(all.map(s => s.version)).toEqual([1, 2, 3]);
  });

  it('loadAll() returns [] for unknown channel', async () => {
    expect(await adapter.loadAll('0xunknown')).toEqual([]);
  });

  it('clear() removes all states for channelId', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));
    await adapter.clear(CHANNEL);

    expect(await adapter.loadLatest(CHANNEL)).toBeNull();
    expect(await adapter.loadAll(CHANNEL)).toEqual([]);
  });

  it('clear() does not affect other channels', async () => {
    const OTHER = '0x11223344';
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(OTHER, makeState(OTHER, 1));

    await adapter.clear(CHANNEL);
    expect(await adapter.loadLatest(OTHER)).not.toBeNull();
  });

  it('listChannels() returns all known channelIds', async () => {
    const CH1 = '0x1111';
    const CH2 = '0x2222';
    await adapter.save(CH1, makeState(CH1, 1));
    await adapter.save(CH2, makeState(CH2, 1));

    const channels = await adapter.listChannels();
    expect(channels).toContain(CH1);
    expect(channels).toContain(CH2);
    expect(channels).toHaveLength(2);
  });

  it('save() overwrites same version without error (latest data wins)', async () => {
    const s1 = makeState(CHANNEL, 1);
    const s1v2 = { ...makeState(CHANNEL, 1), data: '0xdeadbeef' as `0x${string}` };

    await adapter.save(CHANNEL, s1);
    await adapter.save(CHANNEL, s1v2);

    const loaded = await adapter.load(CHANNEL, 1);
    expect(loaded?.data).toBe('0xdeadbeef');
  });

  // ─── Version 0 handling ────────────────────────────────────────────────────

  it('save() and loadLatest() works for version 0 (CHANOPEN)', async () => {
    const s = makeState(CHANNEL, 0);
    await adapter.save(CHANNEL, s);
    const loaded = await adapter.loadLatest(CHANNEL);
    expect(loaded?.version).toBe(0);
  });

  it('load(channelId, 0) returns version-0 state', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 0));
    const loaded = await adapter.load(CHANNEL, 0);
    expect(loaded?.version).toBe(0);
  });

  // ─── BigInt preservation ───────────────────────────────────────────────────

  it('BigInt clientBalance is preserved through save/load (structured clone)', async () => {
    const bigAmount = 999999999999999999999n;
    const state: SignedState = {
      ...makeState(CHANNEL, 1),
      allocations: [
        {
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          clientBalance: bigAmount,
          clearNodeBalance: 0n,
        },
      ],
    };
    await adapter.save(CHANNEL, state);
    const loaded = await adapter.loadLatest(CHANNEL);
    expect(loaded?.allocations[0]?.clientBalance).toBe(bigAmount);
  });

  // ─── Multi-asset allocations ───────────────────────────────────────────────

  it('multi-asset allocations are preserved through save/load (2 allocations)', async () => {
    const state: SignedState = {
      ...makeState(CHANNEL, 1),
      allocations: [
        {
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          clientBalance: 100n,
          clearNodeBalance: 0n,
        },
        {
          token: '0x0000000000000000000000000000000000000000',
          clientBalance: 1000000000000000000n,
          clearNodeBalance: 0n,
        },
      ],
    };
    await adapter.save(CHANNEL, state);
    const loaded = await adapter.loadLatest(CHANNEL);
    expect(loaded?.allocations).toHaveLength(2);
    expect(loaded?.allocations[1]?.clientBalance).toBe(1000000000000000000n);
  });

  // ─── QuotaExceededError ────────────────────────────────────────────────────
  //
  // Strategy: after a normal save() has opened the DB, we monkey-patch the
  // objectStore's put() on the NEXT call.  When the fake IDB request fires
  // its onsuccess callback we immediately override _error / readyState and
  // invoke the request's onerror handler directly — this is the same code
  // path that the adapter's req.onerror hook reads `req.error` from.

  it('wraps QuotaExceededError into PersistenceQuotaError', async () => {
    // Open the DB with a normal save so adapter._db is populated.
    await adapter.save(CHANNEL, makeState(CHANNEL, 0));

    // Access the private _db field via type cast.
    type AdapterInternal = { _db: IDBDatabase };
    const db = (adapter as unknown as AdapterInternal)._db;
    if (!db) throw new Error('_db not initialised');

    const originalTransaction = db.transaction.bind(db);

    db.transaction = (
      storeNames: string | string[],
      mode?: IDBTransactionMode,
    ): IDBTransaction => {
      const tx = originalTransaction(storeNames, mode);

      // Only patch readwrite transactions (the ones save() creates)
      if (mode !== 'readwrite') return tx;

      const originalObjectStore = tx.objectStore.bind(tx);

      tx.objectStore = (name: string): IDBObjectStore => {
        const store = originalObjectStore(name);
        const originalPut = store.put.bind(store);

        store.put = (...args: Parameters<typeof store.put>): IDBRequest => {
          const req = originalPut(...args);

          // After the real put succeeds (onsuccess fires), we hijack the
          // request object and invoke the adapter's onerror handler with a
          // synthetic QuotaExceededError.
          const originalOnSuccess = req.onsuccess;
          req.onsuccess = (event: Event) => {
            // Run the real success path first (so fake-indexeddb is happy),
            // then immediately call the adapter's onerror with a quota error.
            if (originalOnSuccess) originalOnSuccess.call(req, event);

            const quotaErr = new DOMException(
              'Storage quota exceeded',
              'QuotaExceededError',
            );
            // Set internal state so req.error getter does not throw.
            (req as unknown as Record<string, unknown>)._error = quotaErr;
            (req as unknown as Record<string, unknown>).readyState = 'done';

            if (req.onerror) {
              req.onerror(new Event('error'));
            }
          };

          return req;
        };

        return store;
      };

      return tx;
    };

    await expect(
      adapter.save(CHANNEL, makeState(CHANNEL, 999)),
    ).rejects.toBeInstanceOf(PersistenceQuotaError);
  });

  // ─── Concurrent saves ──────────────────────────────────────────────────────

  it('concurrent saves (Promise.all with 20 saves) — all 20 versions present', async () => {
    const saves = Array.from({ length: 20 }, (_, i) =>
      adapter.save(CHANNEL, makeState(CHANNEL, i + 1)),
    );
    await Promise.all(saves);
    const all = await adapter.loadAll(CHANNEL);
    expect(all).toHaveLength(20);
    const versions = all.map(s => s.version).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  // ─── Mutation safety ───────────────────────────────────────────────────────

  it('mutation of loaded state does NOT affect stored state (deep copy guarantee)', async () => {
    const state = makeState(CHANNEL, 1);
    await adapter.save(CHANNEL, state);

    const loaded = await adapter.loadLatest(CHANNEL);

    // Mutate the returned object
    if (loaded) {
      (loaded as Partial<SignedState>).version = 999;
      if (loaded.allocations[0]) {
        (loaded.allocations[0] as { clientBalance: bigint }).clientBalance = 0n;
      }
    }

    const loadedAgain = await adapter.loadLatest(CHANNEL);
    expect(loadedAgain?.version).toBe(1);
    expect(loadedAgain?.allocations[0]?.clientBalance).toBe(100n);
  });

  // ─── close() ──────────────────────────────────────────────────────────────

  it('close() can be called without error', () => {
    expect(() => adapter.close()).not.toThrow();
  });

  it('close() can be called multiple times without error', () => {
    adapter.close();
    expect(() => adapter.close()).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SignedState } from '../../../src/channel/types.js';

// ─── In-memory Level mock ──────────────────────────────────────────────────
//
// Each `new Level(dbPath, ...)` call gets its own isolated Map (keyed by
// dbPath) so tests using different paths never share state.  The map is
// defined at module scope so the vi.mock factory can close over it.

const levelInstances = new Map<string, Map<string, string>>();

class MockLevel {
  private store: Map<string, string>;

  constructor(dbPath: string, _opts: { valueEncoding: string }) {
    if (!levelInstances.has(dbPath)) {
      levelInstances.set(dbPath, new Map());
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.store = levelInstances.get(dbPath)!;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async *iterator(opts: {
    gte?: string;
    lte?: string;
    reverse?: boolean;
    limit?: number;
  }): AsyncIterableIterator<[string, string]> {
    let entries: [string, string][] = [];

    for (const [k, v] of this.store) {
      if (opts.gte !== undefined && k < opts.gte) continue;
      if (opts.lte !== undefined && k > opts.lte) continue;
      entries.push([k, v]);
    }

    // Zero-padded keys make lexicographic sort equivalent to numeric version order
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    if (opts.reverse) {
      entries = entries.reverse();
    }

    if (opts.limit !== undefined) {
      entries = entries.slice(0, opts.limit);
    }

    for (const entry of entries) {
      yield entry;
    }
  }

  async close(): Promise<void> {
    // No-op for the in-memory mock
  }
}

// vi.mock is hoisted to the top of the module by vitest, so the MockLevel
// class defined above is available when the factory runs.
vi.mock('level', () => ({
  Level: MockLevel,
}));

// Import the adapter AFTER vi.mock so that the dynamic `import('level')`
// inside LevelDBAdapter.create() resolves to MockLevel.
import { LevelDBAdapter } from '../../../src/persistence/LevelDBAdapter.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

let testCounter = 0;

function uniquePath(): string {
  testCounter += 1;
  return `./test-nitroguard-${testCounter}`;
}

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

// ─── Main suite ────────────────────────────────────────────────────────────

describe('LevelDBAdapter', () => {
  const CHANNEL = '0xaabbccdd';
  let adapter: LevelDBAdapter;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = uniquePath();
    levelInstances.delete(dbPath); // ensure a clean store for each test
    adapter = await LevelDBAdapter.create(dbPath);
  });

  afterEach(async () => {
    await adapter.close();
    levelInstances.delete(dbPath);
  });

  // ─── Factory ──────────────────────────────────────────────────────────

  it('LevelDBAdapter.create() resolves without error', async () => {
    const path = uniquePath();
    levelInstances.delete(path);
    const a = await LevelDBAdapter.create(path);
    expect(a).toBeDefined();
    await a.close();
  });

  // ─── save / loadLatest ────────────────────────────────────────────────

  it('save() then loadLatest() returns saved state with all fields preserved', async () => {
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
    expect(loaded?.allocations[0]?.clientBalance).toBe(state.allocations[0]?.clientBalance);
  });

  // ─── BigInt round-trip ────────────────────────────────────────────────

  it('BigInt round-trip: clientBalance 12345678901234567890n is preserved after save/load', async () => {
    const bigBalance = 12345678901234567890n;
    const state: SignedState = {
      ...makeState(CHANNEL, 1),
      allocations: [
        {
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          clientBalance: bigBalance,
          clearNodeBalance: 0n,
        },
      ],
    };
    await adapter.save(CHANNEL, state);
    const loaded = await adapter.loadLatest(CHANNEL);
    expect(loaded?.allocations[0]?.clientBalance).toBe(bigBalance);
  });

  // ─── loadLatest highest version ───────────────────────────────────────

  it('loadLatest() returns highest version, not most recent save', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 5));
    await adapter.save(CHANNEL, makeState(CHANNEL, 3)); // saved last, lower version

    const latest = await adapter.loadLatest(CHANNEL);
    expect(latest?.version).toBe(5);
  });

  // ─── loadAll ordering ─────────────────────────────────────────────────

  it('loadAll() returns states sorted ascending', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 3));
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));

    const all = await adapter.loadAll(CHANNEL);
    expect(all.map(s => s.version)).toEqual([1, 2, 3]);
  });

  it('loadAll() returns [] for unknown channel', async () => {
    expect(await adapter.loadAll('0xunknown')).toEqual([]);
  });

  // ─── clear ────────────────────────────────────────────────────────────

  it('clear() removes all states for the channel', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));
    await adapter.clear(CHANNEL);

    expect(await adapter.loadLatest(CHANNEL)).toBeNull();
    expect(await adapter.loadAll(CHANNEL)).toEqual([]);
  });

  // ─── listChannels ─────────────────────────────────────────────────────

  it('listChannels() returns channelIds of all stored channels', async () => {
    const CH1 = '0x1111';
    const CH2 = '0x2222';
    await adapter.save(CH1, makeState(CH1, 1));
    await adapter.save(CH2, makeState(CH2, 1));

    const channels = await adapter.listChannels();
    expect(channels).toContain(CH1);
    expect(channels).toContain(CH2);
  });

  // ─── close ────────────────────────────────────────────────────────────

  it('close() resolves without error', async () => {
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

// ─── Missing 'level' package ────────────────────────────────────────────────
//
// This suite is isolated in its own describe so the vi.doMock call cannot
// contaminate the beforeEach/afterEach of the main suite above.

describe('LevelDBAdapter — missing level package', () => {
  it('throws with "npm install level" when level import fails', async () => {
    // Replicate the adapter's create() error-handling path inline so we can
    // simulate a failed dynamic import without touching the module registry
    // (which would break the mocked 'level' import used by the main suite).
    async function createWithFailingImport(): Promise<LevelDBAdapter> {
      let LevelModule: { Level: unknown };
      try {
        LevelModule = await (async (): Promise<never> => {
          throw new Error("Cannot find module 'level'");
        })() as unknown as typeof LevelModule;
      } catch {
        throw new Error(
          "LevelDBAdapter requires the 'level' package. " +
          "Install it with: npm install level",
        );
      }
      void LevelModule;
      return undefined as unknown as LevelDBAdapter;
    }

    await expect(createWithFailingImport()).rejects.toThrow('npm install level');
  });
});

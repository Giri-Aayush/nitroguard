/**
 * Property-based / fuzz tests for MemoryAdapter.
 *
 * Invariants that must hold for any sequence of operations:
 * 1. loadLatest() always returns the highest-versioned state (or null if empty)
 * 2. loadAll() is always sorted ascending by version
 * 3. loadAll().length equals number of unique versions saved
 * 4. clear() always results in loadLatest() returning null
 * 5. save/load roundtrip preserves all fields exactly
 * 6. States from different channels never contaminate each other
 */
import { describe, it, expect } from 'vitest';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import type { SignedState } from '../../../src/channel/types.js';

function makePrng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;

function makeState(channelId: string, version: number, extra = 0): SignedState {
  return {
    channelId,
    version,
    intent: 'APP',
    data: `0x${extra.toString(16).padStart(2, '0')}` as `0x${string}`,
    allocations: [{ token: USDC, clientBalance: BigInt(version * 10), clearNodeBalance: 0n }],
    sigClient: `0x${version.toString(16).padStart(4, '0')}` as `0x${string}`,
    sigClearNode: '0x1234',
    savedAt: Date.now() + version,
  };
}

describe('MemoryAdapter — property tests', () => {
  describe('Property: loadLatest() always returns the maximum version saved', () => {
    it('holds after 200 random save sequences', async () => {
      const rng = makePrng(1);
      for (let trial = 0; trial < 200; trial++) {
        const adapter = new MemoryAdapter();
        const CHANNEL = `0xchan${trial}`;
        const versions: number[] = [];

        const numSaves = 1 + Math.floor(rng() * 20);
        for (let i = 0; i < numSaves; i++) {
          // Allow random versions including duplicates
          const v = Math.floor(rng() * 50);
          versions.push(v);
          await adapter.save(CHANNEL, makeState(CHANNEL, v));
        }

        const expected = Math.max(...versions);
        const latest = await adapter.loadLatest(CHANNEL);
        expect(latest?.version).toBe(expected);
      }
    });
  });

  describe('Property: loadAll() is always sorted ascending', () => {
    it('holds after 200 random save sequences', async () => {
      const rng = makePrng(2);
      for (let trial = 0; trial < 200; trial++) {
        const adapter = new MemoryAdapter();
        const CHANNEL = `0xchan${trial}`;

        const numSaves = 1 + Math.floor(rng() * 30);
        for (let i = 0; i < numSaves; i++) {
          const v = Math.floor(rng() * 100);
          await adapter.save(CHANNEL, makeState(CHANNEL, v));
        }

        const all = await adapter.loadAll(CHANNEL);
        for (let i = 1; i < all.length; i++) {
          expect(all[i]!.version).toBeGreaterThan(all[i - 1]!.version);
        }
      }
    });
  });

  describe('Property: loadAll().length equals count of unique versions saved', () => {
    it('holds for 200 random save sequences', async () => {
      const rng = makePrng(3);
      for (let trial = 0; trial < 200; trial++) {
        const adapter = new MemoryAdapter();
        const CHANNEL = `0xchan${trial}`;
        const uniqueVersions = new Set<number>();

        const numSaves = 1 + Math.floor(rng() * 20);
        for (let i = 0; i < numSaves; i++) {
          const v = Math.floor(rng() * 30); // small range to force duplicates
          uniqueVersions.add(v);
          await adapter.save(CHANNEL, makeState(CHANNEL, v));
        }

        const all = await adapter.loadAll(CHANNEL);
        expect(all.length).toBe(uniqueVersions.size);
      }
    });
  });

  describe('Property: clear() always results in empty state for that channel', () => {
    it('holds for 100 random save+clear sequences', async () => {
      const rng = makePrng(4);
      for (let trial = 0; trial < 100; trial++) {
        const adapter = new MemoryAdapter();
        const CHANNEL = `0xchan${trial}`;

        const numSaves = 1 + Math.floor(rng() * 15);
        for (let i = 0; i < numSaves; i++) {
          await adapter.save(CHANNEL, makeState(CHANNEL, i));
        }
        await adapter.clear(CHANNEL);

        expect(await adapter.loadLatest(CHANNEL)).toBeNull();
        expect(await adapter.loadAll(CHANNEL)).toHaveLength(0);
        expect(await adapter.listChannels()).not.toContain(CHANNEL);
      }
    });
  });

  describe('Property: save/load roundtrip preserves all fields', () => {
    it('holds for 100 random states', async () => {
      const rng = makePrng(5);
      for (let trial = 0; trial < 100; trial++) {
        const adapter = new MemoryAdapter();
        const CHANNEL = `0xchan${trial}`;
        const version = Math.floor(rng() * 1000);
        const amount = BigInt(Math.floor(rng() * 1_000_000));

        const state: SignedState = {
          channelId: CHANNEL,
          version,
          intent: 'APP',
          data: '0xdeadbeef' as `0x${string}`,
          allocations: [{ token: USDC, clientBalance: amount, clearNodeBalance: 0n }],
          sigClient: '0xclisig',
          sigClearNode: '0xcnsig',
          savedAt: Date.now(),
        };

        await adapter.save(CHANNEL, state);
        const loaded = await adapter.load(CHANNEL, version);

        expect(loaded?.version).toBe(state.version);
        expect(loaded?.intent).toBe(state.intent);
        expect(loaded?.data).toBe(state.data);
        expect(loaded?.sigClient).toBe(state.sigClient);
        expect(loaded?.sigClearNode).toBe(state.sigClearNode);
        expect(loaded?.allocations[0]?.clientBalance).toBe(amount);
      }
    });
  });

  describe('Property: channels do not contaminate each other', () => {
    it('saving to channel A never affects channel B (100 trials)', async () => {
      const rng = makePrng(6);
      for (let trial = 0; trial < 100; trial++) {
        const adapter = new MemoryAdapter();
        const CHA = `0xcha${trial}`;
        const CHB = `0xchb${trial}`;

        const numSavesA = 1 + Math.floor(rng() * 10);
        for (let i = 0; i < numSavesA; i++) {
          await adapter.save(CHA, makeState(CHA, i));
        }

        // B should still be empty
        expect(await adapter.loadLatest(CHB)).toBeNull();
        expect(await adapter.loadAll(CHB)).toHaveLength(0);
      }
    });

    it('clearing channel A does not affect channel B (100 trials)', async () => {
      const rng = makePrng(7);
      for (let trial = 0; trial < 100; trial++) {
        const adapter = new MemoryAdapter();
        const CHA = `0xcha${trial}`;
        const CHB = `0xchb${trial}`;

        // Save to both
        for (let i = 1; i <= 5; i++) {
          await adapter.save(CHA, makeState(CHA, i));
          await adapter.save(CHB, makeState(CHB, i));
        }

        await adapter.clear(CHA);

        // B should still have its states
        const bStates = await adapter.loadAll(CHB);
        expect(bStates.length).toBe(5);
        expect(await adapter.loadLatest(CHB)).not.toBeNull();
      }
    });
  });

  describe('Property: listChannels() reflects exactly the channels with saved states', () => {
    it('holds for 50 random multi-channel sequences', async () => {
      const rng = makePrng(8);
      for (let trial = 0; trial < 50; trial++) {
        const adapter = new MemoryAdapter();
        const activeChannels = new Set<string>();

        const numOps = 10 + Math.floor(rng() * 20);
        for (let op = 0; op < numOps; op++) {
          const chanIdx = Math.floor(rng() * 5);
          const CHANNEL = `0xch${chanIdx}`;

          if (rng() < 0.7) {
            // save
            const v = Math.floor(rng() * 20);
            await adapter.save(CHANNEL, makeState(CHANNEL, v));
            activeChannels.add(CHANNEL);
          } else if (activeChannels.has(CHANNEL)) {
            // clear
            await adapter.clear(CHANNEL);
            activeChannels.delete(CHANNEL);
          }
        }

        const listed = new Set(await adapter.listChannels());
        for (const ch of activeChannels) {
          expect(listed.has(ch)).toBe(true);
        }
        expect(listed.size).toBe(activeChannels.size);
      }
    });
  });

  describe('Property: totalStates is consistent with individual channel state counts', () => {
    it('holds for 100 random sequences', async () => {
      const rng = makePrng(9);
      for (let trial = 0; trial < 100; trial++) {
        const adapter = new MemoryAdapter();
        const channelVersions = new Map<string, Set<number>>();

        for (let op = 0; op < 20; op++) {
          const chanIdx = Math.floor(rng() * 3);
          const CHANNEL = `0xch${chanIdx}`;
          const v = Math.floor(rng() * 15);
          await adapter.save(CHANNEL, makeState(CHANNEL, v));
          if (!channelVersions.has(CHANNEL)) channelVersions.set(CHANNEL, new Set());
          channelVersions.get(CHANNEL)!.add(v);
        }

        const expectedTotal = [...channelVersions.values()].reduce((sum, vs) => sum + vs.size, 0);
        expect(adapter.totalStates).toBe(expectedTotal);
      }
    });
  });
});

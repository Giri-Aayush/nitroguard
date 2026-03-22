import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import type { SignedState } from '../../../src/channel/types.js';

function makeState(channelId: string, version: number): SignedState {
  return {
    channelId,
    version,
    intent: 'APP',
    data: '0x',
    allocations: [
      { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', clientBalance: 100n, clearNodeBalance: 0n },
    ],
    sigClient: '0x1111',
    sigClearNode: '0x2222',
    savedAt: Date.now(),
  };
}

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;
  const CHANNEL = '0xaabbccdd';

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

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
    expect(loaded).toEqual(state);
  });

  it('loadLatest() returns highest version, not most recent save', async () => {
    const s1 = makeState(CHANNEL, 1);
    const s5 = makeState(CHANNEL, 5);
    const s3 = makeState(CHANNEL, 3);

    await adapter.save(CHANNEL, s1);
    await adapter.save(CHANNEL, s5);
    await adapter.save(CHANNEL, s3); // saved last but lower version

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

  it('loadAll() returns states sorted by version ascending', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 3));
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));

    const all = await adapter.loadAll(CHANNEL);
    expect(all.map(s => s.version)).toEqual([1, 2, 3]);
  });

  it('loadAll() returns empty array for unknown channelId', async () => {
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

  it('save() overwrites same version without error', async () => {
    const s1 = makeState(CHANNEL, 1);
    const s1v2 = { ...makeState(CHANNEL, 1), data: '0xdeadbeef' as `0x${string}` };

    await adapter.save(CHANNEL, s1);
    await adapter.save(CHANNEL, s1v2);

    const loaded = await adapter.load(CHANNEL, 1);
    expect(loaded?.data).toBe('0xdeadbeef');
  });

  it('saved state is returned as a copy (mutation safe)', async () => {
    const state = makeState(CHANNEL, 1);
    await adapter.save(CHANNEL, state);

    const loaded = await adapter.loadLatest(CHANNEL);
    (loaded as Partial<SignedState>).version = 999; // mutate the result

    const loadedAgain = await adapter.loadLatest(CHANNEL);
    expect(loadedAgain?.version).toBe(1); // original unchanged
  });

  it('totalStates helper counts all states across channels', async () => {
    await adapter.save('0x1111', makeState('0x1111', 1));
    await adapter.save('0x1111', makeState('0x1111', 2));
    await adapter.save('0x2222', makeState('0x2222', 1));

    expect(adapter.totalStates).toBe(3);
  });

  it('handles 1000 states for a single channel', async () => {
    for (let i = 1; i <= 1000; i++) {
      await adapter.save(CHANNEL, makeState(CHANNEL, i));
    }
    const latest = await adapter.loadLatest(CHANNEL);
    expect(latest?.version).toBe(1000);

    const all = await adapter.loadAll(CHANNEL);
    expect(all).toHaveLength(1000);
  });

  // ─── Version 0 handling ───────────────────────────────────────────────────

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

  it('version 0 is superseded by version 1 in loadLatest()', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 0));
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    const latest = await adapter.loadLatest(CHANNEL);
    expect(latest?.version).toBe(1);
  });

  // ─── Multi-channel isolation ──────────────────────────────────────────────

  it('save to one channel does not appear in another', async () => {
    const OTHER = '0xother';
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    expect(await adapter.loadLatest(OTHER)).toBeNull();
    expect(await adapter.loadAll(OTHER)).toHaveLength(0);
  });

  it('clear() removes channelId from listChannels()', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.clear(CHANNEL);
    const channels = await adapter.listChannels();
    expect(channels).not.toContain(CHANNEL);
  });

  it('clear() on unknown channelId does not throw', async () => {
    await expect(adapter.clear('0xnonexistent')).resolves.toBeUndefined();
  });

  it('listChannels() does not include channel after all states are overwritten by clear', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));
    await adapter.clear(CHANNEL);
    expect(await adapter.listChannels()).not.toContain(CHANNEL);
  });

  // ─── Allocation data integrity ────────────────────────────────────────────

  it('allocations are saved and loaded correctly (bigint preserved)', async () => {
    const bigAmount = 999999999999999999999n;
    const state: SignedState = {
      ...makeState(CHANNEL, 1),
      allocations: [
        { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', clientBalance: bigAmount, clearNodeBalance: 0n },
      ],
    };
    await adapter.save(CHANNEL, state);
    const loaded = await adapter.loadLatest(CHANNEL);
    expect(loaded?.allocations[0]?.clientBalance).toBe(bigAmount);
  });

  it('multi-asset allocations are preserved through save/load', async () => {
    const state: SignedState = {
      ...makeState(CHANNEL, 1),
      allocations: [
        { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', clientBalance: 100n, clearNodeBalance: 0n },
        { token: '0x0000000000000000000000000000000000000000', clientBalance: 1000000000000000000n, clearNodeBalance: 0n },
      ],
    };
    await adapter.save(CHANNEL, state);
    const loaded = await adapter.loadLatest(CHANNEL);
    expect(loaded?.allocations).toHaveLength(2);
    expect(loaded?.allocations[1]?.clientBalance).toBe(1000000000000000000n);
  });

  // ─── loadAll ordering guarantee ────────────────────────────────────────────

  it('loadAll() is sorted ascending even when saved out of order', async () => {
    // Save in random order
    await adapter.save(CHANNEL, makeState(CHANNEL, 5));
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));
    await adapter.save(CHANNEL, makeState(CHANNEL, 3));
    await adapter.save(CHANNEL, makeState(CHANNEL, 2));
    await adapter.save(CHANNEL, makeState(CHANNEL, 4));

    const all = await adapter.loadAll(CHANNEL);
    expect(all.map(s => s.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it('loadAll() including version 0 sorts correctly', async () => {
    await adapter.save(CHANNEL, makeState(CHANNEL, 3));
    await adapter.save(CHANNEL, makeState(CHANNEL, 0));
    await adapter.save(CHANNEL, makeState(CHANNEL, 1));

    const all = await adapter.loadAll(CHANNEL);
    expect(all.map(s => s.version)).toEqual([0, 1, 3]);
  });

  // ─── Save mutations don't affect stored state ─────────────────────────────

  it('mutating the original state after save() does not corrupt stored state', async () => {
    const state = makeState(CHANNEL, 1);
    await adapter.save(CHANNEL, state);

    // Mutate the original object
    state.version = 999;
    (state.allocations[0] as { clientBalance: bigint }).clientBalance = 0n;

    const loaded = await adapter.loadLatest(CHANNEL);
    expect(loaded?.version).toBe(1);
    expect(loaded?.allocations[0]?.clientBalance).toBe(100n);
  });

  // ─── Concurrent async save ordering ──────────────────────────────────────

  it('concurrent saves to the same channel all persist correctly', async () => {
    const saves = Array.from({ length: 50 }, (_, i) =>
      adapter.save(CHANNEL, makeState(CHANNEL, i + 1)),
    );
    await Promise.all(saves);
    const all = await adapter.loadAll(CHANNEL);
    expect(all).toHaveLength(50);
    expect(all.map(s => s.version)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('concurrent saves to different channels do not interfere', async () => {
    const CH1 = '0xch1';
    const CH2 = '0xch2';
    const CH3 = '0xch3';

    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => adapter.save(CH1, makeState(CH1, i))),
      ...Array.from({ length: 10 }, (_, i) => adapter.save(CH2, makeState(CH2, i))),
      ...Array.from({ length: 10 }, (_, i) => adapter.save(CH3, makeState(CH3, i))),
    ]);

    expect((await adapter.loadAll(CH1))).toHaveLength(10);
    expect((await adapter.loadAll(CH2))).toHaveLength(10);
    expect((await adapter.loadAll(CH3))).toHaveLength(10);
  });
});

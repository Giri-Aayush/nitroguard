import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Channel, type ChannelConstructorParams } from '../../../src/channel/Channel.js';
import { ChannelFSM } from '../../../src/channel/ChannelFSM.js';
import { VersionManager } from '../../../src/channel/VersionManager.js';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import {
  InvalidTransitionError,
  CoSignatureTimeoutError,
  NoPersistenceError,
} from '../../../src/errors/index.js';
import type { ClearNodeTransport } from '../../../src/channel/transport.js';
import type { SignedState } from '../../../src/channel/types.js';

// ─── Test chain ──────────────────────────────────────────────────────────────

const TEST_CHAIN = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] }, public: { http: ['http://127.0.0.1:8545'] } },
} as const;

const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const BOB   = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const USDC  = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const CHANNEL_ID = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// ─── Transport stub factory ───────────────────────────────────────────────────

function makeTransport(overrides: Partial<ClearNodeTransport> = {}): ClearNodeTransport {
  const coSign = (state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` }): SignedState => ({
    ...state,
    sigClient: state.sigClient ?? '0xclisig',
    sigClearNode: '0xcnsig',
    savedAt: Date.now(),
  });

  return {
    isConnected: true,
    clearNodeAddress: BOB,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    proposeState: vi.fn().mockImplementation(async (_id, state) => coSign(state)),
    openChannel: vi.fn().mockImplementation(async (_id, state) => coSign(state)),
    closeChannel: vi.fn().mockImplementation(async (_id, state) => coSign(state)),
    onMessage: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

// ─── Channel factory helper ───────────────────────────────────────────────────

function makeChannel(
  overrides: Partial<ChannelConstructorParams> & { transport?: ClearNodeTransport } = {},
): { channel: Channel; fsm: ChannelFSM; versions: VersionManager; persistence: MemoryAdapter; transport: ClearNodeTransport } {
  const fsm = new ChannelFSM();
  const versions = new VersionManager();
  const persistence = new MemoryAdapter();
  const transport = overrides.transport ?? makeTransport();

  const channel = new Channel({
    channelId: CHANNEL_ID,
    participants: [ALICE, BOB],
    assets: [{ token: USDC, amount: 100n }],
    chain: TEST_CHAIN as Parameters<typeof Channel>[0] extends never ? never : Parameters<typeof channel.on>[0] extends never ? never : ChannelConstructorParams['chain'],
    channelParams: {
      participants: [ALICE, BOB],
      nonce: 0n,
      appDefinition: '0x0000000000000000000000000000000000000000',
      challengeDuration: 3600,
      chainId: 31337,
    },
    fsm,
    versionManager: versions,
    persistence,
    transport,
    ...overrides,
  });

  return { channel, fsm, versions, persistence, transport };
}

// ─── Helper: get ACTIVE channel ──────────────────────────────────────────────

function activeChannel(
  overrides: Partial<ChannelConstructorParams> & { transport?: ClearNodeTransport } = {},
) {
  const parts = makeChannel(overrides);
  parts.fsm._forceSet('ACTIVE');
  return parts;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Channel', () => {
  // ─── Properties ────────────────────────────────────────────────────────────

  describe('properties', () => {
    it('id is set correctly', () => {
      const { channel } = makeChannel();
      expect(channel.id).toBe(CHANNEL_ID);
    });

    it('participants are set correctly', () => {
      const { channel } = makeChannel();
      expect(channel.participants[0]).toBe(ALICE);
      expect(channel.participants[1]).toBe(BOB);
    });

    it('assets reflect initial config', () => {
      const { channel } = makeChannel();
      expect(channel.assets[0]?.token).toBe(USDC);
      expect(channel.assets[0]?.amount).toBe(100n);
    });

    it('status delegates to FSM', () => {
      const { channel, fsm } = makeChannel();
      expect(channel.status).toBe('VOID');
      fsm._forceSet('ACTIVE');
      expect(channel.status).toBe('ACTIVE');
    });

    it('version delegates to VersionManager', () => {
      const { channel, versions } = makeChannel();
      expect(channel.version).toBe(0);
      versions.next(); versions.confirm(1);
      expect(channel.version).toBe(1);
    });

    it('createdAt defaults to now', () => {
      const before = Date.now();
      const { channel } = makeChannel();
      expect(channel.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(channel.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('chain is stored', () => {
      const { channel } = makeChannel();
      expect(channel.chain.id).toBe(31337);
    });
  });

  // ─── send() ────────────────────────────────────────────────────────────────

  describe('send()', () => {
    it('throws InvalidTransitionError when status is VOID', async () => {
      const { channel } = makeChannel(); // VOID state
      await expect(channel.send({ type: 'payment' })).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when status is FINAL', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('FINAL');
      await expect(channel.send({ type: 'payment' })).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when status is DISPUTE', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('DISPUTE');
      await expect(channel.send({ type: 'payment' })).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when status is INITIAL', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('INITIAL');
      await expect(channel.send({ type: 'payment' })).rejects.toThrow(InvalidTransitionError);
    });

    it('increments version by 1 on success', async () => {
      const { channel } = activeChannel();
      const result = await channel.send({ type: 'payment', amount: 10n });
      expect(result.version).toBe(1);
      expect(channel.version).toBe(1);
    });

    it('calls transport.proposeState with correct channelId', async () => {
      const transport = makeTransport();
      const { channel } = activeChannel({ transport });
      await channel.send({ type: 'payment' });
      expect(transport.proposeState).toHaveBeenCalledWith(
        CHANNEL_ID,
        expect.objectContaining({ channelId: CHANNEL_ID }),
        expect.any(Number),
      );
    });

    it('persists the co-signed state after success', async () => {
      const { channel, persistence } = activeChannel();
      await channel.send({ type: 'payment', amount: 5n });
      const saved = await persistence.loadLatest(CHANNEL_ID);
      expect(saved?.version).toBe(1);
    });

    it('emits stateUpdate event on success', async () => {
      const { channel } = activeChannel();
      const events: number[] = [];
      channel.on('stateUpdate', (version) => events.push(version));
      await channel.send({ type: 'payment' });
      expect(events).toEqual([1]);
    });

    it('rolls back version on transport timeout', async () => {
      const transport = makeTransport({
        proposeState: vi.fn().mockRejectedValue(new Error('timeout')),
      });
      const { channel } = activeChannel({ transport });
      const versionBefore = channel.version;
      await channel.send({ type: 'payment' }, { timeoutMs: 100 }).catch(() => {});
      expect(channel.version).toBe(versionBefore);
    });

    it('throws CoSignatureTimeoutError when transport indicates timeout', async () => {
      const transport = makeTransport({
        proposeState: vi.fn().mockRejectedValue(new Error('timeout: mock')),
      });
      const { channel } = activeChannel({ transport });
      await expect(channel.send({ type: 'payment' }, { timeoutMs: 100 })).rejects.toThrow(
        CoSignatureTimeoutError,
      );
    });

    it('does NOT emit stateUpdate on timeout', async () => {
      const transport = makeTransport({
        proposeState: vi.fn().mockRejectedValue(new Error('timeout')),
      });
      const { channel } = activeChannel({ transport });
      const events: unknown[] = [];
      channel.on('stateUpdate', () => events.push(1));
      await channel.send({ type: 'payment' }, { timeoutMs: 100 }).catch(() => {});
      expect(events).toHaveLength(0);
    });

    it('emits error event on timeout', async () => {
      const transport = makeTransport({
        proposeState: vi.fn().mockRejectedValue(new Error('timeout')),
      });
      const { channel } = activeChannel({ transport });
      const errors: Error[] = [];
      channel.on('error', (e) => errors.push(e));
      await channel.send({ type: 'payment' }, { timeoutMs: 100 }).catch(() => {});
      expect(errors[0]).toBeInstanceOf(CoSignatureTimeoutError);
    });

    it('sequential sends produce versions 1, 2, 3', async () => {
      const { channel } = activeChannel();
      const v1 = await channel.send({ n: 1 });
      const v2 = await channel.send({ n: 2 });
      const v3 = await channel.send({ n: 3 });
      expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    });

    it('concurrent sends all complete with unique versions', async () => {
      const { channel } = activeChannel();
      const results = await Promise.all([
        channel.send({ n: 1 }),
        channel.send({ n: 2 }),
        channel.send({ n: 3 }),
        channel.send({ n: 4 }),
        channel.send({ n: 5 }),
      ]);
      const versions = results.map(r => r.version);
      expect(new Set(versions).size).toBe(5);
    });

    it('send() with null payload encodes to 0x', async () => {
      const transport = makeTransport();
      const { channel } = activeChannel({ transport });
      await channel.send(null);
      const call = (transport.proposeState as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call as [string, { data: string }])[1].data).toBe('0x');
    });

    it('send() with undefined payload encodes to 0x', async () => {
      const transport = makeTransport();
      const { channel } = activeChannel({ transport });
      await channel.send(undefined);
      const call = (transport.proposeState as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call as [string, { data: string }])[1].data).toBe('0x');
    });

    it('send() with object payload encodes to non-empty hex', async () => {
      const transport = makeTransport();
      const { channel } = activeChannel({ transport });
      await channel.send({ type: 'payment', amount: '100' });
      const call = (transport.proposeState as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call as [string, { data: string }])[1].data).not.toBe('0x');
      expect((call as [string, { data: string }])[1].data.startsWith('0x')).toBe(true);
    });

    it('state does not transition FSM on send', async () => {
      const { channel } = activeChannel();
      await channel.send({ type: 'payment' });
      expect(channel.status).toBe('ACTIVE');
    });

    it('uses default send timeout of 5000ms', async () => {
      const transport = makeTransport();
      const { channel } = activeChannel({ transport });
      await channel.send({ type: 'payment' });
      const call = (transport.proposeState as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call as [string, unknown, number])[2]).toBe(5000);
    });

    it('custom timeoutMs is passed to transport', async () => {
      const transport = makeTransport();
      const { channel } = activeChannel({ transport });
      await channel.send({ type: 'payment' }, { timeoutMs: 1234 });
      const call = (transport.proposeState as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call as [string, unknown, number])[2]).toBe(1234);
    });
  });

  // ─── close() ──────────────────────────────────────────────────────────────

  describe('close()', () => {
    it('throws InvalidTransitionError when not ACTIVE (VOID)', async () => {
      const { channel } = makeChannel();
      await expect(channel.close()).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when FINAL', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('FINAL');
      await expect(channel.close()).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when DISPUTE', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('DISPUTE');
      await expect(channel.close()).rejects.toThrow(InvalidTransitionError);
    });

    it('transitions to FINAL on success', async () => {
      const { channel } = activeChannel();
      await channel.close();
      expect(channel.status).toBe('FINAL');
    });

    it('calls transport.closeChannel', async () => {
      const transport = makeTransport();
      const { channel } = activeChannel({ transport });
      await channel.close();
      expect(transport.closeChannel).toHaveBeenCalledWith(
        CHANNEL_ID,
        expect.objectContaining({ intent: 'CHANFINAL' }),
        expect.any(Number),
      );
    });

    it('persists the final state', async () => {
      const { channel, persistence } = activeChannel();
      await channel.close();
      const saved = await persistence.loadLatest(CHANNEL_ID);
      expect(saved?.intent).toBe('CHANFINAL');
    });

    it('emits statusChange to FINAL', async () => {
      const { channel } = activeChannel();
      const statuses: string[] = [];
      channel.on('statusChange', (to) => statuses.push(to));
      await channel.close();
      expect(statuses).toContain('FINAL');
    });
  });

  // ─── forceClose() ─────────────────────────────────────────────────────────

  describe('forceClose()', () => {
    it('throws InvalidTransitionError when not ACTIVE', async () => {
      const { channel } = makeChannel(); // VOID
      await expect(channel.forceClose()).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when FINAL', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('FINAL');
      await expect(channel.forceClose()).rejects.toThrow(InvalidTransitionError);
    });

    it('throws NoPersistenceError when no state is persisted', async () => {
      const { channel } = activeChannel();
      // No state saved yet
      await expect(channel.forceClose()).rejects.toThrow(NoPersistenceError);
    });

    it('transitions to DISPUTE when state is available', async () => {
      const { channel, persistence } = activeChannel();
      await persistence.save(CHANNEL_ID, {
        channelId: CHANNEL_ID, version: 1, intent: 'APP',
        data: '0x', allocations: [], sigClient: '0xabc', sigClearNode: '0xdef', savedAt: Date.now(),
      });
      await channel.forceClose();
      expect(channel.status).toBe('DISPUTE');
    });

    it('emits challengeDetected event', async () => {
      const { channel, persistence } = activeChannel();
      await persistence.save(CHANNEL_ID, {
        channelId: CHANNEL_ID, version: 1, intent: 'APP',
        data: '0x', allocations: [], sigClient: '0xabc', sigClearNode: '0xdef', savedAt: Date.now(),
      });
      const events: string[] = [];
      channel.on('challengeDetected', (id) => events.push(id));
      await channel.forceClose();
      expect(events).toContain(CHANNEL_ID);
    });

    it('uses custom state override when provided', async () => {
      const { channel, persistence } = activeChannel();
      const customState: SignedState = {
        channelId: CHANNEL_ID, version: 5, intent: 'APP',
        data: '0x', allocations: [], sigClient: '0xabc', sigClearNode: '0xdef', savedAt: Date.now(),
      };
      // No state in persistence — but state is passed directly
      await channel.forceClose({ state: customState });
      expect(channel.status).toBe('DISPUTE');
    });

    it('returns reclaimedAmounts matching channel assets', async () => {
      const { channel, persistence } = activeChannel();
      await persistence.save(CHANNEL_ID, {
        channelId: CHANNEL_ID, version: 1, intent: 'APP',
        data: '0x', allocations: [], sigClient: '0xabc', sigClearNode: '0xdef', savedAt: Date.now(),
      });
      const result = await channel.forceClose();
      expect(result.reclaimedAmounts[0]?.token).toBe(USDC);
      expect(result.reclaimedAmounts[0]?.amount).toBe(100n);
    });
  });

  // ─── checkpoint() ─────────────────────────────────────────────────────────

  describe('checkpoint()', () => {
    it('throws InvalidTransitionError when not ACTIVE (VOID)', async () => {
      const { channel } = makeChannel();
      await expect(channel.checkpoint()).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when FINAL', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('FINAL');
      await expect(channel.checkpoint()).rejects.toThrow(InvalidTransitionError);
    });

    it('throws NoPersistenceError when no state exists', async () => {
      const { channel } = activeChannel();
      await expect(channel.checkpoint()).rejects.toThrow(NoPersistenceError);
    });

    it('returns the correct version number', async () => {
      const { channel, persistence } = activeChannel();
      await persistence.save(CHANNEL_ID, {
        channelId: CHANNEL_ID, version: 7, intent: 'APP',
        data: '0x', allocations: [], sigClient: '0xabc', sigClearNode: '0xdef', savedAt: Date.now(),
      });
      const result = await channel.checkpoint();
      expect(result.version).toBe(7);
    });

    it('does NOT change channel status', async () => {
      const { channel, persistence } = activeChannel();
      await persistence.save(CHANNEL_ID, {
        channelId: CHANNEL_ID, version: 3, intent: 'APP',
        data: '0x', allocations: [], sigClient: '0xabc', sigClearNode: '0xdef', savedAt: Date.now(),
      });
      await channel.checkpoint();
      expect(channel.status).toBe('ACTIVE');
    });
  });

  // ─── withdraw() ───────────────────────────────────────────────────────────

  describe('withdraw()', () => {
    it('throws InvalidTransitionError when not FINAL (ACTIVE)', async () => {
      const { channel } = activeChannel();
      await expect(channel.withdraw()).rejects.toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError when VOID', async () => {
      const { channel } = makeChannel();
      await expect(channel.withdraw()).rejects.toThrow(InvalidTransitionError);
    });

    it('transitions to VOID on success', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('FINAL');
      await channel.withdraw();
      expect(channel.status).toBe('VOID');
    });

    it('returns amounts matching channel assets', async () => {
      const { channel, fsm } = makeChannel();
      fsm._forceSet('FINAL');
      const result = await channel.withdraw();
      expect(result.amounts[0]?.token).toBe(USDC);
      expect(result.amounts[0]?.amount).toBe(100n);
    });
  });

  // ─── getHistory() / getLatestPersistedState() ─────────────────────────────

  describe('getHistory() / getLatestPersistedState()', () => {
    it('getHistory() returns empty array for fresh channel', async () => {
      const { channel } = makeChannel();
      expect(await channel.getHistory()).toEqual([]);
    });

    it('getHistory() returns all persisted states in version order', async () => {
      const { channel, persistence } = activeChannel();
      await persistence.save(CHANNEL_ID, { channelId: CHANNEL_ID, version: 1, intent: 'APP', data: '0x', allocations: [], sigClient: '0x', sigClearNode: '0x', savedAt: 0 });
      await persistence.save(CHANNEL_ID, { channelId: CHANNEL_ID, version: 3, intent: 'APP', data: '0x', allocations: [], sigClient: '0x', sigClearNode: '0x', savedAt: 0 });
      await persistence.save(CHANNEL_ID, { channelId: CHANNEL_ID, version: 2, intent: 'APP', data: '0x', allocations: [], sigClient: '0x', sigClearNode: '0x', savedAt: 0 });
      const history = await channel.getHistory();
      expect(history.map(s => s.version)).toEqual([1, 2, 3]);
    });

    it('getLatestPersistedState() returns null for fresh channel', async () => {
      const { channel } = makeChannel();
      expect(await channel.getLatestPersistedState()).toBeNull();
    });

    it('getLatestPersistedState() returns highest-version state', async () => {
      const { channel, persistence } = activeChannel();
      await persistence.save(CHANNEL_ID, { channelId: CHANNEL_ID, version: 1, intent: 'APP', data: '0x', allocations: [], sigClient: '0x', sigClearNode: '0x', savedAt: 0 });
      await persistence.save(CHANNEL_ID, { channelId: CHANNEL_ID, version: 5, intent: 'APP', data: '0x', allocations: [], sigClient: '0x', sigClearNode: '0x', savedAt: 0 });
      const latest = await channel.getLatestPersistedState();
      expect(latest?.version).toBe(5);
    });

    it('getHistory() reflects states saved by send()', async () => {
      const { channel } = activeChannel();
      await channel.send({ n: 1 });
      await channel.send({ n: 2 });
      const history = await channel.getHistory();
      expect(history).toHaveLength(2);
    });
  });

  // ─── Event API: on() / off() ──────────────────────────────────────────────

  describe('event API', () => {
    it('on() returns an unsubscribe function', () => {
      const { channel } = makeChannel();
      const unsub = channel.on('statusChange', () => {});
      expect(typeof unsub).toBe('function');
    });

    it('unsubscribe stops listener from receiving events', async () => {
      const { channel } = activeChannel();
      const events: unknown[] = [];
      const unsub = channel.on('stateUpdate', () => events.push(1));
      unsub();
      await channel.send({ n: 1 });
      expect(events).toHaveLength(0);
    });

    it('off() removes a specific listener', async () => {
      const { channel } = activeChannel();
      const events: unknown[] = [];
      const listener = () => events.push(1);
      channel.on('stateUpdate', listener);
      channel.off('stateUpdate', listener);
      await channel.send({ n: 1 });
      expect(events).toHaveLength(0);
    });

    it('off() for non-existent listener does not throw', () => {
      const { channel } = makeChannel();
      expect(() => channel.off('statusChange', () => {})).not.toThrow();
    });

    it('multiple listeners on same event all fire', async () => {
      const { channel } = activeChannel();
      const a: unknown[] = [], b: unknown[] = [], c: unknown[] = [];
      channel.on('stateUpdate', () => a.push(1));
      channel.on('stateUpdate', () => b.push(1));
      channel.on('stateUpdate', () => c.push(1));
      await channel.send({ n: 1 });
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(c).toHaveLength(1);
    });

    it('listener error does not crash channel operations', async () => {
      const { channel } = activeChannel();
      channel.on('stateUpdate', () => { throw new Error('listener crash'); });
      await expect(channel.send({ n: 1 })).resolves.toBeDefined();
    });

    it('statusChange fires when FSM transitions', async () => {
      const { channel } = activeChannel();
      const statuses: string[] = [];
      channel.on('statusChange', (to) => statuses.push(to));
      await channel.close();
      expect(statuses).toContain('FINAL');
    });

    it('on(statusChange) listener receives (to, from) values', async () => {
      const { channel } = activeChannel();
      const pairs: Array<[string, string]> = [];
      channel.on('statusChange', (to, from) => pairs.push([to, from]));
      await channel.close();
      expect(pairs).toContainEqual(['FINAL', 'ACTIVE']);
    });

    it('stateUpdate provides version and state', async () => {
      const { channel } = activeChannel();
      const updates: Array<[number, SignedState]> = [];
      channel.on('stateUpdate', (version, state) => updates.push([version, state]));
      await channel.send({ n: 1 });
      expect(updates[0]?.[0]).toBe(1);
      expect(updates[0]?.[1].channelId).toBe(CHANNEL_ID);
    });
  });
});

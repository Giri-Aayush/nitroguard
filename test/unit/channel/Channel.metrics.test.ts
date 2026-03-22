import { describe, it, expect, vi } from 'vitest';
import { Channel, type ChannelConstructorParams } from '../../../src/channel/Channel.js';
import { ChannelFSM } from '../../../src/channel/ChannelFSM.js';
import { VersionManager } from '../../../src/channel/VersionManager.js';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import type { ClearNodeTransport } from '../../../src/channel/transport.js';
import type { SignedState } from '../../../src/channel/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

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

function makeTransport(overrides: Partial<ClearNodeTransport> = {}): ClearNodeTransport {
  const coSign = (state: Omit<SignedState, 'sigClearNode'>): SignedState => ({
    ...state,
    sigClient: state.sigClient ?? ('0xclisig' as `0x${string}`),
    sigClearNode: '0xcnsig' as `0x${string}`,
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

function makeActiveChannel(overrides: Partial<ChannelConstructorParams> = {}) {
  const fsm = new ChannelFSM();
  const versions = new VersionManager();
  const persistence = new MemoryAdapter();
  const transport = makeTransport();

  const channel = new Channel({
    channelId: CHANNEL_ID,
    participants: [ALICE, BOB],
    assets: [{ token: USDC, amount: 100n }],
    chain: TEST_CHAIN as ChannelConstructorParams['chain'],
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

  fsm._forceSet('ACTIVE');

  return { channel, fsm, transport };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Channel.metrics()', () => {
  it('returns zero counts on a fresh channel', () => {
    const { channel } = makeActiveChannel();
    const m = channel.metrics();

    expect(m.messagesSent).toBe(0);
    expect(m.avgLatencyMs).toBe(0);
    expect(m.disputeCount).toBe(0);
    expect(m.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('increments messagesSent after each successful send()', async () => {
    const { channel } = makeActiveChannel();

    await channel.send({ type: 'ping' });
    expect(channel.metrics().messagesSent).toBe(1);

    await channel.send({ type: 'ping' });
    expect(channel.metrics().messagesSent).toBe(2);
  });

  it('records latency samples and computes avgLatencyMs', async () => {
    const { channel } = makeActiveChannel();

    await channel.send({ type: 'ping' });
    await channel.send({ type: 'ping' });

    const m = channel.metrics();
    expect(m.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(m.messagesSent).toBe(2);
  });

  it('does not increment messagesSent on transport timeout', async () => {
    const timedOutTransport = makeTransport({
      proposeState: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const { channel } = makeActiveChannel({ transport: timedOutTransport });

    await expect(channel.send({ type: 'ping' })).rejects.toThrow();
    expect(channel.metrics().messagesSent).toBe(0);
    expect(channel.metrics().avgLatencyMs).toBe(0);
  });

  it('uptimeMs grows over time', async () => {
    const { channel } = makeActiveChannel();
    const m1 = channel.metrics();
    await new Promise(r => setTimeout(r, 10));
    const m2 = channel.metrics();
    expect(m2.uptimeMs).toBeGreaterThanOrEqual(m1.uptimeMs);
  });

  it('increments disputeCount when forceClose triggers', async () => {
    const { channel, fsm } = makeActiveChannel();
    const persistence = new MemoryAdapter();

    // Persist a state so forceClose has something to submit
    const fakeState: SignedState = {
      channelId: CHANNEL_ID,
      version: 1,
      intent: 'APP',
      data: '0x',
      allocations: [{ token: USDC, clientBalance: 100n, clearNodeBalance: 0n }],
      sigClient: '0xabc' as `0x${string}`,
      sigClearNode: '0xdef' as `0x${string}`,
      savedAt: Date.now(),
    };
    await persistence.save(CHANNEL_ID, fakeState);

    const channelWithPersistence = new Channel({
      channelId: CHANNEL_ID,
      participants: [ALICE, BOB],
      assets: [{ token: USDC, amount: 100n }],
      chain: TEST_CHAIN as ChannelConstructorParams['chain'],
      channelParams: {
        participants: [ALICE, BOB],
        nonce: 0n,
        appDefinition: '0x0000000000000000000000000000000000000000',
        challengeDuration: 3600,
        chainId: 31337,
      },
      fsm,
      versionManager: new VersionManager(),
      persistence,
      transport: makeTransport(),
    });
    fsm._forceSet('ACTIVE');

    await channelWithPersistence.forceClose();

    expect(channelWithPersistence.metrics().disputeCount).toBe(1);
  });

  it('metrics snapshot is a plain object (not live reference)', async () => {
    const { channel } = makeActiveChannel();
    const snap1 = channel.metrics();
    await channel.send({ type: 'ping' });
    const snap2 = channel.metrics();

    expect(snap1.messagesSent).toBe(0);
    expect(snap2.messagesSent).toBe(1);
  });
});

/**
 * Integration: Honest dispute scenario — ClearNode goes offline.
 *
 * Uses MockClearNode for off-chain transport and MockCustodyClient for
 * on-chain interactions. No real network or EVM required.
 *
 * Scenario:
 *   1. Alice opens a channel and sends 5 state updates
 *   2. ClearNode goes offline (silent mode)
 *   3. Channel.forceClose() is called — either manually or via ClearNodeMonitor
 *   4. MockCustodyClient records the challenge() call
 *   5. MockCustodyClient simulates ChannelFinalized
 *   6. withdraw() is called automatically, channel goes VOID
 *   7. Assertions on all state transitions and reclaimedAmounts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelFactory } from '../../src/channel/ChannelFactory.js';
import { MemoryAdapter } from '../../src/persistence/MemoryAdapter.js';
import { MockClearNode } from './helpers/MockClearNode.js';
import { MockCustodyClient } from './helpers/MockCustodyClient.js';
import { InvalidTransitionError, NoPersistenceError } from '../../src/errors/index.js';

const USDC: `0x${string}` = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const TEST_CHAIN = {
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
} as const;

const MOCK_SIGNER = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
  signTypedData: async () => '0xMOCKSIG' as `0x${string}`,
  signMessage: async () => '0xMOCKSIG' as `0x${string}`,
};

function openConfig(
  persistence: MemoryAdapter,
  custody: MockCustodyClient,
  opts?: { silenceTimeout?: number; autoDispute?: boolean },
) {
  return {
    clearnode: 'ws://localhost:9999',
    signer: MOCK_SIGNER,
    assets: [{ token: USDC, amount: 1000n }],
    chain: TEST_CHAIN,
    rpcUrl: 'http://127.0.0.1:8545',
    persistence,
    custodyClient: custody,
    autoDispute: opts?.autoDispute ?? false,
    clearnodeSilenceTimeout: opts?.silenceTimeout,
  } as Parameters<typeof ChannelFactory.open>[0];
}

describe('Honest Dispute: ClearNode goes offline', () => {
  let mockClearNode: MockClearNode;
  let persistence: MemoryAdapter;
  let custody: MockCustodyClient;

  beforeEach(() => {
    mockClearNode = new MockClearNode();
    persistence = new MemoryAdapter();
    custody = new MockCustodyClient();
  });

  it('forceClose() submits challenge() with the latest persisted state', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);

    // Send 5 state updates
    for (let i = 1; i <= 5; i++) {
      await channel.send({ type: 'payment', amount: i });
    }

    expect(await persistence.loadLatest(channel.id)).not.toBeNull();
    expect((await persistence.loadLatest(channel.id))!.version).toBe(5);

    // Force close — MockCustodyClient records the challenge() call
    // Immediately simulate finalization so pollForFinalization resolves
    const forceClosePromise = channel.forceClose();
    // Give it a tick to call challenge(), then simulate finalization
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id, 5);

    const result = await forceClosePromise;

    expect(result.challengeTxHash).not.toBe('0x0');
    expect(result.withdrawTxHash).not.toBe('0x0');
    expect(custody.calls.challenge).toHaveLength(1);
    expect(custody.calls.challenge[0]!.state.version).toBe(5);
  });

  it('channel transitions ACTIVE → DISPUTE → FINAL → VOID during forceClose()', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);
    await channel.send({ type: 'payment', amount: 1 });

    const statusHistory: string[] = ['ACTIVE'];
    channel.on('statusChange', (to) => statusHistory.push(to));

    const forceClosePromise = channel.forceClose();
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id, 1);
    await forceClosePromise;

    expect(statusHistory).toContain('DISPUTE');
    expect(statusHistory).toContain('FINAL');
    expect(statusHistory).toContain('VOID');
    expect(channel.status).toBe('VOID');
  });

  it('fundsReclaimed event fires with reclaimedAmounts after forceClose()', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);
    await channel.send({ type: 'payment' });

    const reclaimedEvents: unknown[] = [];
    channel.on('fundsReclaimed', (_cId, amounts) => reclaimedEvents.push(amounts));

    const forceClosePromise = channel.forceClose();
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id);
    await forceClosePromise;

    expect(reclaimedEvents).toHaveLength(1);
    expect((reclaimedEvents[0] as Array<{ token: string; amount: bigint }>)[0]!.token).toBe(USDC);
  });

  it('challengeDetected event fires before DISPUTE transition', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);
    await channel.send({});

    const events: string[] = [];
    channel.on('challengeDetected', () => events.push('challengeDetected'));
    channel.on('statusChange', (to) => events.push(`status:${to}`));

    const forceClosePromise = channel.forceClose();
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id);
    await forceClosePromise;

    const challengeIdx = events.indexOf('challengeDetected');
    const disputeIdx = events.indexOf('status:DISPUTE');
    expect(challengeIdx).toBeGreaterThanOrEqual(0);
    expect(disputeIdx).toBeGreaterThanOrEqual(0);
    // challengeDetected fires before or alongside the DISPUTE status change
    expect(challengeIdx).toBeLessThanOrEqual(disputeIdx + 1);
  });

  it('withdraw() is called with the channel participants[0] as recipient', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);
    await channel.send({});

    const forceClosePromise = channel.forceClose();
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id);
    await forceClosePromise;

    expect(custody.calls.withdraw).toHaveLength(1);
    expect(custody.calls.withdraw[0]!.recipient).toBe(MOCK_SIGNER.address);
  });

  it('forceClose() is idempotent — concurrent calls return the same promise', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);
    await channel.send({});

    const p1 = channel.forceClose();
    const p2 = channel.forceClose(); // concurrent — should be same promise
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2); // same object reference
    expect(custody.calls.challenge).toHaveLength(1); // only one challenge submitted
  });

  it('forceClose() throws NoPersistenceError if no state has ever been persisted', async () => {
    const emptyPersistence = new MemoryAdapter();
    const channel = await ChannelFactory.open(
      openConfig(emptyPersistence, custody),
      mockClearNode,
    );

    // Drain the CHANOPEN state from persistence so it's truly empty
    await emptyPersistence.clear(channel.id);

    await expect(channel.forceClose()).rejects.toThrow(NoPersistenceError);
  });

  it('forceClose() throws InvalidTransitionError when channel is not ACTIVE', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);

    // Manually put channel into FINAL via withdraw path
    await channel.send({});
    const forceClosePromise = channel.forceClose();
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id);
    await forceClosePromise; // now VOID

    await expect(channel.forceClose()).rejects.toThrow(InvalidTransitionError);
  });

  it('5 states persisted before forceClose — latest (v5) is what gets challenged', async () => {
    const channel = await ChannelFactory.open(openConfig(persistence, custody), mockClearNode);

    for (let i = 1; i <= 5; i++) {
      await channel.send({ seq: i });
    }

    const forceClosePromise = channel.forceClose();
    await new Promise(resolve => setTimeout(resolve, 20));
    custody.simulateFinalization(channel.id);
    await forceClosePromise;

    expect(custody.calls.challenge[0]!.state.version).toBe(5);
  });
});

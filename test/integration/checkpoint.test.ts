/**
 * Integration: checkpoint() submits the latest persisted state on-chain.
 *
 * Uses MockCustodyClient — no real EVM required.
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

describe('checkpoint()', () => {
  let mockClearNode: MockClearNode;
  let persistence: MemoryAdapter;
  let custody: MockCustodyClient;

  beforeEach(() => {
    mockClearNode = new MockClearNode();
    persistence = new MemoryAdapter();
    custody = new MockCustodyClient();
  });

  async function openChannel() {
    return ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      custodyClient: custody,
      autoDispute: false,
    }, mockClearNode);
  }

  it('checkpoint() submits the latest persisted state to custody', async () => {
    const channel = await openChannel();
    await channel.send({ seq: 1 });
    await channel.send({ seq: 2 });
    await channel.send({ seq: 3 });

    const result = await channel.checkpoint();

    expect(result.txHash).not.toBe('0x0');
    expect(result.version).toBe(3);
    expect(custody.calls.checkpoint).toHaveLength(1);
    expect(custody.calls.checkpoint[0]!.state.version).toBe(3);
  });

  it('checkpoint() returns the correct version number', async () => {
    const channel = await openChannel();
    for (let i = 1; i <= 7; i++) {
      await channel.send({ seq: i });
    }

    const result = await channel.checkpoint();
    expect(result.version).toBe(7);
  });

  it('checkpoint() does NOT change the channel status (stays ACTIVE)', async () => {
    const channel = await openChannel();
    await channel.send({});

    await channel.checkpoint();
    expect(channel.status).toBe('ACTIVE');
  });

  it('checkpoint() throws NoPersistenceError if no states persisted', async () => {
    const channel = await openChannel();
    // Drain persistence immediately after open
    await persistence.clear(channel.id);

    await expect(channel.checkpoint()).rejects.toThrow(NoPersistenceError);
  });

  it('checkpoint() throws InvalidTransitionError when channel is not ACTIVE', async () => {
    const channel = await openChannel();
    await channel.send({});

    // Move to FINAL
    await channel.close();

    await expect(channel.checkpoint()).rejects.toThrow(InvalidTransitionError);
  });

  it('multiple checkpoints all record the correct version at time of call', async () => {
    const channel = await openChannel();

    for (let i = 1; i <= 5; i++) {
      await channel.send({ seq: i });
    }
    const r1 = await channel.checkpoint(); // at version 5
    expect(r1.version).toBe(5);

    for (let i = 6; i <= 10; i++) {
      await channel.send({ seq: i });
    }
    const r2 = await channel.checkpoint(); // at version 10
    expect(r2.version).toBe(10);

    expect(custody.calls.checkpoint).toHaveLength(2);
    expect(custody.calls.checkpoint[0]!.state.version).toBe(5);
    expect(custody.calls.checkpoint[1]!.state.version).toBe(10);
  });

  it('checkpoint() submits the channelId matching the channel', async () => {
    const channel = await openChannel();
    await channel.send({});

    await channel.checkpoint();

    expect(custody.calls.checkpoint[0]!.channelId).toBe(channel.id);
  });

  it('checkpoint() works without custodyClient (stub — returns 0x0)', async () => {
    // Open without custodyClient
    const noCustodyChannel = await ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      autoDispute: false,
    }, mockClearNode);

    await noCustodyChannel.send({});
    const result = await noCustodyChannel.checkpoint();

    expect(result.txHash).toBe('0x0');
    expect(result.version).toBe(1);
  });
});

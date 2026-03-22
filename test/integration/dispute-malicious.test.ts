/**
 * Integration: Malicious dispute scenario — ClearNode submits a stale challenge.
 *
 * Scenario:
 *   1. Alice opens a channel and sends 10 state updates (versions 1–10)
 *   2. A malicious party submits a challenge at version 3 (stale)
 *   3. DisputeWatcher detects ChallengeRegistered(version: 3)
 *   4. ChallengeManager loads persisted version 10 and calls respond()
 *   5. Challenge is cleared — channel transitions back to ACTIVE
 *   6. send() still works after the successful challenge response
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelFactory } from '../../src/channel/ChannelFactory.js';
import { DisputeWatcher } from '../../src/dispute/DisputeWatcher.js';
import { MemoryAdapter } from '../../src/persistence/MemoryAdapter.js';
import { MockClearNode } from './helpers/MockClearNode.js';
import { MockCustodyClient } from './helpers/MockCustodyClient.js';

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

function flushAsync(rounds = 10): Promise<void> {
  return new Promise(resolve => {
    let remaining = rounds;
    const tick = (): void => {
      if (--remaining <= 0) { resolve(); return; }
      Promise.resolve().then(tick);
    };
    Promise.resolve().then(tick);
  });
}

describe('Malicious Dispute: stale challenge auto-response', () => {
  let mockClearNode: MockClearNode;
  let persistence: MemoryAdapter;
  let custody: MockCustodyClient;

  beforeEach(() => {
    mockClearNode = new MockClearNode();
    persistence = new MemoryAdapter();
    custody = new MockCustodyClient();
  });

  it('DisputeWatcher responds to a stale challenge with the highest persisted version', async () => {
    const channel = await ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      custodyClient: custody,
      autoDispute: true,
    }, mockClearNode);

    // Send 10 state updates
    for (let i = 1; i <= 10; i++) {
      await channel.send({ seq: i });
    }

    expect(channel.version).toBe(10);

    // Malicious party submits challenge at version 3 (stale)
    custody.simulateChallenge(channel.id, 3);
    await flushAsync(20);

    // DisputeWatcher should have responded with version 10
    expect(custody.calls.respond).toHaveLength(1);
    expect(custody.calls.respond[0]!.state.version).toBe(10);
  });

  it('onChallengeResponded callback fires with channelId and txHash', async () => {
    const respondedEvents: Array<{ channelId: string; txHash: string }> = [];

    const channel = await ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      custodyClient: custody,
      autoDispute: true,
      onChallengeResponded: (cId, txHash) => {
        respondedEvents.push({ channelId: cId, txHash });
      },
    }, mockClearNode);

    for (let i = 1; i <= 5; i++) {
      await channel.send({});
    }

    custody.simulateChallenge(channel.id, 2);
    await flushAsync(20);

    expect(respondedEvents).toHaveLength(1);
    expect(respondedEvents[0]!.channelId).toBe(channel.id);
    expect(respondedEvents[0]!.txHash).toMatch(/^0x/);
  });

  it('channel transitions to ACTIVE after challenge is successfully responded to', async () => {
    const channel = await ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      custodyClient: custody,
      autoDispute: true,
    }, mockClearNode);

    for (let i = 1; i <= 5; i++) {
      await channel.send({});
    }

    // Before challenge — ACTIVE
    expect(channel.status).toBe('ACTIVE');

    // The DisputeWatcher's automatic respond() sets custody status back to ACTIVE
    // and Channel._onChallengeCleared() transitions FSM DISPUTE → ACTIVE
    custody.simulateChallenge(channel.id, 2);
    await flushAsync(20);

    expect(channel.status).toBe('ACTIVE');
  });

  it('send() works after a successful challenge response', async () => {
    const channel = await ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      custodyClient: custody,
      autoDispute: true,
    }, mockClearNode);

    for (let i = 1; i <= 5; i++) {
      await channel.send({ seq: i });
    }

    custody.simulateChallenge(channel.id, 2);
    await flushAsync(20);

    // Channel should be back to ACTIVE — send() should work
    const result = await channel.send({ seq: 6 });
    expect(result.version).toBe(6);
  });

  it('challenge_lost is emitted when ourVersion ≤ challengeVersion', async () => {
    const channel = await ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      custodyClient: custody,
      autoDispute: true,
    }, mockClearNode);

    await channel.send({});  // version 1

    // Create a separate DisputeWatcher to listen for 'challenge_lost'
    const watcher = new DisputeWatcher({ custodyClient: custody, persistence });
    const latestState = await persistence.loadLatest(channel.id);
    watcher.watch(channel.id, latestState!);

    const lostEvents: string[] = [];
    watcher.on('challenge_lost', (cId: unknown) => lostEvents.push(cId as string));

    await watcher.start();

    // Challenger submits version 5 (higher than our version 1 — we lose)
    custody.simulateChallenge(channel.id, 5);
    await flushAsync(20);

    await watcher.stop();

    expect(lostEvents).toHaveLength(1);
    expect(custody.calls.respond).toHaveLength(0); // we did NOT respond
  });

  it('respond() is called with the channel ID matching the challenge', async () => {
    const channel = await ChannelFactory.open({
      clearnode: 'ws://localhost:9999',
      signer: MOCK_SIGNER,
      assets: [{ token: USDC, amount: 1000n }],
      chain: TEST_CHAIN,
      rpcUrl: 'http://127.0.0.1:8545',
      persistence,
      custodyClient: custody,
      autoDispute: true,
    }, mockClearNode);

    for (let i = 1; i <= 3; i++) {
      await channel.send({});
    }

    custody.simulateChallenge(channel.id, 1);
    await flushAsync(20);

    expect(custody.calls.respond[0]!.channelId).toBe(channel.id);
  });
});

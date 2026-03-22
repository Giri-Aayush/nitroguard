import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NitroGuard } from '../../src/index.js';
import { MemoryAdapter } from '../../src/persistence/MemoryAdapter.js';
import { MockClearNode } from './helpers/MockClearNode.js';
import { createTestWallets, USDC_ADDRESS } from './helpers/TestWallets.js';
import type { Channel } from '../../src/channel/Channel.js';

// ─── Minimal viem chain for tests ─────────────────────────────────────────────
const testChain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] }, public: { http: ['http://127.0.0.1:8545'] } },
};

const CLEARNODE_URL = 'ws://localhost:9999';
const RPC_URL = 'http://127.0.0.1:8545';

describe('Channel Lifecycle Integration', () => {
  let mockClearNode: MockClearNode;
  let channel: Channel;
  let persistence: MemoryAdapter;

  beforeEach(() => {
    mockClearNode = new MockClearNode();
    persistence = new MemoryAdapter();
  });

  afterEach(async () => {
    await mockClearNode.disconnect();
  });

  describe('Test 1: Basic open → send → close', () => {
    it('NitroGuard.open() completes without error', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );
      expect(channel).toBeDefined();
    });

    it('channel.status === ACTIVE after open()', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );
      expect(channel.status).toBe('ACTIVE');
    });

    it('channel.version === 0 after open()', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );
      expect(channel.version).toBe(0);
    });

    it('channel.send() succeeds and increments version', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      const result = await channel.send({ type: 'payment', amount: 10n });
      expect(result.version).toBe(1);
      expect(channel.version).toBe(1);
    });

    it('channel.close() transitions to FINAL', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      await channel.send({ type: 'payment', amount: 10n });
      await channel.close();
      expect(channel.status).toBe('FINAL');
    });
  });

  describe('Test 2: Sequential sends — version integrity', () => {
    it('10 sequential sends all return unique versions 1..10', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      const versions: number[] = [];
      for (let i = 0; i < 10; i++) {
        const result = await channel.send({ type: 'payment', amount: BigInt(i) });
        versions.push(result.version);
      }

      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('MemoryAdapter has 11 persisted states after open + 10 sends (including CHANOPEN)', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      for (let i = 0; i < 10; i++) {
        await channel.send({ type: 'payment', amount: BigInt(i) });
      }

      // 1 CHANOPEN + 10 APP states
      expect(persistence.totalStates).toBe(11);
    });

    it('all states have correct channelId', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      for (let i = 0; i < 5; i++) {
        await channel.send({ type: 'payment', amount: BigInt(i) });
      }

      const history = await channel.getHistory();
      expect(history.every(s => s.channelId === channel.id)).toBe(true);
    });
  });

  describe('Test 3: Concurrent send handling', () => {
    it('5 concurrent send() calls all complete with unique versions', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      // Fire 5 sends concurrently
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => channel.send({ type: 'payment', amount: BigInt(i) })),
      );

      const versions = results.map(r => r.version);
      const uniqueVersions = new Set(versions);
      expect(uniqueVersions.size).toBe(5);
    });
  });

  describe('Test 4: Channel metadata', () => {
    it('channel.participants[0] === alice.address', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );
      expect(channel.participants[0].toLowerCase()).toBe(alice!.address.toLowerCase());
    });

    it('channel.participants[1] === clearnode.address', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );
      expect(channel.participants[1].toLowerCase()).toBe(
        mockClearNode.clearNodeAddress.toLowerCase(),
      );
    });

    it('channel.assets reflects initial deposit amounts', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      const depositAmount = 500n;
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: depositAmount }],
          persistence,
        },
        mockClearNode,
      );
      expect(channel.assets[0]?.amount).toBe(depositAmount);
      expect(channel.assets[0]?.token).toBe(USDC_ADDRESS);
    });
  });

  describe('forceClose protection', () => {
    it('forceClose() transitions to DISPUTE when state is persisted', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      await channel.send({ type: 'payment', amount: 10n });
      await channel.forceClose();
      expect(channel.status).toBe('DISPUTE');
    });

    it('forceClose() on channel with no persisted APP states still works (CHANOPEN is enough)', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      // CHANOPEN state was persisted by open(), so forceClose should succeed
      await expect(channel.forceClose()).resolves.toBeDefined();
    });
  });

  describe('Status change callbacks', () => {
    it('onStatusChange fires with INITIAL and ACTIVE during open()', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      const statuses: string[] = [];

      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
          onStatusChange: (status) => statuses.push(status),
        },
        mockClearNode,
      );

      expect(statuses).toContain('INITIAL');
      expect(statuses).toContain('ACTIVE');
    });

    it('on(statusChange) listener fires when status changes', async () => {
      const [alice] = createTestWallets(RPC_URL, 1);
      channel = await NitroGuard.open(
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
          rpcUrl: RPC_URL,
          assets: [{ token: USDC_ADDRESS, amount: 100n }],
          persistence,
        },
        mockClearNode,
      );

      const statuses: string[] = [];
      channel.on('statusChange', (to) => statuses.push(to));
      await channel.send({ type: 'payment', amount: 10n });
      await channel.close();

      expect(statuses).toContain('FINAL');
    });
  });
});

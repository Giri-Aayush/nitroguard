import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NitroGuard } from '../../src/index.js';
import { MemoryAdapter } from '../../src/persistence/MemoryAdapter.js';
import { MockClearNode } from './helpers/MockClearNode.js';
import { createTestWallets, USDC_ADDRESS } from './helpers/TestWallets.js';
import { CoSignatureTimeoutError, InvalidTransitionError } from '../../src/errors/index.js';
import type { Channel } from '../../src/channel/Channel.js';

const testChain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] }, public: { http: ['http://127.0.0.1:8545'] } },
};

const CLEARNODE_URL = 'ws://localhost:9999';
const RPC_URL = 'http://127.0.0.1:8545';

async function openChannel(
  clearNode: MockClearNode,
  persistence: MemoryAdapter,
): Promise<Channel> {
  const [alice] = createTestWallets(RPC_URL, 1);
  return NitroGuard.open(
    {
      clearnode: CLEARNODE_URL,
      signer: alice!.signer,
      chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
      rpcUrl: RPC_URL,
      assets: [{ token: USDC_ADDRESS, amount: 100n }],
      persistence,
    },
    clearNode,
  );
}

describe('Reconnect / Silent ClearNode', () => {
  let mockClearNode: MockClearNode;
  let persistence: MemoryAdapter;

  beforeEach(() => {
    mockClearNode = new MockClearNode();
    persistence = new MemoryAdapter();
  });

  afterEach(async () => {
    mockClearNode.goOnline();
    await mockClearNode.disconnect();
  });

  describe('Test 1: ClearNode timeout on send', () => {
    it('send() throws CoSignatureTimeoutError when ClearNode goes silent', async () => {
      const channel = await openChannel(mockClearNode, persistence);

      // Switch to silent mode after opening
      mockClearNode.setMode('silent');

      await expect(
        channel.send({ type: 'payment', amount: 10n }, { timeoutMs: 200 }),
      ).rejects.toThrow(CoSignatureTimeoutError);
    });

    it('version is rolled back after send timeout', async () => {
      const channel = await openChannel(mockClearNode, persistence);

      mockClearNode.setMode('silent');

      const versionBefore = channel.version;
      await channel.send({ type: 'payment', amount: 10n }, { timeoutMs: 200 }).catch(() => {});

      // Version should be rolled back to before the failed send
      expect(channel.version).toBe(versionBefore);
    });

    it('send() works again after ClearNode comes back online', async () => {
      const channel = await openChannel(mockClearNode, persistence);

      // Go silent and fail one send
      mockClearNode.setMode('silent');
      await channel.send({ type: 'payment', amount: 10n }, { timeoutMs: 200 }).catch(() => {});

      // Come back online
      mockClearNode.goOnline();

      // Should work now
      const result = await channel.send({ type: 'payment', amount: 5n });
      expect(result.version).toBe(1);
    });
  });

  describe('Test 2: restore() from persistence', () => {
    it('NitroGuard.restore() returns channel with status ACTIVE', async () => {
      const channel = await openChannel(mockClearNode, persistence);
      await channel.send({ type: 'payment', amount: 10n });

      const [alice] = createTestWallets(RPC_URL, 1);
      const restored = await NitroGuard.restore(
        channel.id,
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.restore>[1]['chain'],
          rpcUrl: RPC_URL,
          persistence,
        },
        mockClearNode,
      );

      expect(restored.status).toBe('ACTIVE');
    });

    it('restored channel.version matches latest persisted state version', async () => {
      const channel = await openChannel(mockClearNode, persistence);

      // Send 5 state updates
      for (let i = 0; i < 5; i++) {
        await channel.send({ type: 'payment', amount: BigInt(i) });
      }

      const [alice] = createTestWallets(RPC_URL, 1);
      const restored = await NitroGuard.restore(
        channel.id,
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.restore>[1]['chain'],
          rpcUrl: RPC_URL,
          persistence,
        },
        mockClearNode,
      );

      expect(restored.version).toBe(5);
    });

    it('send() works immediately after restore', async () => {
      const channel = await openChannel(mockClearNode, persistence);
      await channel.send({ type: 'payment', amount: 10n });

      const [alice] = createTestWallets(RPC_URL, 1);
      const restored = await NitroGuard.restore(
        channel.id,
        {
          clearnode: CLEARNODE_URL,
          signer: alice!.signer,
          chain: testChain as Parameters<typeof NitroGuard.restore>[1]['chain'],
          rpcUrl: RPC_URL,
          persistence,
        },
        mockClearNode,
      );

      const result = await restored.send({ type: 'payment', amount: 5n });
      expect(result.version).toBe(2);
    });

    it('throws ChannelNotFoundError when channelId has no persisted states', async () => {
      const { ChannelNotFoundError } = await import('../../src/errors/index.js');
      const [alice] = createTestWallets(RPC_URL, 1);

      await expect(
        NitroGuard.restore(
          '0xnonexistent',
          {
            clearnode: CLEARNODE_URL,
            signer: alice!.signer,
            chain: testChain as Parameters<typeof NitroGuard.restore>[1]['chain'],
            rpcUrl: RPC_URL,
            persistence,
          },
          mockClearNode,
        ),
      ).rejects.toThrow(ChannelNotFoundError);
    });
  });

  describe('Test 3: Invalid operations on wrong state', () => {
    it('send() on a FINAL channel throws InvalidTransitionError', async () => {
      const channel = await openChannel(mockClearNode, persistence);
      await channel.close();

      await expect(
        channel.send({ type: 'payment', amount: 10n }),
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('close() on a VOID channel throws InvalidTransitionError', async () => {
      // Manually get a new channel in VOID state (not opened)
      const { ChannelFSM } = await import('../../src/channel/ChannelFSM.js');
      const { VersionManager } = await import('../../src/channel/VersionManager.js');
      const { Channel } = await import('../../src/channel/Channel.js');

      const [alice] = createTestWallets(RPC_URL, 1);
      const fsm = new ChannelFSM();
      const versionManager = new VersionManager();

      const channel = new Channel({
        channelId: '0xtest',
        participants: [alice!.address, '0x0000000000000000000000000000000000000001'],
        assets: [{ token: USDC_ADDRESS, amount: 100n }],
        chain: testChain as Parameters<typeof NitroGuard.open>[0]['chain'],
        channelParams: {
          participants: [alice!.address, '0x0000000000000000000000000000000000000001'],
          nonce: 0n,
          appDefinition: '0x0000000000000000000000000000000000000000',
          challengeDuration: 3600,
          chainId: 31337,
        },
        fsm,
        versionManager,
        persistence,
        transport: mockClearNode,
      });

      await expect(channel.close()).rejects.toThrow(InvalidTransitionError);
    });

    it('forceClose() on FINAL channel throws InvalidTransitionError', async () => {
      const channel = await openChannel(mockClearNode, persistence);
      await channel.send({ type: 'payment', amount: 5n });
      await channel.close();

      await expect(channel.forceClose()).rejects.toThrow(InvalidTransitionError);
    });
  });

  describe('Test 4: State event subscriptions', () => {
    it('stateUpdate event fires after each successful send', async () => {
      const channel = await openChannel(mockClearNode, persistence);
      const updates: number[] = [];
      channel.on('stateUpdate', (version) => updates.push(version));

      await channel.send({ type: 'payment', amount: 1n });
      await channel.send({ type: 'payment', amount: 2n });
      await channel.send({ type: 'payment', amount: 3n });

      expect(updates).toEqual([1, 2, 3]);
    });

    it('stateUpdate event is NOT fired after a failed (timeout) send', async () => {
      const channel = await openChannel(mockClearNode, persistence);
      const updates: number[] = [];
      channel.on('stateUpdate', (version) => updates.push(version));

      mockClearNode.setMode('silent');
      await channel.send({ type: 'payment', amount: 1n }, { timeoutMs: 100 }).catch(() => {});

      expect(updates).toHaveLength(0);
    });
  });
});

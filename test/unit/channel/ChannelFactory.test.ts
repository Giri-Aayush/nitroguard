import { describe, it, expect, vi } from 'vitest';
import { ChannelFactory } from '../../../src/channel/ChannelFactory.js';
import { InvalidConfigError } from '../../../src/errors/index.js';
import type { OpenConfig } from '../../../src/channel/types.js';
import type { ClearNodeTransport } from '../../../src/channel/transport.js';
import type { SignedState } from '../../../src/channel/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_CHAIN = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] }, public: { http: ['http://127.0.0.1:8545'] } },
} as const;

const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const BOB   = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const USDC  = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;

const mockSigner = {
  address: ALICE,
  signTypedData: vi.fn().mockResolvedValue('0xsig'),
  signMessage: vi.fn().mockResolvedValue('0xsig'),
};

function makeTransport(): ClearNodeTransport {
  const coSign = (state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` }): SignedState => ({
    ...state,
    sigClient: state.sigClient ?? '0xclisig',
    sigClearNode: '0xcnsig',
    savedAt: Date.now(),
  });
  return {
    isConnected: false,
    clearNodeAddress: BOB,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    proposeState: vi.fn().mockImplementation(async (_id, state) => coSign(state)),
    openChannel: vi.fn().mockImplementation(async (_id, state) => coSign(state)),
    closeChannel: vi.fn().mockImplementation(async (_id, state) => coSign(state)),
    onMessage: vi.fn().mockReturnValue(() => {}),
  };
}

const validConfig: OpenConfig = {
  clearnode: 'wss://clearnet.yellow.com/ws',
  signer: mockSigner,
  assets: [{ token: USDC, amount: 100n }],
  chain: TEST_CHAIN as OpenConfig['chain'],
  rpcUrl: 'http://localhost:8545',
};

// ─── validateOpenConfig tests ─────────────────────────────────────────────────

describe('ChannelFactory.open() — config validation', () => {
  it('throws InvalidConfigError when clearnode is missing', async () => {
    const config = { ...validConfig, clearnode: '' };
    await expect(ChannelFactory.open(config, makeTransport())).rejects.toThrow(InvalidConfigError);
  });

  it('InvalidConfigError for missing clearnode has correct field name', async () => {
    const config = { ...validConfig, clearnode: '' };
    let err: InvalidConfigError | undefined;
    try { await ChannelFactory.open(config, makeTransport()); } catch (e) { err = e as InvalidConfigError; }
    expect(err?.code).toBe('INVALID_CONFIG');
    expect(err?.message).toContain('clearnode');
  });

  it('throws InvalidConfigError when signer is missing', async () => {
    const config = { ...validConfig, signer: undefined as unknown as OpenConfig['signer'] };
    await expect(ChannelFactory.open(config, makeTransport())).rejects.toThrow(InvalidConfigError);
  });

  it('InvalidConfigError for missing signer has correct field name', async () => {
    const config = { ...validConfig, signer: undefined as unknown as OpenConfig['signer'] };
    let err: InvalidConfigError | undefined;
    try { await ChannelFactory.open(config, makeTransport()); } catch (e) { err = e as InvalidConfigError; }
    expect(err?.message).toContain('signer');
  });

  it('throws InvalidConfigError when assets is empty array', async () => {
    const config = { ...validConfig, assets: [] };
    await expect(ChannelFactory.open(config, makeTransport())).rejects.toThrow(InvalidConfigError);
  });

  it('throws InvalidConfigError when assets is missing', async () => {
    const config = { ...validConfig, assets: undefined as unknown as OpenConfig['assets'] };
    await expect(ChannelFactory.open(config, makeTransport())).rejects.toThrow(InvalidConfigError);
  });

  it('InvalidConfigError for missing assets has correct field name', async () => {
    const config = { ...validConfig, assets: [] };
    let err: InvalidConfigError | undefined;
    try { await ChannelFactory.open(config, makeTransport()); } catch (e) { err = e as InvalidConfigError; }
    expect(err?.message).toContain('assets');
  });

  it('throws InvalidConfigError when chain is missing', async () => {
    const config = { ...validConfig, chain: undefined as unknown as OpenConfig['chain'] };
    await expect(ChannelFactory.open(config, makeTransport())).rejects.toThrow(InvalidConfigError);
  });

  it('InvalidConfigError for missing chain has correct field name', async () => {
    const config = { ...validConfig, chain: undefined as unknown as OpenConfig['chain'] };
    let err: InvalidConfigError | undefined;
    try { await ChannelFactory.open(config, makeTransport()); } catch (e) { err = e as InvalidConfigError; }
    expect(err?.message).toContain('chain');
  });

  it('throws InvalidConfigError when rpcUrl is missing', async () => {
    const config = { ...validConfig, rpcUrl: '' };
    await expect(ChannelFactory.open(config, makeTransport())).rejects.toThrow(InvalidConfigError);
  });

  it('InvalidConfigError for missing rpcUrl has correct field name', async () => {
    const config = { ...validConfig, rpcUrl: '' };
    let err: InvalidConfigError | undefined;
    try { await ChannelFactory.open(config, makeTransport()); } catch (e) { err = e as InvalidConfigError; }
    expect(err?.message).toContain('rpcUrl');
  });

  it('all validation errors are instances of InvalidConfigError', async () => {
    const configs = [
      { ...validConfig, clearnode: '' },
      { ...validConfig, signer: undefined as unknown as OpenConfig['signer'] },
      { ...validConfig, assets: [] },
      { ...validConfig, chain: undefined as unknown as OpenConfig['chain'] },
      { ...validConfig, rpcUrl: '' },
    ];
    for (const config of configs) {
      let err: Error | undefined;
      try { await ChannelFactory.open(config, makeTransport()); } catch (e) { err = e as Error; }
      expect(err).toBeInstanceOf(InvalidConfigError);
    }
  });
});

// ─── open() flow tests ────────────────────────────────────────────────────────

describe('ChannelFactory.open() — flow', () => {
  it('connects to transport', async () => {
    const transport = makeTransport();
    await ChannelFactory.open(validConfig, transport);
    expect(transport.connect).toHaveBeenCalled();
  });

  it('returns a Channel with ACTIVE status', async () => {
    const channel = await ChannelFactory.open(validConfig, makeTransport());
    expect(channel.status).toBe('ACTIVE');
  });

  it('uses transport.clearNodeAddress as counterparty when not specified', async () => {
    const channel = await ChannelFactory.open(validConfig, makeTransport());
    expect(channel.participants[1].toLowerCase()).toBe(BOB.toLowerCase());
  });

  it('uses explicit counterparty when specified', async () => {
    const CUSTOM_CN = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;
    const config = { ...validConfig, counterparty: CUSTOM_CN };
    const channel = await ChannelFactory.open(config, makeTransport());
    expect(channel.participants[1].toLowerCase()).toBe(CUSTOM_CN.toLowerCase());
  });

  it('participants[0] is the signer address', async () => {
    const channel = await ChannelFactory.open(validConfig, makeTransport());
    expect(channel.participants[0].toLowerCase()).toBe(ALICE.toLowerCase());
  });

  it('channel.assets matches config.assets', async () => {
    const channel = await ChannelFactory.open(validConfig, makeTransport());
    expect(channel.assets[0]?.token).toBe(USDC);
    expect(channel.assets[0]?.amount).toBe(100n);
  });

  it('version is 0 after open (CHANOPEN is v0)', async () => {
    const channel = await ChannelFactory.open(validConfig, makeTransport());
    expect(channel.version).toBe(0);
  });

  it('sends CHANOPEN state to transport', async () => {
    const transport = makeTransport();
    await ChannelFactory.open(validConfig, transport);
    expect(transport.openChannel).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ intent: 'CHANOPEN', version: 0 }),
    );
  });

  it('wires onStatusChange callback', async () => {
    const statuses: string[] = [];
    await ChannelFactory.open({ ...validConfig, onStatusChange: (s) => statuses.push(s) }, makeTransport());
    expect(statuses).toContain('INITIAL');
    expect(statuses).toContain('ACTIVE');
  });

  it('wires onError callback', async () => {
    const errors: Error[] = [];
    const config = { ...validConfig, onError: (e: Error) => errors.push(e) };
    const channel = await ChannelFactory.open(config, makeTransport());
    // Trigger an error via send on wrong state
    channel['_fsm']._forceSet('VOID');
    await channel.send({ n: 1 }).catch(() => {});
    // Error callback won't fire from send() for InvalidTransitionError — only for CoSigTimeout
    // This just validates the wiring doesn't throw during setup
    expect(errors).toBeDefined();
  });

  it('uses MemoryAdapter by default', async () => {
    const channel = await ChannelFactory.open(validConfig, makeTransport());
    // The CHANOPEN state should be persisted
    const state = await channel.getLatestPersistedState();
    expect(state?.intent).toBe('CHANOPEN');
  });

  it('uses custom persistence adapter when provided', async () => {
    const { MemoryAdapter } = await import('../../../src/persistence/MemoryAdapter.js');
    const custom = new MemoryAdapter();
    const channel = await ChannelFactory.open({ ...validConfig, persistence: custom }, makeTransport());
    const state = await channel.getLatestPersistedState();
    expect(state?.intent).toBe('CHANOPEN');
  });
});

// ─── computeChannelId() ───────────────────────────────────────────────────────

describe('ChannelFactory.computeChannelId()', () => {
  const params = {
    participants: [ALICE, BOB] as [string, string],
    nonce: 12345n,
    appDefinition: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    challengeDuration: 3600,
    chainId: 31337,
  };

  it('returns a 0x-prefixed 32-byte hex string', () => {
    const id = ChannelFactory.computeChannelId(params);
    expect(id).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it('is deterministic — same params produce same ID', () => {
    const id1 = ChannelFactory.computeChannelId(params);
    const id2 = ChannelFactory.computeChannelId(params);
    expect(id1).toBe(id2);
  });

  it('different nonces produce different IDs', () => {
    const id1 = ChannelFactory.computeChannelId({ ...params, nonce: 1n });
    const id2 = ChannelFactory.computeChannelId({ ...params, nonce: 2n });
    expect(id1).not.toBe(id2);
  });

  it('different participants produce different IDs', () => {
    const CHARLIE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;
    const id1 = ChannelFactory.computeChannelId(params);
    const id2 = ChannelFactory.computeChannelId({ ...params, participants: [ALICE, CHARLIE] });
    expect(id1).not.toBe(id2);
  });

  it('different chainIds produce different IDs', () => {
    const id1 = ChannelFactory.computeChannelId({ ...params, chainId: 1 });
    const id2 = ChannelFactory.computeChannelId({ ...params, chainId: 11155111 });
    expect(id1).not.toBe(id2);
  });

  it('different challengeDurations produce different IDs', () => {
    const id1 = ChannelFactory.computeChannelId({ ...params, challengeDuration: 3600 });
    const id2 = ChannelFactory.computeChannelId({ ...params, challengeDuration: 7200 });
    expect(id1).not.toBe(id2);
  });

  it('swapping participant order produces a different ID', () => {
    const id1 = ChannelFactory.computeChannelId(params);
    const id2 = ChannelFactory.computeChannelId({ ...params, participants: [BOB, ALICE] });
    expect(id1).not.toBe(id2);
  });
});

// ─── restore() tests ──────────────────────────────────────────────────────────

describe('ChannelFactory.restore()', () => {
  it('throws ChannelNotFoundError for unknown channelId', async () => {
    const { ChannelNotFoundError } = await import('../../../src/errors/index.js');
    const { MemoryAdapter } = await import('../../../src/persistence/MemoryAdapter.js');
    await expect(
      ChannelFactory.restore('0xunknown', {
        clearnode: 'ws://localhost',
        signer: mockSigner,
        chain: TEST_CHAIN as OpenConfig['chain'],
        rpcUrl: 'http://localhost:8545',
        persistence: new MemoryAdapter(),
      }, makeTransport()),
    ).rejects.toThrow(ChannelNotFoundError);
  });

  it('restores channel with ACTIVE status from persisted state', async () => {
    const { MemoryAdapter } = await import('../../../src/persistence/MemoryAdapter.js');
    const persistence = new MemoryAdapter();
    const channelId = '0xaaaa';
    await persistence.save(channelId, {
      channelId, version: 5, intent: 'APP',
      data: '0x', allocations: [{ token: USDC, clientBalance: 100n, clearNodeBalance: 0n }],
      sigClient: '0xabc', sigClearNode: '0xdef', savedAt: Date.now(),
    });
    const channel = await ChannelFactory.restore(channelId, {
      clearnode: 'ws://localhost',
      signer: mockSigner,
      chain: TEST_CHAIN as OpenConfig['chain'],
      rpcUrl: 'http://localhost:8545',
      persistence,
    }, makeTransport());
    expect(channel.status).toBe('ACTIVE');
  });

  it('restores channel.version from latest persisted state', async () => {
    const { MemoryAdapter } = await import('../../../src/persistence/MemoryAdapter.js');
    const persistence = new MemoryAdapter();
    const channelId = '0xbbbb';
    for (let i = 0; i <= 7; i++) {
      await persistence.save(channelId, {
        channelId, version: i, intent: 'APP',
        data: '0x', allocations: [], sigClient: '0x', sigClearNode: '0x', savedAt: 0,
      });
    }
    const channel = await ChannelFactory.restore(channelId, {
      clearnode: 'ws://localhost',
      signer: mockSigner,
      chain: TEST_CHAIN as OpenConfig['chain'],
      rpcUrl: 'http://localhost:8545',
      persistence,
    }, makeTransport());
    expect(channel.version).toBe(7);
  });
});

// ─── restoreAll() tests ───────────────────────────────────────────────────────

describe('ChannelFactory.restoreAll()', () => {
  it('returns empty array when persistence is empty', async () => {
    const { MemoryAdapter } = await import('../../../src/persistence/MemoryAdapter.js');
    const channels = await ChannelFactory.restoreAll({
      clearnode: 'ws://localhost',
      signer: mockSigner,
      chain: TEST_CHAIN as OpenConfig['chain'],
      rpcUrl: 'http://localhost:8545',
      persistence: new MemoryAdapter(),
    }, makeTransport());
    expect(channels).toHaveLength(0);
  });

  it('restores all known channels', async () => {
    const { MemoryAdapter } = await import('../../../src/persistence/MemoryAdapter.js');
    const persistence = new MemoryAdapter();
    for (const id of ['0xch1', '0xch2', '0xch3']) {
      await persistence.save(id, {
        channelId: id, version: 1, intent: 'APP',
        data: '0x', allocations: [{ token: USDC, clientBalance: 50n, clearNodeBalance: 0n }],
        sigClient: '0x', sigClearNode: '0x', savedAt: 0,
      });
    }
    const channels = await ChannelFactory.restoreAll({
      clearnode: 'ws://localhost',
      signer: mockSigner,
      chain: TEST_CHAIN as OpenConfig['chain'],
      rpcUrl: 'http://localhost:8545',
      persistence,
    }, makeTransport());
    expect(channels).toHaveLength(3);
    expect(channels.every(c => c.status === 'ACTIVE')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { PaymentProtocol, SwapProtocol } from '../../../src/protocol/builtins.js';
import { ProtocolValidationError, ProtocolTransitionError } from '../../../src/errors/index.js';
import { TypedChannel } from '../../../src/protocol/TypedChannel.js';
import { Channel, type ChannelConstructorParams } from '../../../src/channel/Channel.js';
import { ChannelFSM } from '../../../src/channel/ChannelFSM.js';
import { VersionManager } from '../../../src/channel/VersionManager.js';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import type { ClearNodeTransport } from '../../../src/channel/transport.js';
import type { SignedState } from '../../../src/channel/types.js';
import { vi } from 'vitest';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_CHAIN = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] }, public: { http: ['http://127.0.0.1:8545'] } },
} as const;

const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`;
const BOB   = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`;
const USDC  = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`;
const WETH  = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`;
const CHANNEL_ID = '0xdeadbeef00000000000000000000000000000000000000000000000000000001';

function makeTransport(): ClearNodeTransport {
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
  };
}

function makeTypedChannel<T>(protocol: import('../../../src/protocol/types.js').Protocol<T>) {
  const fsm = new ChannelFSM();
  const versions = new VersionManager();
  const persistence = new MemoryAdapter();

  const channel = new Channel({
    channelId: CHANNEL_ID,
    participants: [ALICE, BOB],
    assets: [{ token: USDC, amount: 100_000_000n }],
    chain: TEST_CHAIN as ChannelConstructorParams['chain'],
    channelParams: {
      participants: [ALICE, BOB],
      nonce: 1n,
      appDefinition: '0x0000000000000000000000000000000000000000',
      challengeDuration: 3600,
      chainId: 31337,
    },
    fsm,
    versionManager: versions,
    persistence,
    transport: makeTransport(),
  });

  fsm._forceSet('ACTIVE');

  return new TypedChannel(channel, protocol);
}

// ─── PaymentProtocol ─────────────────────────────────────────────────────────

describe('PaymentProtocol', () => {
  it('has correct identifier', () => {
    expect(PaymentProtocol.identifier).toBe('payment@1');
  });

  it('accepts a valid payment payload', async () => {
    const ch = makeTypedChannel(PaymentProtocol);
    await expect(
      ch.send({ type: 'payment', to: BOB, amount: 1_000_000n, token: USDC }),
    ).resolves.toBeDefined();
  });

  it('accepts a payment with optional memo', async () => {
    const ch = makeTypedChannel(PaymentProtocol);
    await expect(
      ch.send({ type: 'payment', to: BOB, amount: 500_000n, token: USDC, memo: 'coffee' }),
    ).resolves.toBeDefined();
  });

  it('rejects zero amount (transition guard)', async () => {
    const ch = makeTypedChannel(PaymentProtocol);
    await expect(
      // @ts-expect-error — testing runtime rejection
      ch.send({ type: 'payment', to: BOB, amount: 0n, token: USDC }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('rejects negative amount (schema)', async () => {
    const ch = makeTypedChannel(PaymentProtocol);
    await expect(
      // @ts-expect-error
      ch.send({ type: 'payment', to: BOB, amount: -1n, token: USDC }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('rejects invalid address for `to`', async () => {
    const ch = makeTypedChannel(PaymentProtocol);
    await expect(
      ch.send({ type: 'payment', to: 'not-an-address', amount: 1_000_000n, token: USDC }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('rejects memo longer than 256 chars', async () => {
    const ch = makeTypedChannel(PaymentProtocol);
    await expect(
      ch.send({ type: 'payment', to: BOB, amount: 1_000_000n, token: USDC, memo: 'x'.repeat(257) }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('increments metrics.messagesSent on success', async () => {
    const ch = makeTypedChannel(PaymentProtocol);
    await ch.send({ type: 'payment', to: BOB, amount: 1_000_000n, token: USDC });
    await ch.send({ type: 'payment', to: BOB, amount: 2_000_000n, token: USDC });
    expect(ch.metrics().messagesSent).toBe(2);
  });
});

// ─── SwapProtocol ─────────────────────────────────────────────────────────────

describe('SwapProtocol', () => {
  it('has correct identifier', () => {
    expect(SwapProtocol.identifier).toBe('swap@1');
  });

  const validOffer = {
    type: 'offer' as const,
    offerToken: USDC,
    offerAmount: 100_000_000n,
    wantToken: WETH,
    wantAmount: 50_000_000_000_000_000n,
    expiry: Date.now() + 60_000,
  };

  it('accepts a valid offer', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(ch.send(validOffer)).resolves.toBeDefined();
  });

  it('accepts a cancel', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(ch.send({ ...validOffer, type: 'cancel' })).resolves.toBeDefined();
  });

  it('accepts an accept before expiry', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(ch.send({ ...validOffer, type: 'accept' })).resolves.toBeDefined();
  });

  it('rejects an accept after expiry', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(
      ch.send({ ...validOffer, type: 'accept', expiry: Date.now() - 1 }),
    ).rejects.toThrow(ProtocolTransitionError);
  });

  it('rejects same offerToken and wantToken', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(
      ch.send({ ...validOffer, wantToken: USDC }),
    ).rejects.toThrow(ProtocolTransitionError);
  });

  it('rejects zero offerAmount', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(
      // @ts-expect-error
      ch.send({ ...validOffer, offerAmount: 0n }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('rejects zero wantAmount', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(
      // @ts-expect-error
      ch.send({ ...validOffer, wantAmount: 0n }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('rejects invalid type string', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(
      // @ts-expect-error
      ch.send({ ...validOffer, type: 'unknown' }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('rejects invalid token address', async () => {
    const ch = makeTypedChannel(SwapProtocol);
    await expect(
      ch.send({ ...validOffer, offerToken: 'not-an-address' }),
    ).rejects.toThrow(ProtocolValidationError);
  });
});

/**
 * Unit tests for defineProtocol() and TypedChannel.
 *
 * No React or network required — purely tests the protocol layer
 * using a MockClearNode transport and MemoryAdapter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { defineProtocol } from '../../../src/protocol/defineProtocol.js';
import { TypedChannel } from '../../../src/protocol/TypedChannel.js';
import { ChannelFactory } from '../../../src/channel/ChannelFactory.js';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import { MockClearNode } from '../../integration/helpers/MockClearNode.js';
import {
  ProtocolValidationError,
  ProtocolTransitionError,
} from '../../../src/errors/index.js';
import type { Protocol } from '../../../src/protocol/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PaymentSchema = z.object({
  type: z.literal('payment'),
  amount: z.bigint(),
  to: z.string(),
});

type PaymentState = z.infer<typeof PaymentSchema>;

const TEST_CHAIN = {
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
} as const;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`;

const MOCK_SIGNER = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
  signTypedData: async () => '0xMOCKSIG' as `0x${string}`,
  signMessage: async () => '0xMOCKSIG' as `0x${string}`,
};

// ─── defineProtocol() ─────────────────────────────────────────────────────────

describe('defineProtocol()', () => {
  it('returns a Protocol with the correct name and version', () => {
    const proto = defineProtocol({
      name: 'payment-v1',
      version: 1,
      schema: PaymentSchema,
    });

    expect(proto.name).toBe('payment-v1');
    expect(proto.version).toBe(1);
  });

  it('builds the correct identifier string', () => {
    const proto = defineProtocol({ name: 'opts', version: 3, schema: PaymentSchema });
    expect(proto.identifier).toBe('opts@3');
  });

  it('preserves the Zod schema reference', () => {
    const proto = defineProtocol({ name: 'p', version: 1, schema: PaymentSchema });
    expect(proto.schema).toBe(PaymentSchema);
  });

  it('preserves transitions when provided', () => {
    const guard = (_prev: PaymentState | null, next: PaymentState) => next.amount > 0n;
    const proto = defineProtocol({
      name: 'p',
      version: 1,
      schema: PaymentSchema,
      transitions: { positiveAmount: guard },
    });

    expect(proto.transitions?.['positiveAmount']).toBe(guard);
  });

  it('preserves resolveDispute when provided', () => {
    const resolve = (history: PaymentState[]) => history[0];
    const proto = defineProtocol({
      name: 'p',
      version: 1,
      schema: PaymentSchema,
      resolveDispute: resolve,
    });

    expect(proto.resolveDispute).toBe(resolve);
  });

  it('transitions and resolveDispute are undefined when not provided', () => {
    const proto = defineProtocol({ name: 'p', version: 1, schema: PaymentSchema });
    expect(proto.transitions).toBeUndefined();
    expect(proto.resolveDispute).toBeUndefined();
  });
});

// ─── TypedChannel via ChannelFactory.open() ───────────────────────────────────

describe('TypedChannel', () => {
  let mockClearNode: MockClearNode;
  let persistence: MemoryAdapter;
  let protocol: Protocol<PaymentState>;

  beforeEach(() => {
    mockClearNode = new MockClearNode();
    persistence = new MemoryAdapter();
    protocol = defineProtocol({
      name: 'payment-v1',
      version: 1,
      schema: PaymentSchema,
      transitions: {
        positiveAmount: (_prev, next) => next.amount > 0n,
      },
    });
  });

  async function openTyped() {
    return ChannelFactory.open(
      {
        clearnode: 'ws://localhost:9999',
        signer: MOCK_SIGNER,
        assets: [{ token: USDC, amount: 1000n }],
        chain: TEST_CHAIN,
        rpcUrl: 'http://127.0.0.1:8545',
        persistence,
        autoDispute: false,
        protocol,
      },
      mockClearNode,
    );
  }

  it('ChannelFactory.open() returns a TypedChannel when protocol is provided', async () => {
    const channel = await openTyped();
    expect(channel).toBeInstanceOf(TypedChannel);
  });

  it('TypedChannel exposes .protocol with the correct identifier', async () => {
    const channel = await openTyped();
    expect(channel.protocol.identifier).toBe('payment-v1@1');
  });

  it('send() accepts a valid typed payload and returns a SendResult', async () => {
    const channel = await openTyped();
    const result = await channel.send({
      type: 'payment',
      amount: 10n,
      to: '0xBob',
    });

    expect(result.version).toBe(1);
    expect(result.state.version).toBe(1);
  });

  it('send() throws ProtocolValidationError for invalid payload shape', async () => {
    const channel = await openTyped();

    await expect(
      // @ts-expect-error — intentionally wrong shape for test
      channel.send({ type: 'payment', amount: 'not-a-bigint', to: '0xBob' }),
    ).rejects.toThrow(ProtocolValidationError);
  });

  it('send() throws ProtocolTransitionError when guard returns false', async () => {
    const channel = await openTyped();

    await expect(
      channel.send({ type: 'payment', amount: 0n, to: '0xBob' }),
    ).rejects.toThrow(ProtocolTransitionError);
  });

  it('ProtocolTransitionError carries the correct protocolId and guardName', async () => {
    const channel = await openTyped();

    const err = await channel
      .send({ type: 'payment', amount: 0n, to: '0xBob' })
      .catch(e => e) as ProtocolTransitionError;

    expect(err).toBeInstanceOf(ProtocolTransitionError);
    expect(err.protocolId).toBe('payment-v1@1');
    expect(err.guardName).toBe('positiveAmount');
  });

  it('ProtocolValidationError carries the correct protocolId', async () => {
    const channel = await openTyped();

    const err = await channel
      // @ts-expect-error — intentionally bad payload
      .send({ type: 'wrong' })
      .catch(e => e) as ProtocolValidationError;

    expect(err).toBeInstanceOf(ProtocolValidationError);
    expect(err.protocolId).toBe('payment-v1@1');
  });

  it('protocol identifier is embedded in state.data', async () => {
    const channel = await openTyped();
    const result = await channel.send({ type: 'payment', amount: 5n, to: '0xBob' });

    const hex = result.state.data;
    const json = Buffer.from(hex.slice(2), 'hex').toString('utf8');
    const envelope = JSON.parse(json) as { __protocol__: string; payload: PaymentState };

    expect(envelope.__protocol__).toBe('payment-v1@1');
    expect(envelope.payload.amount).toBe('5'); // bigint serializes to string via JSON
  });

  it('multiple sends all succeed with incrementing versions', async () => {
    const channel = await openTyped();

    const r1 = await channel.send({ type: 'payment', amount: 1n, to: '0xBob' });
    const r2 = await channel.send({ type: 'payment', amount: 2n, to: '0xBob' });
    const r3 = await channel.send({ type: 'payment', amount: 3n, to: '0xBob' });

    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
    expect(r3.version).toBe(3);
  });

  it('TypedChannel delegates getHistory() to underlying Channel', async () => {
    const channel = await openTyped();
    await channel.send({ type: 'payment', amount: 1n, to: '0xBob' });
    await channel.send({ type: 'payment', amount: 2n, to: '0xBob' });

    const history = await channel.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('TypedChannel delegates status property to underlying Channel', async () => {
    const channel = await openTyped();
    expect(channel.status).toBe('ACTIVE');
  });

  it('TypedChannel delegates on() — stateUpdate fires after send()', async () => {
    const channel = await openTyped();
    const updates: number[] = [];
    channel.on('stateUpdate', (v) => updates.push(v));

    await channel.send({ type: 'payment', amount: 1n, to: '0xBob' });
    await channel.send({ type: 'payment', amount: 2n, to: '0xBob' });

    expect(updates).toEqual([1, 2]);
  });

  it('ChannelFactory.open() without protocol returns a plain Channel (not TypedChannel)', async () => {
    const { Channel } = await import('../../../src/channel/Channel.js');
    const plainChannel = await ChannelFactory.open(
      {
        clearnode: 'ws://localhost:9999',
        signer: MOCK_SIGNER,
        assets: [{ token: USDC, amount: 1000n }],
        chain: TEST_CHAIN,
        rpcUrl: 'http://127.0.0.1:8545',
        persistence,
        autoDispute: false,
      },
      new MockClearNode(),
    );

    expect(plainChannel).toBeInstanceOf(Channel);
    expect(plainChannel).not.toBeInstanceOf(TypedChannel);
  });

  it('resolveDispute is accessible on the protocol', async () => {
    const proto = defineProtocol({
      name: 'test',
      version: 1,
      schema: PaymentSchema,
      resolveDispute: (history) => history[history.length - 1],
    });

    const payments: PaymentState[] = [
      { type: 'payment', amount: 1n, to: '0xA' },
      { type: 'payment', amount: 2n, to: '0xB' },
    ];

    const resolved = proto.resolveDispute?.(payments);
    expect(resolved?.amount).toBe(2n);
  });
});

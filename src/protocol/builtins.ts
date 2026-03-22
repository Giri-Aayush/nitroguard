/**
 * Built-in protocol schemas for common state channel use cases.
 *
 * Requires zod: `npm install zod`
 *
 * @example
 * ```ts
 * import { PaymentProtocol, SwapProtocol } from 'nitroguard/protocols';
 *
 * const channel = await NitroGuard.open({ ...config, protocol: PaymentProtocol });
 * await channel.send({ type: 'payment', to: '0xBob...', amount: 10_000_000n, token: USDC });
 * ```
 */

import { z } from 'zod';
import { defineProtocol } from './defineProtocol.js';

// ─── PaymentProtocol ──────────────────────────────────────────────────────────

const paymentSchema = z.object({
  type: z.literal('payment'),
  /** Recipient address */
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a valid address'),
  /** Token amount in smallest unit (e.g. 1_000_000n = 1 USDC) */
  amount: z.bigint().positive(),
  /** ERC-20 token address, or 0x0000...0000 for native ETH */
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a valid address'),
  /** Optional human-readable memo */
  memo: z.string().max(256).optional(),
});

export type PaymentPayload = z.infer<typeof paymentSchema>;

/**
 * Ready-made protocol for off-chain token payments.
 *
 * Enforces:
 * - `amount` is strictly positive
 * - `to` and `token` are valid hex addresses
 *
 * @example
 * ```ts
 * import { PaymentProtocol } from 'nitroguard/protocols';
 *
 * const channel = await NitroGuard.open({ ...config, protocol: PaymentProtocol });
 * await channel.send({ type: 'payment', to: '0xBob...', amount: 5_000_000n, token: USDC });
 * ```
 */
export const PaymentProtocol = defineProtocol({
  name: 'payment',
  version: 1,
  schema: paymentSchema,
  transitions: {
    positiveAmount: (_prev, next) => next.amount > 0n,
  },
});

// ─── SwapProtocol ─────────────────────────────────────────────────────────────

const swapSchema = z.object({
  type: z.enum(['offer', 'accept', 'cancel']),
  /** Token the sender is offering */
  offerToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a valid address'),
  /** Amount of offerToken in smallest unit */
  offerAmount: z.bigint().positive(),
  /** Token the sender wants in return */
  wantToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a valid address'),
  /** Amount of wantToken expected in return */
  wantAmount: z.bigint().positive(),
  /** Unix timestamp (ms) after which the offer expires */
  expiry: z.number().int().positive(),
});

export type SwapPayload = z.infer<typeof swapSchema>;

/**
 * Ready-made protocol for atomic token swaps negotiated off-chain.
 *
 * Enforces:
 * - Both `offerAmount` and `wantAmount` are strictly positive
 * - An `accept` can only be sent before the offer's `expiry`
 *
 * Typical flow: one party sends `offer`, the other sends `accept` or `cancel`.
 *
 * @example
 * ```ts
 * import { SwapProtocol } from 'nitroguard/protocols';
 *
 * const channel = await NitroGuard.open({ ...config, protocol: SwapProtocol });
 *
 * // Alice proposes
 * await channel.send({
 *   type: 'offer',
 *   offerToken: USDC, offerAmount: 100_000_000n,
 *   wantToken:  WETH, wantAmount:  50_000_000_000_000_000n,
 *   expiry: Date.now() + 60_000,
 * });
 *
 * // Bob accepts
 * await channel.send({ ...prevOffer, type: 'accept' });
 * ```
 */
export const SwapProtocol = defineProtocol({
  name: 'swap',
  version: 1,
  schema: swapSchema,
  transitions: {
    positiveAmounts: (_prev, next) => next.offerAmount > 0n && next.wantAmount > 0n,
    acceptBeforeExpiry: (_prev, next) =>
      next.type !== 'accept' || Date.now() <= next.expiry,
    differentTokens: (_prev, next) =>
      next.offerToken.toLowerCase() !== next.wantToken.toLowerCase(),
  },
});

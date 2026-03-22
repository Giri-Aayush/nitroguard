import type { z } from 'zod';
import type { Protocol, ProtocolDefinition } from './types.js';

/**
 * Define a typed protocol for use with NitroGuard state channels.
 *
 * Returns a `Protocol<T>` object that can be passed to `ChannelFactory.open()`
 * via `config.protocol`. When a channel is opened with a protocol, the returned
 * `TypedChannel<T>` enforces:
 *   - Shape validation (Zod schema) on every `send()`
 *   - Transition guard evaluation before state is signed
 *   - Protocol identifier embedded in `state.data` for on-chain readability
 *
 * @example
 * ```ts
 * import { defineProtocol } from 'nitroguard';
 * import { z } from 'zod';
 *
 * const PaymentProtocol = defineProtocol({
 *   name: 'payment-v1',
 *   version: 1,
 *   schema: z.object({
 *     type: z.literal('payment'),
 *     amount: z.bigint().positive(),
 *     to: z.string(),
 *   }),
 *   transitions: {
 *     positiveAmount: (_prev, next) => next.amount > 0n,
 *   },
 * });
 *
 * const channel = await NitroGuard.open({ ...config, protocol: PaymentProtocol });
 * await channel.send({ type: 'payment', amount: 10n, to: '0xBob...' });
 * ```
 */
export function defineProtocol<S extends z.ZodTypeAny>(
  definition: ProtocolDefinition<S>,
): Protocol<z.infer<S>> {
  return {
    name: definition.name,
    version: definition.version,
    schema: definition.schema as z.ZodType<z.infer<S>>,
    ...(definition.transitions ? { transitions: definition.transitions } : {}),
    ...(definition.resolveDispute ? { resolveDispute: definition.resolveDispute } : {}),
    identifier: `${definition.name}@${definition.version}`,
  };
}

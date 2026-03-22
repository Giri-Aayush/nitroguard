# Protocol Schemas

NitroGuard's protocol system lets you define a typed payload schema for your channel. `channel.send()` becomes fully type-safe, and each state transition can be validated with custom guards.

## Why Use Protocols?

Without a protocol, `channel.send()` accepts `unknown`:

```typescript
await channel.send({ anything: 'goes' });         // no type checking
await channel.send({ typo: 'amountt', val: 1n }); // silent bug
```

With a protocol:

```typescript
// TypeScript error: 'amountt' is not a valid key
await channel.send({ amountt: 1n }); // caught at compile time

// Runtime error: Zod validation failure
await channel.send({ amount: 'not-a-bigint' }); // ProtocolValidationError
```

---

## Defining a Protocol

```typescript
import { defineProtocol } from 'nitroguard';
import { z } from 'zod';

const PaymentProtocol = defineProtocol({
  name: 'payment',
  version: 1,
  schema: z.object({
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    amount: z.bigint().positive(),
    memo: z.string().optional(),
  }),
});
```

`defineProtocol()` infers the TypeScript type from your Zod schema. The return type is `Protocol<{ to: string; amount: bigint; memo?: string }>`.

## Using a Protocol

Pass the protocol to `NitroGuard.open()`:

```typescript
import { NitroGuard } from 'nitroguard';

const channel = await NitroGuard.open({
  clearnode: 'wss://...',
  signer,
  chain,
  rpcUrl,
  assets,
  protocol: PaymentProtocol,
});

// TypeScript knows exactly what send() accepts
await channel.send({ to: '0xBob...', amount: 10n * 10n ** 6n });

// Type error: 'note' is not in the schema
await channel.send({ note: 'hello' }); // compile error
```

The returned `channel` is a `TypedChannel<PaymentState>` — all methods are the same as `Channel`, only `send()` is constrained to the protocol type.

---

## Transition Guards

Transition guards are pure functions that validate state changes. They receive the previous state (or `null` for the first transition) and the proposed next state:

```typescript
const PaymentProtocol = defineProtocol({
  name: 'payment',
  version: 1,
  schema: z.object({
    to: z.string(),
    amount: z.bigint(),
    cumulativeTotal: z.bigint(),
  }),
  transitions: {
    // amount must be positive
    positiveAmount: (_prev, next) => next.amount > 0n,

    // cumulative total must always increase
    monotonicTotal: (prev, next) =>
      prev === null || next.cumulativeTotal > prev.cumulativeTotal,

    // can't send more than 1000 USDC per transaction
    maxPerTx: (_prev, next) => next.amount <= 1000n * 10n ** 6n,
  },
});
```

Each guard is run before the state is sent. If any guard returns `false`, `send()` throws `ProtocolTransitionError`:

```typescript
import { ProtocolTransitionError } from 'nitroguard';

try {
  await channel.send({ to: '0x...', amount: 5000n * 10n ** 6n, cumulativeTotal: 5000n * 10n ** 6n });
} catch (err) {
  if (err instanceof ProtocolTransitionError) {
    console.log(err.message); // "Transition guard 'maxPerTx' failed for protocol payment@1"
    console.log(err.guard);   // 'maxPerTx'
  }
}
```

---

## Full Example: Options Protocol

```typescript
import { NitroGuard, defineProtocol } from 'nitroguard';
import { z } from 'zod';

const OptionsProtocol = defineProtocol({
  name: 'options-v1',
  version: 1,
  schema: z.object({
    type: z.enum(['open', 'exercise', 'expire']),
    strikePrice: z.bigint(),
    expiry: z.number(),    // Unix ms
    premium: z.bigint(),
  }),
  transitions: {
    validStrike: (_prev, next) => next.strikePrice > 0n,
    validPremium: (_prev, next) => next.premium >= 0n,
    exerciseBeforeExpiry: (_prev, next) =>
      next.type !== 'exercise' || Date.now() <= next.expiry,
    noReopen: (prev, next) =>
      prev === null || prev.type !== 'expire' || next.type === 'open',
  },
});

const channel = await NitroGuard.open({
  clearnode: 'wss://...',
  signer,
  chain,
  rpcUrl,
  assets: [{ token: USDC, amount: 500n * 10n ** 6n }],
  protocol: OptionsProtocol,
});

// Open a position
await channel.send({
  type: 'open',
  strikePrice: 3000n * 10n ** 6n,  // $3000 strike
  expiry: Date.now() + 86_400_000, // 24h expiry
  premium: 50n * 10n ** 6n,        // $50 premium
});

// Exercise the option
await channel.send({
  type: 'exercise',
  strikePrice: 3000n * 10n ** 6n,
  expiry: Date.now() + 86_400_000,
  premium: 50n * 10n ** 6n,
});

// Close out
await channel.close();
```

---

## Dispute Resolution Hook (Optional)

When your channel enters `DISPUTE` state, NitroGuard needs to know which state to submit on-chain. By default it uses the highest-version co-signed state. You can override this with `resolveDispute`:

```typescript
const OptionsProtocol = defineProtocol({
  name: 'options-v1',
  version: 1,
  schema: OptionsSchema,
  resolveDispute: (history) => {
    // history is ordered oldest → newest
    // Prefer the most recent 'exercise' state if one exists
    const exercised = [...history].reverse().find(s => s.type === 'exercise');
    return exercised ?? history[history.length - 1];
  },
});
```

---

## Protocol Envelope

Under the hood, `TypedChannel` wraps your payload in an envelope before writing it to `state.data`:

```json
{
  "__protocol__": "options-v1@1",
  "payload": {
    "type": "open",
    "strikePrice": "3000000000",
    "expiry": 1700000000000,
    "premium": "50000000"
  }
}
```

This is hex-encoded as the `data` field of the `State` struct. NitroGuard decodes it transparently when reading states from persistence.

---

## Error Reference

| Error | When |
|---|---|
| `ProtocolValidationError` | Payload fails Zod schema (wrong type, missing field, etc.) |
| `ProtocolTransitionError` | A transition guard returned `false` |

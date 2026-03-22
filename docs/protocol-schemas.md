<p>
  <img src="https://img.shields.io/badge/NitroGuard-Protocol%20Schemas-F5C518?style=flat-square&labelColor=000000" />
</p>

# Protocol Schemas

`defineProtocol()` adds a typed schema layer to any channel. Once a protocol is set, `channel.send()` validates payloads at runtime and is fully type-checked at compile time.

---

## Built-in protocols

For the two most common use cases, NitroGuard ships ready-made schemas — no Zod boilerplate required.

```bash
npm install zod  # peer dependency required for protocols
```

### `PaymentProtocol`

```ts
import { PaymentProtocol } from 'nitroguard/protocols';

const channel = await NitroGuard.open({ ...config, protocol: PaymentProtocol });

await channel.send({
  type:   'payment',
  to:     '0xBob...',          // recipient address
  amount: 10_000_000n,         // in token's smallest unit
  token:  USDC,                // ERC-20 address
  memo:   'coffee',            // optional, max 256 chars
});
```

Enforces: `amount > 0`, valid hex addresses, memo ≤ 256 chars.

### `SwapProtocol`

```ts
import { SwapProtocol } from 'nitroguard/protocols';

const channel = await NitroGuard.open({ ...config, protocol: SwapProtocol });

// Alice proposes
await channel.send({
  type:        'offer',
  offerToken:  USDC,  offerAmount: 100_000_000n,
  wantToken:   WETH,  wantAmount:  50_000_000_000_000_000n,
  expiry:      Date.now() + 60_000,
});

// Bob accepts (or cancels)
await channel.send({ ...prevOffer, type: 'accept' });
await channel.send({ ...prevOffer, type: 'cancel' });
```

Enforces: both amounts > 0, offer and want tokens must differ, `accept` must arrive before `expiry`.

---

## Without a protocol

```ts
await channel.send({ anything: 'goes' });        // no type safety
await channel.send({ amountt: 1n });              // typo — silent bug
await channel.send({ amount: 'not-a-bigint' });   // wrong type — silent bug
```

## With a protocol

```ts
await channel.send({ amountt: 1n });             // TypeScript error at compile time
await channel.send({ amount: 'not-a-bigint' });  // ProtocolValidationError at runtime
```

---

## Defining a protocol

```ts
import { defineProtocol } from 'nitroguard';
import { z } from 'zod';  // npm install zod

const PaymentProtocol = defineProtocol({
  name:    'payment',
  version: 1,
  schema: z.object({
    to:     z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    amount: z.bigint().positive(),
    memo:   z.string().optional(),
  }),
});
```

`defineProtocol()` infers the TypeScript type from the Zod schema. The return type is `Protocol<{ to: string; amount: bigint; memo?: string }>`.

---

## Using a protocol

```ts
const channel = await NitroGuard.open({
  ...config,
  protocol: PaymentProtocol,
});

// TypeScript knows what send() accepts
await channel.send({ to: '0xBob...', amount: 10n * 10n ** 6n });

// Type error — 'note' is not in the schema
await channel.send({ note: 'hello' }); // TS2345
```

The returned channel is a `TypedChannel<T>`. All methods work identically to `Channel` — only `send()` is constrained to the schema type.

---

## Transition guards

Guards validate state changes. Each guard receives the previous typed state (or `null` on the first send) and the proposed next state:

```ts
const TradeProtocol = defineProtocol({
  name:    'trade',
  version: 1,
  schema: z.object({
    amount:          z.bigint(),
    cumulativeTotal: z.bigint(),
  }),
  transitions: {
    positiveAmount:  (_prev, next) => next.amount > 0n,
    monotonicTotal:  (prev, next)  => prev === null || next.cumulativeTotal > prev.cumulativeTotal,
    maxPerTx:        (_prev, next) => next.amount <= 1_000n * 10n ** 6n,
  },
});
```

All defined guards must pass. If any returns `false`, `send()` throws `ProtocolTransitionError` before signing the state:

```ts
import { ProtocolTransitionError } from 'nitroguard';

try {
  await channel.send({ amount: 5_000n * 10n ** 6n, cumulativeTotal: 5_000n * 10n ** 6n });
} catch (err) {
  if (err instanceof ProtocolTransitionError) {
    console.log(err.guard);   // 'maxPerTx'
    console.log(err.message); // "Transition guard 'maxPerTx' failed for protocol trade@1"
  }
}
```

---

## Full example — options protocol

```ts
import { NitroGuard, defineProtocol } from 'nitroguard';
import { z } from 'zod';

const OptionsProtocol = defineProtocol({
  name:    'options-v1',
  version: 1,
  schema: z.object({
    type:        z.enum(['open', 'exercise', 'expire']),
    strikePrice: z.bigint().positive(),
    expiry:      z.number(),
    premium:     z.bigint().nonnegative(),
  }),
  transitions: {
    validStrike:          (_prev, next) => next.strikePrice > 0n,
    exerciseBeforeExpiry: (_prev, next) => next.type !== 'exercise' || Date.now() <= next.expiry,
  },
});

const channel = await NitroGuard.open({
  ...config,
  assets:   [{ token: USDC, amount: 500n * 10n ** 6n }],
  protocol: OptionsProtocol,
});

await channel.send({
  type:        'open',
  strikePrice: 3_000n * 10n ** 6n,
  expiry:      Date.now() + 86_400_000,
  premium:     50n * 10n ** 6n,
});

await channel.send({
  type:        'exercise',
  strikePrice: 3_000n * 10n ** 6n,
  expiry:      Date.now() + 86_400_000,
  premium:     50n * 10n ** 6n,
});

await channel.close();
```

---

## Dispute resolution hook

By default, `forceClose()` submits the highest-version co-signed state. Override this per-protocol:

```ts
const OptionsProtocol = defineProtocol({
  ...
  resolveDispute: (history) => {
    // history is ordered oldest → newest
    // prefer the most recent 'exercise' state, fall back to latest
    return [...history].reverse().find(s => s.type === 'exercise') ?? history.at(-1);
  },
});
```

---

## How it works under the hood

`TypedChannel.send()` wraps your payload in an envelope before writing it to `state.data`:

```json
{
  "__protocol__": "options-v1@1",
  "payload": { "type": "open", "strikePrice": "3000000000", ... }
}
```

This is hex-encoded into the `data` field of the ERC-7824 `State` struct, making the protocol name and version readable on-chain.

---

## Error reference

| Error | When |
|---|---|
| `ProtocolValidationError` | Payload doesn't match the Zod schema |
| `ProtocolTransitionError` | A transition guard returned `false` |

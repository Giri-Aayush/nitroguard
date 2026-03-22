# Options Protocol Example

Demonstrates NitroGuard's typed protocol system with a real options trading schema.

This example shows:
- `defineProtocol()` with a Zod schema for option positions
- Transition guards that enforce business rules (exercise before expiry, valid strike price)
- `TypedChannel.send()` — TypeScript knows exactly what fields to pass
- `ProtocolValidationError` when the payload violates the Zod schema
- `ProtocolTransitionError` when a transition guard fails

## Prerequisites

- Node.js 18+
- A Sepolia wallet with test ETH + USDC

## Setup

```bash
npm install
```

## Run

```bash
PRIVATE_KEY=0x<your-key> RPC_URL=https://rpc.sepolia.org npm start
```

Expected output:

```
Wallet: 0xYourAddress

Opening options channel...
Channel ID: 0xabc...
Status: ACTIVE

Opening position...
Position opened (version 1 )

Trying invalid payload (wrong type)...
  ProtocolValidationError caught (expected): ...

Trying guard violation (exercise after expiry)...
  ProtocolTransitionError caught (expected): Transition guard 'exerciseBeforeExpiry' failed for protocol options-v1@1
  Failed guard: exerciseBeforeExpiry

Exercising option...
Option exercised (version 2 )

Settling channel...
Done!
  tx: 0xdef...
  status: FINAL
```

## The Protocol Definition

```typescript
const OptionsProtocol = defineProtocol({
  name: 'options-v1',
  version: 1,
  schema: z.object({
    type: z.enum(['open', 'exercise', 'expire']),
    strikePrice: z.bigint().positive(),
    expiry: z.number().positive(),
    premium: z.bigint().nonnegative(),
  }),
  transitions: {
    validStrike: (_prev, next) => next.strikePrice > 0n,
    validPremium: (_prev, next) => next.premium >= 0n,
    exerciseBeforeExpiry: (_prev, next) =>
      next.type !== 'exercise' || Date.now() <= next.expiry,
  },
});
```

See [Protocol Schemas guide](../../docs/protocol-schemas.md) for full documentation.

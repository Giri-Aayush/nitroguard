# NitroGuard

**Production-grade state channel lifecycle SDK for Yellow Network / ERC-7824.**

[![npm](https://img.shields.io/npm/v/nitroguard)](https://www.npmjs.com/package/nitroguard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://github.com/Giri-Aayush/nitroguard/actions/workflows/ci.yml/badge.svg)](https://github.com/Giri-Aayush/nitroguard/actions)

NitroGuard wraps the full ERC-7824 state channel lifecycle — open, send, dispute, recover — into a safe, typed API. It sits between `@erc7824/nitrolite` and your application, handling:

- **State machine enforcement** — invalid transitions throw typed errors, not silent failures
- **Automatic persistence** — every co-signed state saved to IndexedDB (browser) or LevelDB (Node)
- **Fund protection** — watches on-chain events and responds to stale challenges automatically
- **Typed protocols** — define your payload schema with Zod; `send()` is fully type-safe
- **React hooks** — `useChannel`, `useChannelStatus`, `useChannelBalance` out of the box

---

## Quick Start

```bash
npm install nitroguard viem @erc7824/nitrolite
```

```typescript
import { NitroGuard } from 'nitroguard';
import { mainnet } from 'viem/chains';

// Open a channel
const channel = await NitroGuard.open({
  clearnode: 'wss://clearnet.yellow.com/ws',
  signer,                                      // EIP712Signer — viem WalletClient works
  chain: mainnet,
  rpcUrl: 'https://eth.llamarpc.com',
  assets: [{ token: USDC, amount: 100n * 10n ** 6n }],
});

// Send off-chain state updates (sub-second, free)
await channel.send({ type: 'payment', to: bob, amount: 10n });
await channel.send({ type: 'payment', to: bob, amount: 5n });

// Close cooperatively
await channel.close();
```

That's it. If ClearNode goes offline, NitroGuard calls `challenge()` on-chain automatically and recovers your funds.

---

## Features

| Feature | Description |
|---|---|
| `Channel.send()` | Off-chain state update with co-signature + automatic persistence |
| `Channel.close()` | Mutual close — ClearNode co-signs the final state |
| `Channel.forceClose()` | Unilateral close — submits challenge, waits for window, withdraws |
| `Channel.checkpoint()` | Anchors latest state on-chain so older challenges are rejected |
| `Channel.withdraw()` | Withdraw funds after FINAL state |
| `NitroGuard.restore()` | Resume a channel after process restart / tab refresh |
| `DisputeWatcher` | Auto-responds to stale challenges while the app runs |
| `ClearNodeMonitor` | Detects ClearNode silence and triggers `forceClose()` automatically |
| `defineProtocol()` | Typed schema system — Zod-powered payload validation + transition guards |
| `useChannel()` | React hook — full lifecycle with status, version, loading, error |

---

## Installation

```bash
# Required peers
npm install nitroguard viem @erc7824/nitrolite

# For typed protocols (optional)
npm install zod

# For React hooks (optional)
npm install react react-dom
```

### Persistence adapters

| Environment | Adapter | Install |
|---|---|---|
| Browser | `IndexedDBAdapter` (default) | built-in |
| Node.js | `LevelDBAdapter` | `npm install level` |
| Tests | `MemoryAdapter` | built-in |

---

## Automatic Fund Protection

```typescript
import { NitroGuard, LevelDBAdapter } from 'nitroguard';
import { CustodyClient } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

const channel = await NitroGuard.open({
  clearnode: 'wss://clearnet.yellow.com/ws',
  signer,
  chain: mainnet,
  rpcUrl,
  assets: [{ token: USDC, amount: 100n * 10n ** 6n }],
  persistence,
  custodyClient,   // inject CustodyClient for on-chain ops
  autoDispute: true,             // auto-respond to stale challenges
  clearnodeSilenceTimeout: 30_000, // forceClose if ClearNode silent for 30s
  onChallengeDetected: (channelId) => console.log('Challenge detected!'),
  onFundsReclaimed: (channelId, amounts) => console.log('Funds recovered:', amounts),
});
```

---

## Typed Protocols

```typescript
import { NitroGuard, defineProtocol } from 'nitroguard';
import { z } from 'zod';

const TradeProtocol = defineProtocol({
  name: 'options-v1',
  version: 1,
  schema: z.object({
    type: z.enum(['open', 'exercise', 'expire']),
    strikePrice: z.bigint(),
    expiry: z.number(),
    premium: z.bigint(),
  }),
  transitions: {
    validStrike: (_prev, next) => next.strikePrice > 0n,
    validPremium: (_prev, next) => next.premium >= 0n,
    exerciseBeforeExpiry: (_prev, next) =>
      next.type !== 'exercise' || Date.now() <= next.expiry,
  },
});

// TypeScript knows channel.send() takes TradeState
const channel = await NitroGuard.open({ ...config, protocol: TradeProtocol });
await channel.send({ type: 'open', strikePrice: 3000n, expiry: Date.now() + 86400000, premium: 50n });
```

---

## React Hooks

```tsx
import { NitroGuardProvider, useChannel, useChannelBalance } from 'nitroguard/react';

function App() {
  return (
    <NitroGuardProvider
      config={{ clearnode: 'wss://...', signer, chain: mainnet, rpcUrl }}
      createTransport={() => new MyTransport()}
    >
      <PaymentUI />
    </NitroGuardProvider>
  );
}

function PaymentUI() {
  const { channel, status, open, send, close } = useChannel();
  const { myBalance } = useChannelBalance(channel);

  return (
    <div>
      <p>Status: {status} | Balance: {myBalance.toString()} USDC</p>
      {status === 'VOID' && (
        <button onClick={() => open([{ token: USDC, amount: 100n }])}>
          Open Channel
        </button>
      )}
      {status === 'ACTIVE' && (
        <button onClick={() => send({ type: 'payment', amount: 10n })}>
          Pay 10 USDC
        </button>
      )}
    </div>
  );
}
```

---

## State Machine

```
VOID ──open()──► INITIAL ──(both sign)──► ACTIVE
                                          │  │  │
                                    send() │  │  checkpoint()
                                     (loop)│  │  (ACTIVE → ACTIVE)
                                          │  │
                              close() ◄───┘  └───► DISPUTE
                                │                     │
                                ▼                     │ (auto-respond)
                              FINAL ◄─────────────────┘
                                │
                          withdraw()
                                │
                                ▼
                              VOID
```

All transitions are enforced by the FSM — calling the wrong method in the wrong state throws `InvalidTransitionError` with a clear message.

---

## Error Types

```typescript
import {
  InvalidTransitionError,   // wrong method for current state
  CoSignatureTimeoutError,  // ClearNode didn't co-sign in time
  NoPersistenceError,       // forceClose with no saved state
  ProtocolValidationError,  // payload failed Zod schema
  ProtocolTransitionError,  // transition guard returned false
  ChannelNotFoundError,     // restore() with unknown channelId
  ClearNodeUnreachableError,// can't connect to ClearNode
} from 'nitroguard';
```

---

## Documentation

- [Quick Start](docs/quick-start.md) — step-by-step first channel
- [State Machine](docs/state-machine.md) — FSM diagram + all transitions
- [Dispute Guide](docs/dispute-guide.md) — how fund protection works
- [Persistence Guide](docs/persistence-guide.md) — adapter selection + custom adapters
- [Protocol Schemas](docs/protocol-schemas.md) — `defineProtocol()` full guide
- [React Guide](docs/react-guide.md) — hooks reference + Next.js setup

---

## License

MIT — Aayush Giri

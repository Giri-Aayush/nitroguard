<p align="center">
  <a href="https://www.npmjs.com/package/nitroguard">
    <img src="https://img.shields.io/npm/v/nitroguard?style=flat-square&color=F5C518&labelColor=000000&label=npm" alt="npm" />
  </a>
  <a href="https://github.com/Giri-Aayush/nitroguard/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/Giri-Aayush/nitroguard/ci.yml?style=flat-square&color=F5C518&labelColor=000000&label=CI" alt="CI" />
  </a>
  <img src="https://img.shields.io/badge/ERC--7824-Yellow%20Network-F5C518?style=flat-square&labelColor=000000" alt="ERC-7824" />
  <img src="https://img.shields.io/badge/license-MIT-F5C518?style=flat-square&labelColor=000000" alt="MIT" />
</p>

<h1 align="center">nitroguard</h1>
<p align="center">State channel lifecycle SDK for <a href="https://yellow.com">Yellow Network</a> / ERC-7824</p>
<p align="center">
  <a href="https://www.npmjs.com/package/nitroguard">npmjs.com/package/nitroguard</a>
</p>

---

`@erc7824/nitrolite` gives you the raw primitives. NitroGuard gives you a production-ready channel: state machine enforcement, automatic persistence, dispute protection, and typed payloads — all in one composable API.

```bash
npm install nitroguard viem
```

---

## Quickstart

```ts
import { NitroGuard } from 'nitroguard';
import { createWalletClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet  = createWalletClient({ account, chain: mainnet, transport: http() });
const signer  = {
  address:       account.address,
  signTypedData: (p) => wallet.signTypedData(p),
  signMessage:   (p) => wallet.signMessage(p),
};

// transport connects NitroGuard to ClearNode over WebSocket.
// Use yellow-ts in production. For tests, implement ClearNodeTransport
// with a simple mock or use MockClearNode from the source repo's test/helpers.
// See docs/quick-start.md for details.
const transport = new MyClearNodeTransport('wss://clearnet.yellow.com/ws', signer);

const channel = await NitroGuard.open(
  {
    clearnode: 'wss://clearnet.yellow.com/ws',
    signer,
    chain:  mainnet,
    rpcUrl: 'https://eth.llamarpc.com',
    assets: [{ token: USDC, amount: 100n * 10n ** 6n }],
  },
  transport,
);

await channel.send({ type: 'payment', to: bob, amount: 10n * 10n ** 6n });
await channel.send({ type: 'payment', to: bob, amount: 5n  * 10n ** 6n });

await channel.close();
```

> ClearNode goes offline mid-session? NitroGuard submits a challenge automatically and recovers your funds with no intervention required.

---

## Core API

### `NitroGuard.open(config, transport)`

Opens a channel and returns it in `ACTIVE` state.

`transport` is a `ClearNodeTransport` — the bridge between NitroGuard and ClearNode's WebSocket API. Use `yellow-ts` for production. See [Quick Start](docs/quick-start.md#3-create-a-transport) for the interface and a minimal test stub.

| Option | Type | Required | |
|---|---|:---:|---|
| `clearnode` | `string` | ✓ | ClearNode WebSocket URL |
| `signer` | `EIP712Signer` | ✓ | Any EIP-712 signer — viem WalletClient works |
| `chain` | `Chain` | ✓ | viem Chain object |
| `rpcUrl` | `string` | ✓ | RPC endpoint |
| `assets` | `AssetAllocation[]` | ✓ | Tokens and amounts to deposit |
| `persistence` | `PersistenceAdapter` | | Defaults to IndexedDB / LevelDB |
| `custodyClient` | `CustodyClient` | | Required for `autoDispute` and `forceClose` |
| `autoDispute` | `boolean` | | Auto-respond to stale challenges |
| `clearnodeSilenceTimeout` | `number` | | ms of silence before `forceClose()` triggers |
| `protocol` | `Protocol<T>` | | Typed payload schema — [see Protocol Schemas](docs/protocol-schemas.md) |

### `channel`

```ts
channel.id       // string — keccak256 of channel params
channel.status   // 'VOID' | 'INITIAL' | 'ACTIVE' | 'DISPUTE' | 'FINAL'
channel.version  // number — increments on every confirmed send()

await channel.send(payload)       // off-chain state update, sub-second
await channel.close()             // mutual close, ClearNode co-signs final state
await channel.forceClose()        // unilateral — challenges on-chain
await channel.checkpoint()        // anchors current version on-chain
await channel.withdraw()          // release funds after FINAL

channel.metrics()  // { messagesSent, avgLatencyMs, uptimeMs, disputeCount }

channel.on('statusChange', (to, from) => {})
channel.on('stateUpdate',  (version, state) => {})
channel.on('error',        (err) => {})
```

### `NitroGuard.restore(channelId, config, transport)`

Resumes a channel after process restart or page refresh. Reconnects to ClearNode and picks up at the last persisted version.

```ts
const channel = await NitroGuard.restore(channelId, { clearnode, signer, chain, rpcUrl, persistence }, transport);
// channel.version === whatever you left it at
```

### `NitroGuard.restoreAll(config, transport)`

Restores all channels stored in the persistence adapter — useful on startup.

```ts
const channels = await NitroGuard.restoreAll({ clearnode, signer, chain, rpcUrl, persistence }, transport);
```

---

## Fund protection

Two independent layers of protection:

**DisputeWatcher** (`autoDispute: true`) — subscribes to on-chain `ChallengeRegistered` events. If a stale version is challenged, NitroGuard submits your latest co-signed state before the window closes.

**ClearNodeMonitor** (`clearnodeSilenceTimeout`) — tracks the last message timestamp. Triggers `forceClose()` automatically if ClearNode goes quiet.

```ts
const channel = await NitroGuard.open(
  {
    ...config,
    persistence,
    custodyClient,
    autoDispute:             true,
    clearnodeSilenceTimeout: 60_000,
    onChallengeDetected: (id)       => notify(`Challenge on ${id}`),
    onFundsReclaimed:    (id, amts) => log('Recovered', amts),
  },
  transport,
);
```

Both require a `persistence` adapter (to have a state to submit) and `custodyClient` (to submit it).
→ [Dispute Guide](docs/dispute-guide.md)

---

## Built-in protocols

`nitroguard/protocols` ships `PaymentProtocol` and `SwapProtocol` ready to use — no schema writing required.

```bash
npm install zod  # required for protocols
```

```ts
import { PaymentProtocol, SwapProtocol } from 'nitroguard/protocols';

// Payments
const ch = await NitroGuard.open({ ...config, protocol: PaymentProtocol }, transport);
await ch.send({ type: 'payment', to: '0xBob...', amount: 10_000_000n, token: USDC });

// Swaps
const ch2 = await NitroGuard.open({ ...config, protocol: SwapProtocol }, transport);
await ch2.send({
  type: 'offer',
  offerToken: USDC,  offerAmount: 100_000_000n,
  wantToken:  WETH,  wantAmount:  50_000_000_000_000_000n,
  expiry: Date.now() + 60_000,
});
```

→ [Protocol Schemas guide](docs/protocol-schemas.md)

---

## Custom protocols

Define your own payload schema once; `send()` becomes fully type-checked at compile time and validated at runtime.

```ts
import { defineProtocol } from 'nitroguard';
import { z } from 'zod';   // npm install zod

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
    exerciseBeforeExpiry: (_prev, next) =>
      next.type !== 'exercise' || Date.now() <= next.expiry,
  },
});

const channel = await NitroGuard.open({ ...config, protocol: OptionsProtocol }, transport);
await channel.send({ type: 'open', strikePrice: 3000n, expiry: Date.now() + 86_400_000, premium: 50n });
// TypeScript error if fields are missing or wrong type
```

→ [Protocol Schemas guide](docs/protocol-schemas.md)

---

## React

```tsx
// npm install react react-dom
import { NitroGuardProvider, useChannel, useChannelBalance } from 'nitroguard/react';

// Provider is SSR-safe — transport is initialized lazily inside useEffect
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
  const { channel, status, isLoading, open, send, close } = useChannel();
  const { myBalance } = useChannelBalance(channel);

  return (
    <>
      <p>{(myBalance / 10n ** 6n).toString()} USDC — {status}</p>

      {status === 'VOID'   && (
        <button disabled={isLoading} onClick={() => open([{ token: USDC, amount: 100n * 10n ** 6n }])}>
          Open channel
        </button>
      )}
      {status === 'ACTIVE' && (
        <>
          <button onClick={() => send({ amount: 10n * 10n ** 6n })}>Pay 10 USDC</button>
          <button onClick={close}>Close</button>
        </>
      )}
    </>
  );
}
```

→ [React Guide](docs/react-guide.md) — includes Next.js App Router setup

---

## Persistence

| Adapter | Environment | Install |
|---|---|---|
| `IndexedDBAdapter` | Browser | built-in |
| `LevelDBAdapter` | Node.js | `npm install level` |
| `MemoryAdapter` | Tests | built-in |

All adapters implement the same four-method interface: `save`, `loadLatest`, `listChannels`, `clear` — making custom adapters (Redis, Postgres, SQLite) straightforward.

→ [Persistence Guide](docs/persistence-guide.md)

---

## State machine

Every method maps to a valid FSM transition. Calling the wrong method in the wrong state throws `InvalidTransitionError` immediately — no silent failures.

```
VOID ──open()──▶ INITIAL ──▶ ACTIVE
                               │
                          send()  ──▶ ACTIVE  (loops)
                          checkpoint()  ──▶ ACTIVE
                               │
                    close() ◀──┤──▶ DISPUTE ──▶ (auto-respond)
                               │                      │
                             FINAL ◀──────────────────┘
                               │
                          withdraw()
                               │
                             VOID
```

→ [State Machine reference](docs/state-machine.md)

---

## Errors

All errors extend `NitroGuardError` and carry a `.code` string for programmatic handling.

```ts
import {
  InvalidTransitionError,    // method called in wrong state
  CoSignatureTimeoutError,   // ClearNode didn't respond in time
  NoPersistenceError,        // forceClose() when persistence store has no state for this channel
  ProtocolValidationError,   // payload failed Zod schema
  ProtocolTransitionError,   // transition guard rejected the state
  ChannelNotFoundError,      // restore() with unknown channelId
  ClearNodeUnreachableError, // WebSocket connection failed
} from 'nitroguard';
```

---

## Documentation

| | |
|---|---|
| [Quick Start](docs/quick-start.md) | Zero to a running channel in 5 minutes |
| [State Machine](docs/state-machine.md) | All states, transitions, and error handling |
| [Dispute Guide](docs/dispute-guide.md) | autoDispute, silence timeout, manual forceClose |
| [Persistence Guide](docs/persistence-guide.md) | Adapter selection and writing custom adapters |
| [Protocol Schemas](docs/protocol-schemas.md) | defineProtocol(), typed sends, transition guards |
| [React Guide](docs/react-guide.md) | Hooks reference, Next.js App Router setup |

---

<p align="center">
  <a href="https://yellow.com">
    <img src="https://img.shields.io/badge/Built%20for-Yellow%20Network-F5C518?style=flat-square&labelColor=000000" alt="Built for Yellow Network" />
  </a>
</p>

MIT © [Aayush Giri](https://github.com/Giri-Aayush)

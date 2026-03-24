<p>
  <img src="https://img.shields.io/badge/NitroGuard-Quick%20Start-F5C518?style=flat-square&labelColor=000000" />
</p>

# Quick Start

Zero to a running state channel in 5 minutes.

---

## Prerequisites

- Node.js 18+
- A wallet with ETH (gas) and USDC on Sepolia testnet
- A ClearNode URL — Yellow Network provides `wss://clearnet-sandbox.yellow.com/ws` for testing

---

## 1. Install

```bash
npm install nitroguard viem
```

---

## 2. Create a signer

NitroGuard accepts any object with `address`, `signTypedData`, and `signMessage`. A viem `WalletClient` works directly:

```ts
import { createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const wallet = createWalletClient({
  account,
  chain: sepolia,
  transport: http(process.env.RPC_URL),
});

const signer = {
  address:       account.address,
  signTypedData: (p) => wallet.signTypedData(p),
  signMessage:   (p) => wallet.signMessage(p),
};
```

---

## 3. Create a transport

NitroGuard communicates with ClearNode through a `ClearNodeTransport`. You bring your own — this keeps NitroGuard decoupled from any specific WebSocket library and lets you swap in a mock during tests.

**For production**, use Yellow Network's official transport package:

```bash
npm install yellow-ts
```

Check the [yellow-ts documentation](https://github.com/stevenzeiler/yellow-ts) for the exact adapter import and configuration.

**For local development and testing**, you can write a minimal auto-approving stub that satisfies the interface:

```ts
import type { ClearNodeTransport, SignedState } from 'nitroguard';

const CLEARNODE_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as `0x${string}`;

const transport: ClearNodeTransport = {
  isConnected: true,
  clearNodeAddress: CLEARNODE_ADDRESS,
  connect:    async () => {},
  disconnect: async () => {},
  openChannel:  async (_id, state) => ({ ...state, sigClearNode: '0x' as `0x${string}`, savedAt: Date.now() }),
  closeChannel: async (_id, state) => ({ ...state, sigClearNode: '0x' as `0x${string}`, savedAt: Date.now() }),
  proposeState: async (_id, state) => ({ ...state, sigClearNode: '0x' as `0x${string}`, savedAt: Date.now() }),
  onMessage: (_handler) => () => {},
};
```

The full `ClearNodeTransport` interface (from `nitroguard`):

```ts
import type { SignedState } from 'nitroguard';

interface ClearNodeTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly isConnected: boolean;
  readonly clearNodeAddress: `0x${string}`;
  proposeState(channelId: string, state: SignedState, timeoutMs: number): Promise<SignedState>;
  openChannel(channelId: string, state: SignedState, timeoutMs?: number): Promise<SignedState>;
  closeChannel(channelId: string, state: SignedState, timeoutMs?: number): Promise<SignedState>;
  onMessage(handler: (msg: unknown) => void): () => void;
}
```

---

## 4. Open a channel

```ts
import { NitroGuard } from 'nitroguard';
import { parseUnits } from 'viem';
import { sepolia } from 'viem/chains';

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'; // Sepolia testnet

const channel = await NitroGuard.open(
  {
    // The ClearNode URL is embedded in signed state so both parties reference the same endpoint.
    // The transport (from step 3) handles the actual WebSocket connection.
    clearnode: 'wss://clearnet-sandbox.yellow.com/ws',
    signer,
    chain:  sepolia,
    rpcUrl: process.env.RPC_URL,
    assets: [{ token: USDC, amount: parseUnits('10', 6) }],
  },
  transport, // from step 3
);

console.log(channel.status); // 'ACTIVE'
```

`NitroGuard.open()` handles the full handshake: connects to ClearNode, deposits assets, constructs the initial state, and waits for co-signatures from both parties. It resolves when the channel is `ACTIVE`.

---

## 5. Send off-chain updates

```ts
const RECIPIENT = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as `0x${string}`; // replace with real recipient

// Without a protocol, send() accepts any object — no runtime validation.
// See the Protocol Schemas guide to add type safety and validation.
await channel.send({ type: 'payment', to: RECIPIENT, amount: 1_000_000n }); // 1 USDC
await channel.send({ type: 'payment', to: RECIPIENT, amount: 500_000n });   // 0.5 USDC

console.log(channel.version); // 2

// Runtime stats
const m = channel.metrics();
console.log(m.messagesSent);  // 2
console.log(m.avgLatencyMs);  // e.g. 18
```

Each `send()` is instant and free — no gas, no block confirmation. Both parties co-sign each state update.

---

## 6. Close cooperatively

```ts
const result = await channel.close();

console.log(result.txHash);             // on-chain settlement transaction
console.log(result.finalState.version); // final version number
console.log(channel.status);            // 'FINAL'
```

---

## 7. Add persistence (recommended for production)

By default, NitroGuard uses an in-memory store (`MemoryAdapter`). `forceClose()` works fine during a session, but state is lost on process restart — so you can't recover after a crash. Use a durable adapter to survive restarts.

```bash
npm install level  # required for LevelDBAdapter
```

```ts
import { NitroGuard, LevelDBAdapter, CustodyClient } from 'nitroguard';
import { createWalletClient, http, parseUnits } from 'viem';
import { sepolia } from 'viem/chains';

// re-use the same constants defined in steps 2-4
const USDC          = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`; // Sepolia testnet
const CLEARNODE_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const RPC_URL       = process.env.RPC_URL as string;

const persistence = await LevelDBAdapter.create('./channel-db');

// CustodyClient is required for autoDispute and forceClose on-chain settlement
const custodyClient = new CustodyClient({
  rpcUrl:         RPC_URL,
  chain:          sepolia,
  custodyAddress: '0xYourCustodyContractAddress' as `0x${string}`,
  walletClient:   createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) }),
});

const channel = await NitroGuard.open(
  {
    clearnode: CLEARNODE_URL,
    signer,                    // from step 2
    chain:     sepolia,
    rpcUrl:    RPC_URL,
    assets:    [{ token: USDC, amount: parseUnits('10', 6) }],
    persistence,
    custodyClient,
    autoDispute: true,
  },
  transport,                   // from step 3
);

// Save channel.id somewhere durable (localStorage, DB) so you can restore after a restart
console.log('Save this:', channel.id);
```

After a restart (re-create `signer` and `transport` exactly as in steps 2–3, then):

```ts
import { NitroGuard, LevelDBAdapter } from 'nitroguard';
import { sepolia } from 'viem/chains';

// same signer and transport from steps 2-3 must be re-created
const CLEARNODE_URL  = 'wss://clearnet-sandbox.yellow.com/ws';
const RPC_URL        = process.env.RPC_URL as string;
const persistence    = await LevelDBAdapter.create('./channel-db');
const savedChannelId = '0x...'; // channel.id you saved before the restart

const channel = await NitroGuard.restore(
  savedChannelId,
  { clearnode: CLEARNODE_URL, signer, chain: sepolia, rpcUrl: RPC_URL, persistence },
  transport,
);
// channel.version === exactly where you left off
```

---

## Next

- [State Machine](state-machine.md) — all states, transitions, and error handling
- [Dispute Guide](dispute-guide.md) — how fund protection works
- [Persistence Guide](persistence-guide.md) — adapter selection and custom adapters
- [Protocol Schemas](protocol-schemas.md) — typed payloads with Zod
- [React Guide](react-guide.md) — hooks and Next.js setup

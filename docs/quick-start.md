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

For production, use the transport from `yellow-ts`:

```ts
import { ClearNodeTransport } from 'yellow-ts'; // Yellow Network's official client

const transport = new ClearNodeTransport('wss://clearnet-sandbox.yellow.com/ws', signer);
```

For tests, NitroGuard ships a `MockClearNode` transport — see the [testing examples](../test/integration/helpers/MockClearNode.ts).

The `ClearNodeTransport` interface you need to implement (if rolling your own):

```ts
import type { ClearNodeTransport } from 'nitroguard';

// Must implement:
// connect(): Promise<void>
// disconnect(): Promise<void>
// readonly isConnected: boolean
// readonly clearNodeAddress: `0x${string}`
// proposeState(channelId, state, timeoutMs): Promise<SignedState>
// openChannel(channelId, state, timeoutMs?): Promise<SignedState>
// closeChannel(channelId, state, timeoutMs?): Promise<SignedState>
// onMessage(handler): () => void
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
await channel.send({ type: 'payment', to: '0xBob...', amount: 1_000_000n }); // 1 USDC
await channel.send({ type: 'payment', to: '0xBob...', amount: 500_000n });   // 0.5 USDC

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

Without persistence, `forceClose()` has nothing to submit if ClearNode disappears.

```ts
import { NitroGuard, LevelDBAdapter } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

const channel = await NitroGuard.open(
  { ...config, persistence, custodyClient, autoDispute: true },
  transport,
);
```

After a restart:

```ts
const channel = await NitroGuard.restore(
  channelId,
  { clearnode, signer, chain, rpcUrl, persistence },
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

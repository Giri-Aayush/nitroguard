# Quick Start

Get your first state channel running in 5 minutes.

## Prerequisites

- Node.js 18+
- A wallet with some ETH (for gas) and USDC on Sepolia testnet
- A ClearNode URL (Yellow Network provides a public sandbox)

## 1. Install

```bash
npm install nitroguard viem @erc7824/nitrolite
```

## 2. Create a signer

NitroGuard works with any EIP-712 signer. The simplest is a viem `WalletClient`:

```typescript
import { createWalletClient, createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(process.env.RPC_URL),
});

const signer = {
  address: account.address,
  signTypedData: (params) => walletClient.signTypedData(params),
  signMessage: (params) => walletClient.signMessage(params),
};
```

## 3. Open a channel

```typescript
import { NitroGuard } from 'nitroguard';
import { parseUnits } from 'viem';
import { sepolia } from 'viem/chains';

const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

const channel = await NitroGuard.open({
  clearnode: 'wss://clearnet-sandbox.yellow.com/ws',
  signer,
  chain: sepolia,
  rpcUrl: process.env.RPC_URL,
  assets: [{ token: USDC_SEPOLIA, amount: parseUnits('10', 6) }], // 10 USDC
});

console.log('Channel open:', channel.id);
console.log('Status:', channel.status); // 'ACTIVE'
```

`NitroGuard.open()` connects to ClearNode, co-signs the opening state, and returns once the channel is in `ACTIVE` state.

## 4. Send off-chain updates

```typescript
// These are instant and free — no gas, no block confirmation
await channel.send({ type: 'payment', to: '0xBob...', amount: 1_000_000n }); // 1 USDC
await channel.send({ type: 'payment', to: '0xBob...', amount: 500_000n });   // 0.5 USDC

console.log('Version:', channel.version); // 2
```

Each `send()` produces a co-signed state update. Both parties agree on the new state.

## 5. Close cooperatively

```typescript
const result = await channel.close();

console.log('Settled. tx:', result.txHash);
console.log('Status:', channel.status); // 'FINAL'
```

`close()` asks ClearNode to co-sign the final state and submits it on-chain. Your funds are released.

## 6. Handle disconnection (optional)

Add persistence and automatic dispute handling so your funds are always safe:

```typescript
import { NitroGuard, LevelDBAdapter, CustodyClient } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

const channel = await NitroGuard.open({
  clearnode: 'wss://clearnet-sandbox.yellow.com/ws',
  signer,
  chain: sepolia,
  rpcUrl: process.env.RPC_URL,
  assets: [{ token: USDC_SEPOLIA, amount: parseUnits('10', 6) }],
  persistence,
  custodyClient,
  autoDispute: true,            // auto-respond to stale challenges
  clearnodeSilenceTimeout: 30_000, // force-close if ClearNode goes silent
});
```

If the process restarts, restore with:

```typescript
const channel = await NitroGuard.restore(channelId, {
  clearnode: '...',
  signer,
  chain: sepolia,
  rpcUrl: '...',
  persistence,
});

console.log('Restored at version:', channel.version);
```

## Next Steps

- [State Machine](state-machine.md) — understand all valid transitions
- [Dispute Guide](dispute-guide.md) — how fund protection works automatically
- [Protocol Schemas](protocol-schemas.md) — add typed payloads with Zod
- [React Guide](react-guide.md) — React hooks for your frontend

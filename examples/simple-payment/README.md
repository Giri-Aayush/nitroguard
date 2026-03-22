# Simple Payment Example

Opens a state channel, sends 3 off-chain payments, and closes cooperatively.

## Prerequisites

- Node.js 18+
- A Sepolia wallet with test ETH + test USDC
  - Get test ETH from a Sepolia faucet
  - Get test USDC from Circle's testnet faucet

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

Opening channel...
Channel ID: 0xabc...
Status: ACTIVE

Sending 3 payments...
  Payment 1 sent (version 1)
  Payment 2 sent (version 2)
  Payment 3 sent (version 3)

Closing channel...
Done!
  tx: 0xdef...
  final version: 3
  status: FINAL
```

## What this shows

- `NitroGuard.open()` connects to ClearNode and deposits 1 USDC
- `channel.send()` is instant and free — no gas, no block time
- `channel.close()` settles on-chain with a single transaction

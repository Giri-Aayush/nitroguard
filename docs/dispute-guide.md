# Dispute Guide

NitroGuard protects your funds automatically. This guide explains the two layers of protection: the `DisputeWatcher` (responds to stale challenges) and the `ClearNodeMonitor` (detects silence and triggers force-close).

## The Threat Model

State channels have two attack vectors:

1. **Stale challenge**: ClearNode (or your counterparty) submits an old state on-chain, hoping you don't notice and respond before the challenge window closes.
2. **ClearNode silence**: ClearNode stops responding — either it's down, or it's deliberately withholding co-signatures to freeze your funds.

NitroGuard addresses both automatically.

---

## Layer 1: DisputeWatcher

`DisputeWatcher` monitors on-chain events. When it sees a `ChallengeRegistered` event for one of your channels, it checks whether the challenged state is lower than your latest co-signed state. If so, it calls `checkpoint()` automatically to override the stale challenge.

### Enable with `autoDispute: true`

```typescript
const channel = await NitroGuard.open({
  clearnode: 'wss://...',
  signer,
  chain,
  rpcUrl,
  assets,
  persistence,
  custodyClient,   // required for on-chain ops
  autoDispute: true,
  onChallengeDetected: (channelId) => {
    console.log(`Challenge detected on ${channelId}`);
  },
  onFundsReclaimed: (channelId, amounts) => {
    console.log(`Funds recovered on ${channelId}:`, amounts);
  },
});
```

### Requirements

- `persistence` — must be provided (DisputeWatcher needs the latest co-signed state)
- `custodyClient` — required for on-chain `checkpoint()` calls
- `autoDispute: true` — opt-in

### What happens

```
ChallengeRegistered (stale state v3) detected
  ↓
DisputeWatcher checks: we have state v7 in persistence
  ↓
DisputeWatcher calls checkpoint(v7) on-chain
  ↓
On-chain logic: v7 > v3, challenge overridden
  ↓
onChallengeDetected callback fires
  ↓
Channel returns to ACTIVE (or closes to FINAL if it was the final state)
```

---

## Layer 2: ClearNodeMonitor

`ClearNodeMonitor` tracks the last time ClearNode responded. If it goes silent for longer than `clearnodeSilenceTimeout` milliseconds, it calls `forceClose()` automatically.

### Enable with `clearnodeSilenceTimeout`

```typescript
const channel = await NitroGuard.open({
  clearnode: 'wss://...',
  signer,
  chain,
  rpcUrl,
  assets,
  persistence,
  custodyClient,
  clearnodeSilenceTimeout: 30_000, // forceClose after 30 seconds of silence
});
```

Recommended values:
- **Production**: `60_000` (1 minute) — avoids false positives from brief network hiccups
- **Testing**: `5_000` (5 seconds) — fast response in test environments
- **High-stakes**: `15_000` (15 seconds) — balance between speed and false positives

### What happens

```
ClearNode last responded 30s ago (timeout reached)
  ↓
ClearNodeMonitor calls channel.forceClose()
  ↓
Latest co-signed state submitted on-chain as a challenge
  ↓
Channel.status → 'DISPUTE'
  ↓
Challenge period expires (minutes on testnet, ~1hr+ on mainnet)
  ↓
channel.withdraw() called automatically
  ↓
Channel.status → 'VOID', funds returned
```

---

## Manual Force Close

You can always call `forceClose()` yourself without waiting for the monitor:

```typescript
// ClearNode stopped responding — protect your funds immediately
if (channel.status === 'ACTIVE') {
  try {
    await channel.forceClose();
    console.log('Challenge submitted. Status:', channel.status); // 'DISPUTE'
  } catch (err) {
    if (err instanceof NoPersistenceError) {
      console.error('No saved state — cannot force close safely');
    }
  }
}
```

### `forceClose()` requires persistence

`forceClose()` loads the latest co-signed state from persistence and submits it on-chain. Without persistence, there's no state to submit, so it throws `NoPersistenceError`.

Always configure persistence in production:

```typescript
// Browser
const channel = await NitroGuard.open({
  ...,
  // persistence defaults to IndexedDBAdapter in browser environments
});

// Node.js
import { LevelDBAdapter } from 'nitroguard';
const persistence = await LevelDBAdapter.create('./channel-db');
const channel = await NitroGuard.open({ ..., persistence });
```

---

## Full Protection Setup

Here's the recommended production configuration:

```typescript
import { NitroGuard, LevelDBAdapter, CustodyClient } from 'nitroguard';
import { createWalletClient, createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const publicClient = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: mainnet, transport: http(RPC_URL) });

const custodyClient = new CustodyClient({
  publicClient,
  walletClient,
  custodyAddress: CUSTODY_ADDRESS[mainnet.id],
});

const persistence = await LevelDBAdapter.create('./channel-db');

const channel = await NitroGuard.open({
  clearnode: 'wss://clearnet.yellow.com/ws',
  signer,
  chain: mainnet,
  rpcUrl: RPC_URL,
  assets: [{ token: USDC, amount: 100n * 10n ** 6n }],
  persistence,
  custodyClient,
  autoDispute: true,
  clearnodeSilenceTimeout: 60_000,
  onChallengeDetected: (id) => alertOps(`Challenge on channel ${id}`),
  onFundsReclaimed: (id, amounts) => logRecovery(id, amounts),
});
```

This setup gives you:
- Every co-signed state saved to LevelDB
- Automatic response to any stale challenge within one block
- Automatic force-close if ClearNode goes silent for 60 seconds
- Alerting hooks for your monitoring system

---

## Error Reference

| Error | When |
|---|---|
| `NoPersistenceError` | `forceClose()` called with no persistence adapter configured |
| `CoSignatureTimeoutError` | ClearNode didn't respond to a state update within the timeout |
| `ClearNodeUnreachableError` | WebSocket connection to ClearNode failed |

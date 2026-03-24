<p>
  <img src="https://img.shields.io/badge/NitroGuard-Dispute%20Guide-F5C518?style=flat-square&labelColor=000000" />
</p>

# Dispute Guide

NitroGuard protects funds at two levels. Both are opt-in and composable.

---

## The threat model

State channels have two failure modes:

**Stale challenge** — ClearNode (or any counterparty) submits an old state on-chain. If you don't respond with a higher-version state before the challenge window closes, the stale state wins.

**ClearNode silence** — ClearNode stops responding. Without intervention, your funds are frozen until you manually submit a challenge. With NitroGuard, this happens automatically.

---

## Layer 1 — DisputeWatcher

`DisputeWatcher` watches on-chain `ChallengeRegistered` events. When a challenge is detected for one of your channels, it compares the challenged version against your latest persisted state. If yours is higher, it calls `checkpoint()` on-chain immediately.

**Enable with `autoDispute: true`:**

```ts
const channel = await NitroGuard.open(
  {
    clearnode, signer, chain, rpcUrl, assets,
    persistence,
    custodyClient,
    autoDispute: true,
    onChallengeDetected: (id)       => console.log(`Challenge on ${id}`),
    onFundsReclaimed:    (id, amts) => console.log('Recovered', amts),
  },
  transport,
);
```

**Requirements:**
- `persistence` — must be configured (DisputeWatcher reads your latest co-signed state from it)
- `custodyClient` — required to call `checkpoint()` on-chain

**What happens:**

```
ChallengeRegistered (version 3) detected on-chain
  → DisputeWatcher loads persisted state (version 10)
  → checkpoint(version 10) submitted
  → version 10 > 3: challenge overridden
  → onChallengeDetected fires
  → channel remains ACTIVE
```

---

## Layer 2 — ClearNodeMonitor

`ClearNodeMonitor` tracks the timestamp of the last message received from ClearNode. If no messages arrive within `clearnodeSilenceTimeout` ms, it calls `channel.forceClose()` automatically.

**Enable with `clearnodeSilenceTimeout`:**

```ts
const channel = await NitroGuard.open(
  { ...config, clearnodeSilenceTimeout: 60_000 },
  transport,
);
```

**Recommended values:**

| Use case | Value |
|---|---|
| Production | `60_000` — avoids false positives from network hiccups |
| High-stakes | `15_000` — faster recovery, slightly more sensitive |
| Testing | `5_000` — fast feedback in development |

**What happens:**

```
No message from ClearNode for 60s
  → channel.forceClose() called automatically
  → latest co-signed state submitted on-chain as a challenge
  → channel.status → 'DISPUTE'
  → challenge window expires
  → withdraw() called automatically
  → channel.status → 'VOID', funds returned
```

---

## Manual force close

You can always call `forceClose()` yourself:

```ts
import { NoPersistenceError } from 'nitroguard';

try {
  await channel.forceClose();
  console.log(channel.status); // 'DISPUTE' or 'FINAL'
} catch (err) {
  if (err instanceof NoPersistenceError) {
    // Persistence store has no saved state for this channel.
    // This can happen if persistence.clear() was called manually,
    // or if the channel object was created without going through
    // NitroGuard.open() / NitroGuard.restore().
  }
}
```

`forceClose()` requires at least one co-signed state in persistence. NitroGuard always saves the opening state automatically — this error only occurs if the persistence store was manually cleared or the channel was never properly opened.

---

## Recommended production setup

```ts
import { NitroGuard, LevelDBAdapter, CustodyClient } from 'nitroguard';
import { createWalletClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const walletClient = createWalletClient({ account, chain: mainnet, transport: http(RPC_URL) });

const custodyClient = new CustodyClient({
  rpcUrl:         RPC_URL,
  chain:          mainnet,
  custodyAddress: '0xYourCustodyContractAddress' as `0x${string}`,
  walletClient,
});

const persistence = await LevelDBAdapter.create('./channel-db');

const channel = await NitroGuard.open(
  {
    clearnode: 'wss://clearnet.yellow.com/ws',
    signer,
    chain: mainnet,
    rpcUrl: RPC_URL,
    assets: [{ token: USDC, amount: 100n * 10n ** 6n }],
    persistence,
    custodyClient,
    autoDispute:             true,
    clearnodeSilenceTimeout: 60_000,
    onChallengeDetected: (id)       => alertOps(`Challenge detected: ${id}`),
    onFundsReclaimed:    (id, amts) => logRecovery(id, amts),
  },
  transport,
);
```

This gives you:
- Every co-signed state persisted to LevelDB
- Automatic challenge response within one block
- Automatic force-close if ClearNode goes silent for 60s

---

## Error reference

| Error | When |
|---|---|
| `NoPersistenceError` | `forceClose()` called but persistence store has no saved state for this channel |
| `CoSignatureTimeoutError` | ClearNode didn't respond to a state update |
| `ClearNodeUnreachableError` | WebSocket connection to ClearNode failed |

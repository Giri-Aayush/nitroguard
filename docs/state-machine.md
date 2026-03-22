<p>
  <img src="https://img.shields.io/badge/NitroGuard-State%20Machine-F5C518?style=flat-square&labelColor=000000" />
</p>

# State Machine

NitroGuard enforces a deterministic FSM over every channel. Every method is a valid transition. Every invalid call throws `InvalidTransitionError` immediately — no silent failures, no unexpected on-chain reverts.

---

## States

| State | Meaning |
|---|---|
| `VOID` | Channel does not exist (or has been fully withdrawn) |
| `INITIAL` | Channel opened locally; waiting for ClearNode co-signature on the funding state |
| `ACTIVE` | Both parties co-signed; off-chain updates flowing |
| `DISPUTE` | Challenge submitted on-chain; timer running |
| `FINAL` | Channel finalized; funds are withdrawable |

---

## Diagram

```
VOID ──open()──▶ INITIAL ──▶ ACTIVE
                               │
                          send()  ──▶ ACTIVE  (loops, version++)
                          checkpoint()  ──▶ ACTIVE
                               │
                    close() ◀──┤──▶ DISPUTE
                               │       │
                             FINAL ◀───┘  (auto-respond or window expires)
                               │
                          withdraw()
                               │
                             VOID
```

---

## Methods

### `NitroGuard.open(config)` — `VOID → ACTIVE`

Connects to ClearNode, deposits assets, and co-signs the funding state. Returns once the channel is `ACTIVE`.

Throws `ClearNodeUnreachableError` if the WebSocket connection fails.

---

### `channel.send(payload)` — `ACTIVE → ACTIVE`

Sends an off-chain state update. Version increments by one on each confirmed send.

```ts
await channel.send({ amount: 10n });
console.log(channel.version); // 1

await channel.send({ amount: 5n });
console.log(channel.version); // 2
```

Throws `InvalidTransitionError` if not `ACTIVE`.  
Throws `CoSignatureTimeoutError` if ClearNode doesn't respond within the configured timeout (default 5s).  
Rolls back the version counter automatically on timeout.

---

### `channel.close()` — `ACTIVE → FINAL`

Requests ClearNode to co-sign the final state and submits the mutual close on-chain.

```ts
const result = await channel.close();
// result.txHash  — settlement transaction
// result.version — final version number
```

Throws `CoSignatureTimeoutError` if ClearNode doesn't respond. In that case, call `forceClose()`.

---

### `channel.forceClose()` — `ACTIVE → DISPUTE → FINAL`

Submits the latest co-signed state as an on-chain challenge. Waits for the challenge period to expire, then withdraws.

```ts
await channel.forceClose();
// channel transitions: ACTIVE → DISPUTE → FINAL
```

Throws `NoPersistenceError` if no persisted state exists (nothing to submit on-chain).  
Requires `custodyClient` in the open config.

---

### `channel.checkpoint()` — `ACTIVE → ACTIVE`

Anchors the current version on-chain. Any future challenge must use a version higher than the checkpoint — stale challenges are rejected.

```ts
const result = await channel.checkpoint();
// result.txHash   — checkpoint transaction
// result.version  — the version that was anchored
```

Call this periodically on high-value channels to shrink the attack surface.

---

### `channel.withdraw()` — `FINAL → VOID`

Releases funds to your wallet after the channel reaches `FINAL` state.

```ts
await channel.withdraw();
// channel.status === 'VOID'
```

---

### `NitroGuard.restore(channelId, config)` — persisted `ACTIVE → ACTIVE`

Resumes a channel after restart. Reconnects to ClearNode and verifies version consistency.

```ts
const channel = await NitroGuard.restore(channelId, {
  clearnode, signer, chain, rpcUrl, persistence,
});
console.log(channel.version); // picks up exactly where you left off
```

Throws `ChannelNotFoundError` if no state is found in persistence for the given `channelId`.

---

## Invalid transition example

```ts
import { InvalidTransitionError } from 'nitroguard';

const channel = await NitroGuard.open({ ... });
// channel.status === 'ACTIVE'

try {
  await channel.withdraw(); // wrong state
} catch (err) {
  if (err instanceof InvalidTransitionError) {
    console.log(err.message);
    // "Cannot call withdraw() in state ACTIVE. Expected: FINAL"
    console.log(err.from);   // 'ACTIVE'
    console.log(err.method); // 'withdraw'
  }
}
```

---

## Transition table

| From | Method | To | On-chain |
|---|---|---|---|
| `VOID` | `open()` | `ACTIVE` | deposit + create |
| `ACTIVE` | `send()` | `ACTIVE` | — |
| `ACTIVE` | `checkpoint()` | `ACTIVE` | checkpoint |
| `ACTIVE` | `close()` | `FINAL` | mutual close |
| `ACTIVE` | `forceClose()` | `DISPUTE` | challenge |
| `DISPUTE` | (auto-respond) | `ACTIVE` | respond |
| `DISPUTE` | (window expires) | `FINAL` | — |
| `FINAL` | `withdraw()` | `VOID` | withdraw |
| persisted `ACTIVE` | `restore()` | `ACTIVE` | — |

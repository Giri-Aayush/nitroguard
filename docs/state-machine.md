# State Machine

NitroGuard enforces a strict finite state machine (FSM) on every channel. Calling a method in the wrong state throws `InvalidTransitionError` immediately — no silent failures.

## States

| State | Meaning |
|---|---|
| `VOID` | Channel doesn't exist yet (or has been fully settled and withdrawn) |
| `INITIAL` | Channel opened locally; waiting for ClearNode co-signature |
| `ACTIVE` | Both parties have signed; off-chain updates are flowing |
| `DISPUTE` | A challenge has been submitted on-chain; waiting for resolution |
| `FINAL` | Channel finalized — funds can be withdrawn |

## Transitions

```
VOID ──open()──► INITIAL ──(ClearNode co-signs)──► ACTIVE
                                                    │  │  │
                                              send()│  │  checkpoint()
                                               (loop)│  │  (ACTIVE→ACTIVE)
                                                    │  │
                                        close() ◄───┘  └───► DISPUTE
                                          │                     │
                                          ▼                     │ (auto-respond or
                                        FINAL ◄─────────────────┘  forceClose completes)
                                          │
                                    withdraw()
                                          │
                                          ▼
                                        VOID
```

## Methods and Valid States

### `NitroGuard.open(config)`
- **From**: `VOID`
- **To**: `ACTIVE` (after ClearNode co-signs)
- **Throws**: `ClearNodeUnreachableError` if WS connection fails

### `channel.send(payload)`
- **From**: `ACTIVE`
- **To**: `ACTIVE` (version incremented)
- **Throws**: `InvalidTransitionError` if not ACTIVE, `CoSignatureTimeoutError` if ClearNode doesn't respond

```typescript
// Version increments with each send
expect(channel.version).toBe(0); // after open
await channel.send({ amount: 10n });
expect(channel.version).toBe(1);
await channel.send({ amount: 5n });
expect(channel.version).toBe(2);
```

### `channel.close()`
- **From**: `ACTIVE`
- **To**: `FINAL`
- **Throws**: `InvalidTransitionError` if not ACTIVE, `CoSignatureTimeoutError` if ClearNode doesn't co-sign the close

```typescript
const result = await channel.close();
// result.txHash — the on-chain settlement transaction
// result.version — the final version number
```

### `channel.forceClose()`
- **From**: `ACTIVE`
- **To**: `DISPUTE` → `FINAL` (after challenge period)
- **Throws**: `InvalidTransitionError` if not ACTIVE, `NoPersistenceError` if no saved state

Use `forceClose()` when ClearNode is unresponsive. It submits the latest co-signed state on-chain as a challenge, then waits for the challenge period to expire before withdrawing.

```typescript
// Transitions immediately to DISPUTE while waiting for challenge window
await channel.forceClose();
// Channel is now FINAL (after challenge period — can be minutes to hours on mainnet)
```

### `channel.checkpoint()`
- **From**: `ACTIVE`
- **To**: `ACTIVE` (state unchanged, but anchored on-chain)
- **Throws**: `InvalidTransitionError` if not ACTIVE

Checkpointing submits the current state on-chain without closing. If someone later submits a stale challenge, your checkpoint defeats it.

```typescript
const result = await channel.checkpoint();
// result.txHash — the checkpoint transaction
// result.version — the version that was anchored
```

### `channel.withdraw()`
- **From**: `FINAL`
- **To**: `VOID`
- **Throws**: `InvalidTransitionError` if not FINAL

```typescript
await channel.withdraw();
// Funds transferred to your wallet
```

### `NitroGuard.restore(channelId, config)`
- **From**: persisted `ACTIVE` state
- **To**: `ACTIVE`
- **Throws**: `ChannelNotFoundError` if channelId not in persistence

## Invalid Transition Handling

```typescript
import { InvalidTransitionError } from 'nitroguard';

const channel = await NitroGuard.open({ ... });
// channel.status === 'ACTIVE'

try {
  await channel.withdraw(); // Wrong state!
} catch (err) {
  if (err instanceof InvalidTransitionError) {
    console.log(err.message);
    // "Cannot call withdraw() in state ACTIVE. Expected: FINAL"
    console.log(err.from);    // 'ACTIVE'
    console.log(err.method);  // 'withdraw'
  }
}
```

## Persistence and State Reconstruction

With a persistence adapter, channel state survives process restarts:

```typescript
import { NitroGuard, LevelDBAdapter } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./db');

// First run
const ch = await NitroGuard.open({ ..., persistence });
await ch.send({ note: 'hello' }); // version = 1
const id = ch.id;

// Process restarts...

// Second run — restore to version 1
const restored = await NitroGuard.restore(id, { ..., persistence });
console.log(restored.version); // 1
```

NitroGuard stores every co-signed state. If you're ever in `DISPUTE`, it uses the highest-version co-signed state to maximize recovery.

# Persistence Guide

NitroGuard saves every co-signed state so your channel can survive process restarts, tab refreshes, and network partitions. This guide covers adapter selection and how to write a custom one.

## Why Persistence Matters

Without persistence:
- `NitroGuard.restore()` has nothing to load from
- `forceClose()` throws `NoPersistenceError` (no state to submit on-chain)
- `DisputeWatcher` can't respond to stale challenges

With persistence:
- Every co-signed state is saved immediately after receiving ClearNode's signature
- On restart, you can resume from the exact version you left off
- `forceClose()` always has the highest-version state ready to submit

---

## Choosing an Adapter

| Environment | Adapter | When to use |
|---|---|---|
| Browser | `IndexedDBAdapter` | Web apps — uses the browser's built-in IndexedDB |
| Node.js | `LevelDBAdapter` | Servers, CLI tools, Electron — requires `npm install level` |
| Tests | `MemoryAdapter` | Unit and integration tests — no disk I/O, always clean |

### IndexedDBAdapter (Browser)

Default in browser environments. No setup required:

```typescript
import { NitroGuard, IndexedDBAdapter } from 'nitroguard';

// Explicit
const persistence = new IndexedDBAdapter('nitroguard-db');

const channel = await NitroGuard.open({
  ...,
  persistence,
});
```

Data is stored under the key `nitroguard-db` in IndexedDB. Survives tab refreshes and browser restarts. Cleared by `localStorage.clear()` or clearing site data.

### LevelDBAdapter (Node.js)

```bash
npm install level
```

```typescript
import { NitroGuard, LevelDBAdapter } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./my-channel-db');

const channel = await NitroGuard.open({
  ...,
  persistence,
});
```

`LevelDBAdapter.create(path)` opens (or creates) a LevelDB database at the given path. Data survives process restarts.

Close the database when your process exits:

```typescript
process.on('SIGINT', async () => {
  await persistence.close();
  process.exit(0);
});
```

### MemoryAdapter (Tests)

```typescript
import { NitroGuard, MemoryAdapter } from 'nitroguard';

const persistence = new MemoryAdapter();

const channel = await NitroGuard.open({
  ...,
  persistence,
});
```

In-memory only. Each `MemoryAdapter` instance starts empty. Ideal for tests where you want isolation between test cases.

---

## Restoring a Channel

After a restart, restore with the same persistence adapter and `channelId`:

```typescript
import { NitroGuard, LevelDBAdapter } from 'nitroguard';
import { ChannelNotFoundError } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

try {
  const channel = await NitroGuard.restore(savedChannelId, {
    clearnode: 'wss://...',
    signer,
    chain,
    rpcUrl,
    persistence,
  });

  console.log('Resumed at version:', channel.version);
  console.log('Status:', channel.status);
} catch (err) {
  if (err instanceof ChannelNotFoundError) {
    console.log('Channel not in persistence — was it opened with a different db?');
  }
}
```

`restore()` reconnects to ClearNode, loads the latest state from persistence, and re-establishes the co-signing session. The channel is returned in `ACTIVE` state at the correct version.

---

## Listing Stored Channels

If you don't know which `channelId` to restore, list all stored channels:

```typescript
const channelIds = await persistence.listChannels();
// ['0xabc...', '0xdef...']

// Restore the most recent one (or show a picker UI)
const channel = await NitroGuard.restore(channelIds[0], { ..., persistence });
```

In React:

```typescript
import { useAllChannels } from 'nitroguard/react';

function ChannelPicker() {
  const channelIds = useAllChannels();
  return (
    <ul>
      {channelIds.map(id => <li key={id}>{id}</li>)}
    </ul>
  );
}
```

---

## Writing a Custom Adapter

Any object implementing the `PersistenceAdapter` interface works:

```typescript
import type { PersistenceAdapter, SignedState } from 'nitroguard';

export class MyCustomAdapter implements PersistenceAdapter {
  // Save a co-signed state. Called after every successful channel.send().
  async saveState(channelId: string, state: SignedState): Promise<void> {
    // persist state.version, state.data, state.sigs, etc.
  }

  // Load the latest saved state for a channel.
  async loadLatestState(channelId: string): Promise<SignedState | null> {
    // return null if not found
  }

  // List all channelIds that have saved state.
  async listChannels(): Promise<string[]> {
    // return array of channelIds
  }

  // Delete all state for a channel (called after FINAL + withdraw).
  async clearChannel(channelId: string): Promise<void> {
    // cleanup
  }
}
```

### Example: Redis Adapter

```typescript
import type { PersistenceAdapter, SignedState } from 'nitroguard';
import { Redis } from 'ioredis';

export class RedisAdapter implements PersistenceAdapter {
  constructor(private readonly redis: Redis, private readonly prefix = 'ng:') {}

  async saveState(channelId: string, state: SignedState): Promise<void> {
    await this.redis.set(
      `${this.prefix}${channelId}`,
      JSON.stringify(state, (_k, v) => typeof v === 'bigint' ? v.toString() + 'n' : v),
    );
    await this.redis.sadd(`${this.prefix}channels`, channelId);
  }

  async loadLatestState(channelId: string): Promise<SignedState | null> {
    const raw = await this.redis.get(`${this.prefix}${channelId}`);
    if (!raw) return null;
    return JSON.parse(raw, (_k, v) =>
      typeof v === 'string' && v.endsWith('n') ? BigInt(v.slice(0, -1)) : v,
    );
  }

  async listChannels(): Promise<string[]> {
    return this.redis.smembers(`${this.prefix}channels`);
  }

  async clearChannel(channelId: string): Promise<void> {
    await this.redis.del(`${this.prefix}${channelId}`);
    await this.redis.srem(`${this.prefix}channels`, channelId);
  }
}
```

Then use it:

```typescript
import { Redis } from 'ioredis';
const persistence = new RedisAdapter(new Redis());

const channel = await NitroGuard.open({ ..., persistence });
```

---

## Serialization Note

`SignedState` contains `bigint` values (amounts, allocations). If your persistence layer serializes to JSON, use a bigint-aware serializer — the example above shows one approach. NitroGuard's built-in adapters handle this automatically.

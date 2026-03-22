<p>
  <img src="https://img.shields.io/badge/NitroGuard-Persistence%20Guide-F5C518?style=flat-square&labelColor=000000" />
</p>

# Persistence Guide

NitroGuard saves every co-signed state so channels survive process restarts, page refreshes, and network partitions. Without persistence, `forceClose()` has nothing to submit on-chain if ClearNode disappears.

---

## Choosing an adapter

| Adapter | Environment | Install |
|---|---|---|
| `IndexedDBAdapter` | Browser | built-in |
| `LevelDBAdapter` | Node.js | `npm install level` |
| `MemoryAdapter` | Tests | built-in |

### IndexedDBAdapter

Default in browser environments. Uses the browser's built-in IndexedDB — survives tab refreshes and browser restarts, cleared only when the user wipes site data.

```ts
import { IndexedDBAdapter } from 'nitroguard';

const persistence = new IndexedDBAdapter('nitroguard-v1');

const channel = await NitroGuard.open({ ...config, persistence });
```

### LevelDBAdapter

```bash
npm install level
```

```ts
import { LevelDBAdapter } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

const channel = await NitroGuard.open({ ...config, persistence });

// Close before process exit
process.on('SIGINT', async () => {
  await persistence.close();
  process.exit(0);
});
```

Every `save()` is flushed to disk before resolving — no buffered writes that could be lost on crash.

### MemoryAdapter

In-memory only. Use in tests where you want a clean state per test case.

```ts
import { MemoryAdapter } from 'nitroguard';

const persistence = new MemoryAdapter();
const channel = await NitroGuard.open({ ...config, persistence });
```

---

## Restoring a channel

```ts
import { NitroGuard, LevelDBAdapter, ChannelNotFoundError } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

try {
  const channel = await NitroGuard.restore(savedChannelId, {
    clearnode, signer, chain, rpcUrl, persistence,
  });

  console.log('version:', channel.version);
  console.log('status:', channel.status);
} catch (err) {
  if (err instanceof ChannelNotFoundError) {
    // No state found — channel was opened with a different db path, or never persisted
  }
}
```

---

## Listing stored channels

```ts
const channelIds = await persistence.listChannels();
// ['0xabc...', '0xdef...']

const channel = await NitroGuard.restore(channelIds[0], { ...config, persistence });
```

In React:

```ts
import { useAllChannels } from 'nitroguard/react';

function ChannelPicker() {
  const channelIds = useAllChannels();
  return <ul>{channelIds.map(id => <li key={id}>{id.slice(0, 12)}…</li>)}</ul>;
}
```

---

## Writing a custom adapter

Implement four methods:

```ts
import type { PersistenceAdapter, SignedState } from 'nitroguard';

export class MyAdapter implements PersistenceAdapter {
  async save(channelId: string, state: SignedState): Promise<void> {
    // called after every successful channel.send()
  }

  async loadLatest(channelId: string): Promise<SignedState | null> {
    // return null if not found
  }

  async listChannels(): Promise<string[]> {
    // return all channelIds with saved state
  }

  async clear(channelId: string): Promise<void> {
    // called after FINAL + withdraw()
  }
}
```

**Serialization note:** `SignedState` contains `bigint` fields (amounts, allocations). If your storage layer uses JSON, handle bigint explicitly:

```ts
// serialize
JSON.stringify(state, (_, v) => typeof v === 'bigint' ? { __bigint: v.toString() } : v)

// deserialize
JSON.parse(raw, (_, v) => v?.__bigint !== undefined ? BigInt(v.__bigint) : v)
```

**Redis example:**

```ts
import type { PersistenceAdapter, SignedState } from 'nitroguard';
import { Redis } from 'ioredis';

export class RedisAdapter implements PersistenceAdapter {
  constructor(private redis: Redis, private prefix = 'ng:') {}

  async save(channelId: string, state: SignedState) {
    await this.redis.set(
      `${this.prefix}${channelId}`,
      JSON.stringify(state, (_, v) => typeof v === 'bigint' ? { __bigint: v.toString() } : v),
    );
    await this.redis.sadd(`${this.prefix}channels`, channelId);
  }

  async loadLatest(channelId: string): Promise<SignedState | null> {
    const raw = await this.redis.get(`${this.prefix}${channelId}`);
    if (!raw) return null;
    return JSON.parse(raw, (_, v) => v?.__bigint !== undefined ? BigInt(v.__bigint) : v);
  }

  async listChannels() {
    return this.redis.smembers(`${this.prefix}channels`);
  }

  async clear(channelId: string) {
    await this.redis.del(`${this.prefix}${channelId}`);
    await this.redis.srem(`${this.prefix}channels`, channelId);
  }
}
```

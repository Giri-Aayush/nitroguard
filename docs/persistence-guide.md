<p>
  <img src="https://img.shields.io/badge/NitroGuard-Persistence%20Guide-F5C518?style=flat-square&labelColor=000000" />
</p>

# Persistence Guide

NitroGuard saves every co-signed state so channels survive process restarts, page refreshes, and network partitions. By default it uses an in-memory store (`MemoryAdapter`) — sufficient for development, but state is lost on restart. For production, configure a durable adapter so `forceClose()` can submit your latest state even after a crash.

---

## Choosing an adapter

| Adapter | Environment | Install |
|---|---|---|
| `IndexedDBAdapter` | Browser | built-in |
| `LevelDBAdapter` | Node.js | `npm install level` |
| `MemoryAdapter` | Tests | built-in |

### IndexedDBAdapter

Recommended for browser environments. Uses the browser's built-in IndexedDB — survives tab refreshes and browser restarts, cleared only when the user wipes site data. Pass it explicitly via the `persistence` option (NitroGuard defaults to `MemoryAdapter` if none is provided).

```ts
import { IndexedDBAdapter } from 'nitroguard';

const persistence = new IndexedDBAdapter('nitroguard-v1');

const channel = await NitroGuard.open({ ...config, persistence }, transport);
```

### LevelDBAdapter

```bash
npm install level
```

```ts
import { LevelDBAdapter } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

const channel = await NitroGuard.open({ ...config, persistence }, transport);

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
const channel = await NitroGuard.open({ ...config, persistence }, transport);
```

---

## Restoring a channel

```ts
import { NitroGuard, LevelDBAdapter, ChannelNotFoundError } from 'nitroguard';

const persistence = await LevelDBAdapter.create('./channel-db');

try {
  const channel = await NitroGuard.restore(savedChannelId, { clearnode, signer, chain, rpcUrl, persistence }, transport);

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

const channel = await NitroGuard.restore(channelIds[0], { ...config, persistence }, transport);
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
    // return the state with the highest version, or null if not found
  }

  async load(channelId: string, version: number): Promise<SignedState | null> {
    // return the state at the given version, or null if not found
  }

  async loadAll(channelId: string): Promise<SignedState[]> {
    // return all states for the channel, sorted by version ascending
  }

  async listChannels(): Promise<string[]> {
    // return all channelIds with at least one saved state
  }

  async clear(channelId: string): Promise<void> {
    // called after FINAL + withdraw() — remove all states for this channel
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

  private serialize(state: SignedState) {
    return JSON.stringify(state, (_, v) => typeof v === 'bigint' ? { __bigint: v.toString() } : v);
  }
  private deserialize(raw: string): SignedState {
    return JSON.parse(raw, (_, v) => v?.__bigint !== undefined ? BigInt(v.__bigint) : v);
  }

  async save(channelId: string, state: SignedState) {
    const pipe = this.redis.pipeline();
    // store latest under main key
    pipe.set(`${this.prefix}${channelId}`, this.serialize(state));
    // store per-version for load(version) and loadAll()
    pipe.set(`${this.prefix}${channelId}:v${state.version}`, this.serialize(state));
    pipe.sadd(`${this.prefix}channels`, channelId);
    await pipe.exec();
  }

  async loadLatest(channelId: string): Promise<SignedState | null> {
    const raw = await this.redis.get(`${this.prefix}${channelId}`);
    return raw ? this.deserialize(raw) : null;
  }

  async load(channelId: string, version: number): Promise<SignedState | null> {
    const raw = await this.redis.get(`${this.prefix}${channelId}:v${version}`);
    return raw ? this.deserialize(raw) : null;
  }

  async loadAll(channelId: string): Promise<SignedState[]> {
    const keys = await this.redis.keys(`${this.prefix}${channelId}:v*`);
    if (!keys.length) return [];
    const raws = await this.redis.mget(...keys);
    return (raws.filter(Boolean) as string[])
      .map(r => this.deserialize(r))
      .sort((a, b) => a.version - b.version);
  }

  async listChannels() {
    return this.redis.smembers(`${this.prefix}channels`);
  }

  async clear(channelId: string) {
    const keys = await this.redis.keys(`${this.prefix}${channelId}*`);
    if (keys.length) await this.redis.del(...keys);
    await this.redis.srem(`${this.prefix}channels`, channelId);
  }
}
```

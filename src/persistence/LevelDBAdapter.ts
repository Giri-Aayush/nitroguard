import type { SignedState } from '../channel/types.js';
import type { PersistenceAdapter } from './PersistenceAdapter.js';

/**
 * Key layout: `${channelId}:${version.toString().padStart(10, '0')}`
 *
 * Zero-padded version makes keys lexicographically sortable.
 * Iterator with `reverse: true, limit: 1` retrieves the highest version
 * in O(log n).
 */
function makeKey(channelId: string, version: number): string {
  return `${channelId}:${version.toString().padStart(10, '0')}`;
}

// ─── bigint-safe JSON ─────────────────────────────────────────────────────────
// JSON.stringify/parse cannot handle bigint natively.
// We encode bigint as { __bigint: "<decimal string>" } and reverse on parse.

function serialize(state: SignedState): string {
  return JSON.stringify(state, (_, v) =>
    typeof v === 'bigint' ? { __bigint: v.toString() } : v,
  );
}

function deserialize(raw: string): SignedState {
  return JSON.parse(raw, (_, v) => {
    if (v !== null && typeof v === 'object' && '__bigint' in v) {
      return BigInt(v.__bigint as string);
    }
    return v;
  }) as SignedState;
}

// ─── Minimal LevelDB interface (structural) ───────────────────────────────────

interface LevelInstance {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  del(key: string): Promise<void>;
  iterator(options: {
    gte?: string;
    lte?: string;
    reverse?: boolean;
    limit?: number;
  }): AsyncIterableIterator<[string, string]>;
  close(): Promise<void>;
}

/**
 * Node.js LevelDB persistence adapter.
 *
 * Requires the `level` package as an optional peer dependency:
 * ```
 * npm install level
 * ```
 *
 * Uses a static async factory method because the DB open is asynchronous:
 * ```ts
 * const adapter = await LevelDBAdapter.create('./nitroguard-state');
 * ```
 *
 * Data survives process restart — every `save()` is flushed to disk before
 * resolving (LevelDB's `put()` calls fsync internally).
 *
 * Phase 2 default for Node.js server environments.
 */
export class LevelDBAdapter implements PersistenceAdapter {
  private constructor(private readonly _db: LevelInstance) {}

  /**
   * Open (or create) a LevelDB database at `dbPath`.
   *
   * Throws a descriptive error if the `level` package is not installed.
   */
  static async create(dbPath = './nitroguard-state'): Promise<LevelDBAdapter> {
    let LevelModule: { Level: new (path: string, opts: { valueEncoding: string }) => LevelInstance };
    try {
      LevelModule = await import('level') as typeof LevelModule;
    } catch {
      throw new Error(
        "LevelDBAdapter requires the 'level' package. " +
        "Install it with: npm install level",
      );
    }

    const db = new LevelModule.Level(dbPath, { valueEncoding: 'utf8' });
    // Trigger open
    await db.put('__nitroguard_init__', '1');
    return new LevelDBAdapter(db);
  }

  async save(channelId: string, state: SignedState): Promise<void> {
    await this._db.put(makeKey(channelId, state.version), serialize(state));
  }

  async loadLatest(channelId: string): Promise<SignedState | null> {
    const prefix = `${channelId}:`;
    const upper = `${channelId}:\xff`;

    for await (const [, value] of this._db.iterator({ gte: prefix, lte: upper, reverse: true, limit: 1 })) {
      return deserialize(value);
    }
    return null;
  }

  async load(channelId: string, version: number): Promise<SignedState | null> {
    const raw = await this._db.get(makeKey(channelId, version));
    return raw ? deserialize(raw) : null;
  }

  async loadAll(channelId: string): Promise<SignedState[]> {
    const prefix = `${channelId}:`;
    const upper = `${channelId}:\xff`;
    const results: SignedState[] = [];

    for await (const [, value] of this._db.iterator({ gte: prefix, lte: upper })) {
      results.push(deserialize(value));
    }

    // Already in ascending order due to key layout
    return results;
  }

  async listChannels(): Promise<string[]> {
    const seen = new Set<string>();
    for await (const [key] of this._db.iterator({})) {
      if (key === '__nitroguard_init__') continue;
      const colonIdx = key.indexOf(':');
      if (colonIdx !== -1) {
        seen.add(key.slice(0, colonIdx));
      }
    }
    return [...seen];
  }

  async clear(channelId: string): Promise<void> {
    const prefix = `${channelId}:`;
    const upper = `${channelId}:\xff`;
    const keysToDelete: string[] = [];

    for await (const [key] of this._db.iterator({ gte: prefix, lte: upper })) {
      keysToDelete.push(key);
    }

    for (const key of keysToDelete) {
      await this._db.del(key);
    }
  }

  /** Close the database — must be called before process exit. */
  async close(): Promise<void> {
    await this._db.close();
  }
}

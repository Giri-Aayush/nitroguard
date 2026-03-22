import type { SignedState } from '../channel/types.js';
import type { PersistenceAdapter } from './PersistenceAdapter.js';

/**
 * In-memory persistence adapter.
 *
 * Safe for tests and sandbox use. Data is lost on process restart.
 * This is the default adapter for Phase 1.
 *
 * Phase 2 replaces this with IndexedDBAdapter (browser) and
 * LevelDBAdapter (Node) as production defaults.
 */
export class MemoryAdapter implements PersistenceAdapter {
  // channelId → (version → SignedState)
  private readonly store = new Map<string, Map<number, SignedState>>();

  async save(channelId: string, state: SignedState): Promise<void> {
    let channel = this.store.get(channelId);
    if (!channel) {
      channel = new Map();
      this.store.set(channelId, channel);
    }
    channel.set(state.version, { ...state, allocations: state.allocations.map(a => ({ ...a })) });
  }

  async loadLatest(channelId: string): Promise<SignedState | null> {
    const channel = this.store.get(channelId);
    if (!channel || channel.size === 0) return null;

    let maxVersion = -1;
    let latest: SignedState | null = null;

    for (const [version, state] of channel) {
      if (version > maxVersion) {
        maxVersion = version;
        latest = state;
      }
    }

    return latest ? { ...latest } : null;
  }

  async load(channelId: string, version: number): Promise<SignedState | null> {
    const channel = this.store.get(channelId);
    if (!channel) return null;
    const state = channel.get(version);
    return state ? { ...state } : null;
  }

  async loadAll(channelId: string): Promise<SignedState[]> {
    const channel = this.store.get(channelId);
    if (!channel) return [];

    return [...channel.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, state]) => ({ ...state }));
  }

  async listChannels(): Promise<string[]> {
    return [...this.store.keys()];
  }

  async clear(channelId: string): Promise<void> {
    this.store.delete(channelId);
  }

  /** Test helper: total number of persisted states across all channels */
  get totalStates(): number {
    let count = 0;
    for (const channel of this.store.values()) {
      count += channel.size;
    }
    return count;
  }
}

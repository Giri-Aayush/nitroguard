import type { SignedState } from '../channel/types.js';

/**
 * NitroGuard persistence interface.
 *
 * Every adapter must provide atomic save + load semantics.
 * loadLatest() must return the state with the highest version number,
 * not the most recently saved state (safe against out-of-order writes).
 */
export interface PersistenceAdapter {
  /**
   * Persist a co-signed state. Must be durable before resolving —
   * an app crash immediately after save() must not lose the state.
   */
  save(channelId: string, state: SignedState): Promise<void>;

  /**
   * Load the state with the highest version for a channel.
   * Returns null if no states exist for this channelId.
   */
  loadLatest(channelId: string): Promise<SignedState | null>;

  /**
   * Load a specific version for a channel.
   * Returns null if not found.
   */
  load(channelId: string, version: number): Promise<SignedState | null>;

  /**
   * Load all states for a channel, sorted by version ascending.
   */
  loadAll(channelId: string): Promise<SignedState[]>;

  /**
   * List all channel IDs that have at least one persisted state.
   */
  listChannels(): Promise<string[]>;

  /**
   * Remove all persisted states for a channel.
   * Called after funds are successfully reclaimed (VOID state).
   */
  clear(channelId: string): Promise<void>;
}

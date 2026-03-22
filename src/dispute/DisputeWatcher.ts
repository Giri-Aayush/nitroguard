import { EventEmitter } from 'events';
import { ChallengeManager } from './ChallengeManager.js';
import type { ICustodyClient, DisputeWatcherConfig, DisputeWatcherEvent } from './types.js';
import type { PersistenceAdapter } from '../persistence/PersistenceAdapter.js';
import type { SignedState } from '../channel/types.js';

type AnyListener = (...args: unknown[]) => void;

/**
 * Watches the Custody contract for challenge and finalization events and
 * automatically responds on behalf of the client.
 *
 * Operates at the multi-channel level — a single watcher can protect
 * multiple channels simultaneously.
 *
 * @example
 * ```ts
 * const watcher = new DisputeWatcher({ custodyClient, persistence });
 * watcher.watch(channelId, latestState);
 * await watcher.start();
 *
 * // Update the watched state after each send():
 * channel.on('stateUpdate', (_, state) => watcher.updateState(channelId, state));
 *
 * watcher.on('responded', (channelId, txHash) => { ... });
 * watcher.on('challenge_lost', (channelId) => { ... });
 * ```
 */
export class DisputeWatcher extends EventEmitter {
  private readonly _custody: ICustodyClient;
  private readonly _persistence: PersistenceAdapter;
  private readonly _challengeManager: ChallengeManager;

  // channelId → latest known state (updated on every send)
  private readonly _watching = new Map<string, SignedState>();

  // Unsubscribe functions from watchContractEvent
  private _unwatchChallenge: (() => void) | null = null;
  private _unwatchFinalized: (() => void) | null = null;

  // Tracks pending finalization watchers per channel
  private readonly _finalizeCallbacks = new Map<string, (() => void)[]>();

  constructor(config: DisputeWatcherConfig) {
    super();
    this._custody = config.custodyClient;
    this._persistence = config.persistence;
    this._challengeManager = new ChallengeManager(this._custody, this._persistence);
  }

  // ─── Control API ──────────────────────────────────────────────────────────

  /**
   * Start watching for on-chain events.
   * Must be called after `watch()` for the event handlers to be active.
   */
  async start(): Promise<void> {
    this._unwatchChallenge = this._custody.watchChallengeRegistered(
      null,
      (channelId, version, _deadline) => {
        if (!this._watching.has(channelId)) return;
        void this._onChallenge(channelId, version);
      },
    );

    this._unwatchFinalized = this._custody.watchChannelFinalized(
      null,
      (channelId, finalVersion) => {
        if (!this._watching.has(channelId)) return;
        this._onFinalized(channelId, finalVersion);
      },
    );
  }

  /** Stop all event watchers. */
  async stop(): Promise<void> {
    this._unwatchChallenge?.();
    this._unwatchFinalized?.();
    this._unwatchChallenge = null;
    this._unwatchFinalized = null;
  }

  /**
   * Register a channel for protection.
   *
   * @param channelId — the channel to watch
   * @param latestState — the latest co-signed state (used if we need to respond)
   */
  watch(channelId: string, latestState: SignedState): void {
    this._watching.set(channelId, latestState);
  }

  /** Update the latest state for a watched channel (call after every send()). */
  updateState(channelId: string, latestState: SignedState): void {
    if (this._watching.has(channelId)) {
      this._watching.set(channelId, latestState);
    }
  }

  /** Remove a channel from the watch list. */
  unwatch(channelId: string): void {
    this._watching.delete(channelId);
  }

  /**
   * Poll on-chain status for all watched channels.
   *
   * Use this for environments where `watchContractEvent` isn't supported
   * (e.g. some hosted RPC providers). Call on a timer or after reconnecting.
   */
  async checkAll(): Promise<void> {
    for (const [channelId] of this._watching) {
      const status = await this._custody.getOnChainStatus(channelId as `0x${string}`);
      if (status === 'DISPUTE') {
        // We don't know the exact challenge version from polling — load from
        // persistence and assume any version ≥ 0 triggered it
        const latestState = await this._persistence.loadLatest(channelId);
        const challengeVersion = latestState ? latestState.version - 1 : 0;
        await this._onChallenge(channelId, challengeVersion);
      } else if (status === 'FINAL') {
        this._onFinalized(channelId, 0);
      }
    }
  }

  // ─── Type-safe event API ──────────────────────────────────────────────────

  on(event: DisputeWatcherEvent, listener: AnyListener): this;
  on(event: string, listener: AnyListener): this;
  on(event: string, listener: AnyListener): this {
    return super.on(event, listener);
  }

  // ─── Internal handlers ────────────────────────────────────────────────────

  private async _onChallenge(channelId: string, challengeVersion: number): Promise<void> {
    this.emit('challenge', channelId, challengeVersion);

    const { result, txHash } = await this._challengeManager.handleChallenge(
      channelId,
      challengeVersion,
    );

    if (result === 'responded' && txHash) {
      this.emit('responded', channelId, txHash);
    } else if (result === 'challenge_lost') {
      this.emit('challenge_lost', channelId);
    }
    // 'already_responded' is silently ignored
  }

  private _onFinalized(channelId: string, _finalVersion: number): void {
    this.emit('finalized', channelId);

    // Fire any registered finalization callbacks (e.g. from forceClose polling)
    const callbacks = this._finalizeCallbacks.get(channelId);
    if (callbacks) {
      for (const cb of callbacks) cb();
      this._finalizeCallbacks.delete(channelId);
    }
  }

  /**
   * Register a one-shot callback to fire when `channelId` is finalized.
   * Used internally by `Channel.forceClose()` to avoid polling.
   *
   * @internal
   */
  _onceFinalized(channelId: string, callback: () => void): void {
    const existing = this._finalizeCallbacks.get(channelId) ?? [];
    existing.push(callback);
    this._finalizeCallbacks.set(channelId, existing);
  }
}

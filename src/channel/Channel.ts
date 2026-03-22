import type { Chain } from 'viem';
import { ChannelFSM } from './ChannelFSM.js';
import { VersionManager } from './VersionManager.js';
import {
  InvalidTransitionError,
  CoSignatureTimeoutError,
  NoPersistenceError,
} from '../errors/index.js';
import type { PersistenceAdapter } from '../persistence/PersistenceAdapter.js';
import type { ClearNodeTransport } from './transport.js';
import type { ICustodyClient } from '../dispute/types.js';
import type {
  ChannelStatus,
  ChannelEvent,
  ChannelEventMap,
  ChannelParams,
  SignedState,
  AssetAllocation,
  Amount,
  SendOptions,
  SendResult,
  CloseOptions,
  CloseResult,
  ForceCloseOptions,
  ForceCloseResult,
  CheckpointResult,
  WithdrawResult,
  StateIntent,
  Allocation,
  ChannelMetrics,
} from './types.js';

type AnyListener = (...args: unknown[]) => void;

/**
 * Represents a single ERC-7824 state channel.
 *
 * Wraps the channel FSM, version manager, persistence, and ClearNode
 * transport into a clean, safe API. All state transitions are validated
 * by `ChannelFSM` — invalid operations throw `InvalidTransitionError`.
 *
 * Obtain a `Channel` via `NitroGuard.open()` or `NitroGuard.restore()`.
 */
export class Channel {
  // ─── Identity ─────────────────────────────────────────────────────────────
  readonly id: string;
  readonly participants: [string, string];
  readonly assets: AssetAllocation[];
  readonly createdAt: Date;
  readonly chain: Chain;

  // ─── Internal state ───────────────────────────────────────────────────────
  private readonly _fsm: ChannelFSM;
  private readonly _versions: VersionManager;
  private readonly _persistence: PersistenceAdapter;
  private readonly _transport: ClearNodeTransport;
  private readonly _params: ChannelParams;

  // ─── Phase 2: on-chain client (optional — stubs used when absent) ─────────
  private readonly _custody: ICustodyClient | null;

  // ─── Config ───────────────────────────────────────────────────────────────
  private readonly _defaultSendTimeout: number;
  private readonly _defaultCloseTimeout: number;

  // ─── Event listeners ──────────────────────────────────────────────────────
  private readonly _listeners = new Map<ChannelEvent, AnyListener[]>();

  // ─── Send queue mutex ─────────────────────────────────────────────────────
  // Ensures sends are processed one at a time to prevent version conflicts.
  private _sendQueue: Promise<SendResult> = Promise.resolve({} as SendResult);

  // ─── forceClose mutex ─────────────────────────────────────────────────────
  private _forceCloseInProgress = false;
  private _forceClosePromise: Promise<ForceCloseResult> | null = null;

  // ─── Metrics ──────────────────────────────────────────────────────────────
  private _messagesSent = 0;
  private _latencySamples: number[] = [];
  private _disputeCount = 0;

  constructor(params: ChannelConstructorParams) {
    this.id = params.channelId;
    this.participants = params.participants;
    this.assets = params.assets;
    this.createdAt = params.createdAt ?? new Date();
    this.chain = params.chain;

    this._fsm = params.fsm;
    this._versions = params.versionManager;
    this._persistence = params.persistence;
    this._transport = params.transport;
    this._params = params.channelParams;
    this._custody = params.custodyClient ?? null;

    this._defaultSendTimeout = params.defaultSendTimeout ?? 5_000;
    this._defaultCloseTimeout = params.defaultCloseTimeout ?? 10_000;

    // Propagate FSM status changes to external listeners
    this._fsm.onStatusChange((to, from) => {
      this._emit('statusChange', to, from);
    });
  }

  // ─── Properties ───────────────────────────────────────────────────────────

  get status(): ChannelStatus {
    return this._fsm.status;
  }

  get version(): number {
    return this._versions.current;
  }

  // ─── Core Operations ──────────────────────────────────────────────────────

  /**
   * Send an off-chain state update through ClearNode.
   *
   * Queues behind any pending send to prevent version conflicts.
   * Automatically persists the co-signed state on success.
   * Rolls back the version counter on timeout.
   */
  async send(payload: unknown, options?: SendOptions): Promise<SendResult> {
    // Queue to prevent concurrent sends from conflicting on version
    this._sendQueue = this._sendQueue.then(() => this._doSend(payload, options)).catch(() => {
      // Previous failure doesn't block the queue — the caller handles the error
      return this._doSend(payload, options);
    });
    return this._sendQueue;
  }

  private async _doSend(payload: unknown, options?: SendOptions): Promise<SendResult> {
    if (this._fsm.status !== 'ACTIVE') {
      throw new InvalidTransitionError(this._fsm.status, 'send');
    }

    const timeoutMs = options?.timeoutMs ?? this._defaultSendTimeout;
    const v = this._versions.next();
    const sendStart = Date.now();

    const partialState: Omit<SignedState, 'sigClient' | 'sigClearNode'> = {
      channelId: this.id,
      version: v,
      intent: 'APP' as StateIntent,
      data: encodePayload(payload),
      allocations: buildAllocations(this.assets),
      savedAt: Date.now(),
    };

    let signedState: SignedState;
    try {
      signedState = await this._transport.proposeState(
        this.id,
        { ...partialState, sigClient: '0x' as `0x${string}` },
        timeoutMs,
      );
    } catch (err) {
      this._versions.rollback(v);
      if (err instanceof Error && err.message.includes('timeout')) {
        const timeoutErr = new CoSignatureTimeoutError(timeoutMs, v);
        this._emit('error', timeoutErr);
        throw timeoutErr;
      }
      throw err;
    }

    this._latencySamples.push(Date.now() - sendStart);
    this._messagesSent++;
    this._versions.confirm(v);
    await this._persistence.save(this.id, signedState);
    this._emit('stateUpdate', v, signedState);

    return { version: v, state: signedState };
  }

  /**
   * Cooperatively close the channel.
   *
   * Sends a CHANFINAL state to ClearNode, then submits the mutual close
   * transaction on-chain. If ClearNode doesn't co-sign within the timeout,
   * automatically calls `forceClose()` (unless `noAutoForce` is set).
   */
  async close(options?: CloseOptions): Promise<CloseResult> {
    if (this._fsm.status !== 'ACTIVE') {
      throw new InvalidTransitionError(this._fsm.status, 'close');
    }

    const timeoutMs = options?.timeoutMs ?? this._defaultCloseTimeout;
    const v = this._versions.next();

    const partialState = {
      channelId: this.id,
      version: v,
      intent: 'CHANFINAL' as StateIntent,
      data: '0x' as `0x${string}`,
      allocations: buildAllocations(this.assets),
      savedAt: Date.now(),
      sigClient: '0x' as `0x${string}`,
    };

    let finalState: SignedState;
    try {
      finalState = await this._transport.closeChannel(this.id, partialState, timeoutMs);
    } catch (err) {
      this._versions.rollback(v);

      if (!options?.noAutoForce) {
        await this.forceClose();
      }
      throw err;
    }

    this._versions.confirm(v);
    await this._persistence.save(this.id, finalState);

    // Phase 2: submit mutual close on-chain
    let txHash: `0x${string}` = '0x0';
    if (this._custody) {
      txHash = await this._custody.close(this.id as `0x${string}`, finalState);
    }

    this._fsm.transition('FINAL', 'close');

    return { txHash, finalState };
  }

  /**
   * Unilaterally close the channel by submitting the latest persisted
   * co-signed state as a challenge on-chain.
   *
   * Calls `challenge()` on the Custody contract, then waits for the
   * challenge window to expire (or for a successful `respond()` by the
   * other party), then calls `withdraw()`.
   *
   * Throws `NoPersistenceError` if no persisted state exists.
   * Concurrent calls return the same in-flight promise (mutex protected).
   */
  async forceClose(options?: ForceCloseOptions): Promise<ForceCloseResult> {
    if (this._fsm.status !== 'ACTIVE') {
      throw new InvalidTransitionError(this._fsm.status, 'forceClose');
    }

    // Mutex: concurrent forceClose() calls all share the same promise
    if (this._forceCloseInProgress && this._forceClosePromise) {
      return this._forceClosePromise;
    }

    this._forceCloseInProgress = true;
    this._forceClosePromise = this._doForceClose(options).finally(() => {
      this._forceCloseInProgress = false;
      this._forceClosePromise = null;
    });

    return this._forceClosePromise;
  }

  private async _doForceClose(options?: ForceCloseOptions): Promise<ForceCloseResult> {
    const stateToSubmit = options?.state ?? await this._persistence.loadLatest(this.id);
    if (!stateToSubmit) {
      throw new NoPersistenceError(this.id);
    }

    let challengeTxHash: `0x${string}` = '0x0';
    if (this._custody) {
      challengeTxHash = await this._custody.challenge(
        this.id as `0x${string}`,
        stateToSubmit,
      );
    }

    this._disputeCount++;
    this._fsm.transition('DISPUTE', 'forceClose');
    this._emit('challengeDetected', this.id);

    // Wait for finalization, then withdraw
    let withdrawTxHash: `0x${string}` = '0x0';
    if (this._custody) {
      const challengeWindowMs = this._params.challengeDuration * 1_000;
      await this._custody.pollForFinalization(
        this.id as `0x${string}`,
        challengeWindowMs + 60_000, // 1-minute buffer
        1_000,                       // poll every 1s in tests (Anvil fast-forward)
      );

      withdrawTxHash = await this._custody.withdraw(
        this.id as `0x${string}`,
        this.participants[0] as `0x${string}`,
      );

      this._fsm.transition('FINAL', 'finalized');
      this._fsm.transition('VOID', 'withdraw');
    }

    const reclaimedAmounts: Amount[] = this.assets.map(a => ({
      token: a.token,
      amount: a.amount,
    }));

    this._emit('fundsReclaimed', this.id, reclaimedAmounts);

    return { challengeTxHash, withdrawTxHash, reclaimedAmounts };
  }

  /**
   * Checkpoint the current latest state on-chain.
   *
   * Any future challenge must use a version higher than the checkpointed
   * version. Call this periodically on long-lived channels.
   */
  async checkpoint(): Promise<CheckpointResult> {
    if (this._fsm.status !== 'ACTIVE') {
      throw new InvalidTransitionError(this._fsm.status, 'checkpoint');
    }

    const latestState = await this._persistence.loadLatest(this.id);
    if (!latestState) {
      throw new NoPersistenceError(this.id);
    }

    let txHash: `0x${string}` = '0x0';
    if (this._custody) {
      txHash = await this._custody.checkpoint(this.id as `0x${string}`, latestState);
    }

    return { txHash, version: latestState.version };
  }

  /**
   * Withdraw funds after the channel is in FINAL state.
   */
  async withdraw(): Promise<WithdrawResult> {
    if (this._fsm.status !== 'FINAL') {
      throw new InvalidTransitionError(this._fsm.status, 'withdraw');
    }

    let txHash: `0x${string}` = '0x0';
    if (this._custody) {
      txHash = await this._custody.withdraw(
        this.id as `0x${string}`,
        this.participants[0] as `0x${string}`,
      );
    }

    this._fsm.transition('VOID', 'withdraw');

    return {
      txHash,
      amounts: this.assets.map(a => ({ token: a.token, amount: a.amount })),
    };
  }

  /**
   * Load all persisted states for this channel, sorted by version ascending.
   */
  async getHistory(): Promise<SignedState[]> {
    return this._persistence.loadAll(this.id);
  }

  /**
   * Load the latest co-signed state from persistence.
   * Returns null if no states have been persisted yet.
   */
  async getLatestPersistedState(): Promise<SignedState | null> {
    return this._persistence.loadLatest(this.id);
  }

  /**
   * Returns a snapshot of runtime statistics for this channel.
   *
   * - `messagesSent` — total successfully co-signed state updates
   * - `avgLatencyMs` — average round-trip time from send() to co-signature
   * - `uptimeMs`     — milliseconds since the channel was created
   * - `disputeCount` — number of forceClose / dispute events triggered
   */
  metrics(): ChannelMetrics {
    const avgLatencyMs = this._latencySamples.length === 0
      ? 0
      : Math.round(
          this._latencySamples.reduce((sum, v) => sum + v, 0) / this._latencySamples.length,
        );

    return {
      messagesSent: this._messagesSent,
      avgLatencyMs,
      uptimeMs: Date.now() - this.createdAt.getTime(),
      disputeCount: this._disputeCount,
    };
  }

  // ─── Event API ────────────────────────────────────────────────────────────

  on<E extends ChannelEvent>(
    event: E,
    listener: (...args: ChannelEventMap[E]) => void,
  ): () => void {
    const listeners = this._listeners.get(event) ?? [];
    listeners.push(listener as AnyListener);
    this._listeners.set(event, listeners);

    return () => {
      const current = this._listeners.get(event) ?? [];
      const idx = current.indexOf(listener as AnyListener);
      if (idx !== -1) current.splice(idx, 1);
    };
  }

  off<E extends ChannelEvent>(event: E, listener: (...args: ChannelEventMap[E]) => void): void {
    const listeners = this._listeners.get(event) ?? [];
    const idx = listeners.indexOf(listener as AnyListener);
    if (idx !== -1) listeners.splice(idx, 1);
  }

  private _emit<E extends ChannelEvent>(event: E, ...args: ChannelEventMap[E]): void {
    const listeners = this._listeners.get(event) ?? [];
    for (const l of listeners) {
      try {
        l(...(args as unknown[]));
      } catch {
        // Never let listener errors propagate into channel operations
      }
    }
  }

  /**
   * Called by DisputeWatcher when a challenge has been successfully responded to
   * and the channel is back to ACTIVE on-chain.
   *
   * @internal
   */
  _onChallengeCleared(txHash: `0x${string}`): void {
    if (this._fsm.status === 'DISPUTE') {
      this._fsm.transition('ACTIVE', 'challengeResponseSucceeded');
    }
    this._emit('challengeResponded', this.id, txHash);
  }
}

// ─── Constructor params ───────────────────────────────────────────────────────

export interface ChannelConstructorParams {
  channelId: string;
  participants: [string, string];
  assets: AssetAllocation[];
  chain: Chain;
  channelParams: ChannelParams;
  fsm: ChannelFSM;
  versionManager: VersionManager;
  persistence: PersistenceAdapter;
  transport: ClearNodeTransport;
  /** Phase 2: optional on-chain custody client. Stubs used when absent. */
  custodyClient?: ICustodyClient;
  createdAt?: Date;
  defaultSendTimeout?: number;
  defaultCloseTimeout?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encodePayload(payload: unknown): `0x${string}` {
  if (payload === undefined || payload === null) return '0x';
  try {
    const json = JSON.stringify(payload, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    const hex = Buffer.from(json, 'utf8').toString('hex');
    return `0x${hex}`;
  } catch {
    return '0x';
  }
}

function buildAllocations(assets: AssetAllocation[]): Allocation[] {
  return assets.map(a => ({
    token: a.token,
    clientBalance: a.amount,
    clearNodeBalance: 0n,
  }));
}

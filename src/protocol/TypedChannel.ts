import type { Chain } from 'viem';
import type { Channel } from '../channel/Channel.js';
import type { Protocol } from './types.js';
import type {
  ChannelStatus,
  ChannelEvent,
  ChannelEventMap,
  SignedState,
  AssetAllocation,
  SendOptions,
  SendResult,
  CloseOptions,
  CloseResult,
  ForceCloseOptions,
  ForceCloseResult,
  CheckpointResult,
  WithdrawResult,
  ChannelMetrics,
} from '../channel/types.js';
import {
  ProtocolValidationError,
  ProtocolTransitionError,
} from '../errors/index.js';

/**
 * A Channel wrapped with a typed protocol schema.
 *
 * Obtained via `ChannelFactory.open()` when `config.protocol` is provided.
 * All methods except `send()` delegate directly to the underlying `Channel`.
 * `send(payload: T)` validates shape, runs transition guards, then wraps the
 * payload in a protocol envelope before passing to the channel.
 *
 * @typeParam T - The Zod schema output type (inferred from `defineProtocol()`)
 */
export class TypedChannel<T> {
  constructor(
    private readonly _channel: Channel,
    private readonly _protocol: Protocol<T>,
  ) {}

  // ─── Identity ─────────────────────────────────────────────────────────────

  get id(): string { return this._channel.id; }
  get status(): ChannelStatus { return this._channel.status; }
  get version(): number { return this._channel.version; }
  get participants(): [string, string] { return this._channel.participants; }
  get assets(): AssetAllocation[] { return this._channel.assets; }
  get createdAt(): Date { return this._channel.createdAt; }
  get chain(): Chain { return this._channel.chain; }
  get protocol(): Protocol<T> { return this._protocol; }

  // ─── Typed send ───────────────────────────────────────────────────────────

  /**
   * Send a typed state update.
   *
   * Validates `payload` against the protocol's Zod schema, runs all
   * transition guards, then encodes the protocol envelope into `state.data`
   * before co-signing with ClearNode.
   *
   * @throws {ProtocolValidationError} if payload fails Zod validation
   * @throws {ProtocolTransitionError} if any transition guard returns false
   */
  async send(payload: T, options?: SendOptions): Promise<SendResult> {
    // 1. Validate shape
    const result = this._protocol.schema.safeParse(payload);
    if (!result.success) {
      throw new ProtocolValidationError(
        this._protocol.identifier,
        result.error.message,
      );
    }
    const parsed = result.data as T;

    // 2. Run transition guards
    if (this._protocol.transitions) {
      const prevTyped = await this._loadPrevTypedState();
      for (const [guardName, guard] of Object.entries(this._protocol.transitions)) {
        if (!guard(prevTyped, parsed, {
          version: this._channel.version + 1,
          channelId: this._channel.id,
        })) {
          throw new ProtocolTransitionError(this._protocol.identifier, guardName);
        }
      }
    }

    // 3. Wrap in protocol envelope before Channel.send() encodes to hex
    const envelope = {
      __protocol__: this._protocol.identifier,
      payload: parsed,
    };

    return this._channel.send(envelope, options);
  }

  // ─── Pass-through methods ─────────────────────────────────────────────────

  close(options?: CloseOptions): Promise<CloseResult> {
    return this._channel.close(options);
  }

  forceClose(options?: ForceCloseOptions): Promise<ForceCloseResult> {
    return this._channel.forceClose(options);
  }

  checkpoint(): Promise<CheckpointResult> {
    return this._channel.checkpoint();
  }

  withdraw(): Promise<WithdrawResult> {
    return this._channel.withdraw();
  }

  getHistory(): Promise<SignedState[]> {
    return this._channel.getHistory();
  }

  getLatestPersistedState(): Promise<SignedState | null> {
    return this._channel.getLatestPersistedState();
  }

  metrics(): ChannelMetrics {
    return this._channel.metrics();
  }

  on<E extends ChannelEvent>(
    event: E,
    listener: (...args: ChannelEventMap[E]) => void,
  ): () => void {
    return this._channel.on(event, listener);
  }

  off<E extends ChannelEvent>(
    event: E,
    listener: (...args: ChannelEventMap[E]) => void,
  ): void {
    return this._channel.off(event, listener);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _loadPrevTypedState(): Promise<T | null> {
    const latest = await this._channel.getLatestPersistedState();
    if (!latest) return null;
    return this._decodeState(latest);
  }

  private _decodeState(state: SignedState): T | null {
    try {
      if (!state.data || state.data === '0x') return null;
      const json = Buffer.from(state.data.slice(2), 'hex').toString('utf8');
      const envelope = JSON.parse(json) as { __protocol__?: string; payload?: unknown };
      if (envelope.__protocol__ !== this._protocol.identifier) return null;
      const parsed = this._protocol.schema.safeParse(envelope.payload);
      return parsed.success ? (parsed.data as T) : null;
    } catch {
      return null;
    }
  }
}

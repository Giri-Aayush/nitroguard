import { EventEmitter } from 'events';
import type { ClearNodeMonitorConfig } from './types.js';

/**
 * Monitors the ClearNode connection for silence.
 *
 * Wire it to `ClearNodeTransport.onMessage()` so every incoming message
 * resets the timer. If no message arrives within `silenceTimeout` ms,
 * the monitor emits `'silence'`.
 *
 * Uses standard `setTimeout` — fully controllable by `vi.useFakeTimers()`
 * in tests.
 *
 * @example
 * ```ts
 * const monitor = new ClearNodeMonitor(channelId, { silenceTimeout: 30_000 });
 * const unsub = transport.onMessage(msg => monitor.handleMessage(msg));
 * monitor.on('silence', (channelId, lastSeenMs) => { ... });
 * monitor.start();
 * // cleanup:
 * monitor.stop();
 * unsub();
 * ```
 */
export class ClearNodeMonitor extends EventEmitter {
  private readonly _channelId: string;
  private readonly _silenceTimeout: number;
  private _lastSeenAt: number;
  private _timerId: ReturnType<typeof setTimeout> | null = null;
  private _started = false;

  constructor(channelId: string, config: ClearNodeMonitorConfig) {
    super();
    this._channelId = channelId;
    this._silenceTimeout = config.silenceTimeout;
    this._lastSeenAt = Date.now();
  }

  /** Timestamp of the last received ClearNode message (ms since epoch). */
  get lastSeenAt(): number {
    return this._lastSeenAt;
  }

  get silenceTimeout(): number {
    return this._silenceTimeout;
  }

  /** Reset the silence timer. Call directly or wire through `handleMessage()`. */
  heartbeat(): void {
    this._lastSeenAt = Date.now();
    if (this._started) this._arm();
  }

  /**
   * Pass any incoming transport message here.
   * Equivalent to calling `heartbeat()`.
   */
  handleMessage(_message: unknown): void {
    this.heartbeat();
  }

  /** Start monitoring. Emits `'silence'` if no message arrives within the timeout. */
  start(): void {
    if (this._started) return;
    this._started = true;
    this._lastSeenAt = Date.now();
    this._arm();
  }

  /** Stop monitoring and cancel any pending timer. */
  stop(): void {
    this._started = false;
    if (this._timerId !== null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private _arm(): void {
    if (this._timerId !== null) clearTimeout(this._timerId);
    this._timerId = setTimeout(() => {
      this._timerId = null;
      if (this._started) {
        this.emit('silence', this._channelId, Date.now() - this._lastSeenAt);
      }
    }, this._silenceTimeout);
  }
}

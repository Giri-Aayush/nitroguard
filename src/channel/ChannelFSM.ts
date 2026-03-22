import { InvalidTransitionError } from '../errors/index.js';
import type { ChannelStatus } from './types.js';

// ─── Legal transition table ──────────────────────────────────────────────────
//
// Mirrors the ERC-7824 on-chain Status enum exactly.
// Every state machine operation must go through this table.

const VALID_TRANSITIONS: Readonly<Record<ChannelStatus, readonly ChannelStatus[]>> = {
  VOID:    ['INITIAL'],
  INITIAL: ['ACTIVE'],
  ACTIVE:  ['ACTIVE', 'FINAL', 'DISPUTE'],  // ACTIVE→ACTIVE = checkpoint
  DISPUTE: ['ACTIVE', 'FINAL'],
  FINAL:   ['VOID'],
} as const;

type StatusChangeListener = (to: ChannelStatus, from: ChannelStatus) => void;

/**
 * Deterministic finite state machine for ERC-7824 channel lifecycle.
 *
 * All NitroGuard channel operations are expressed as state transitions.
 * Attempting an illegal transition throws `InvalidTransitionError` — no
 * silent state corruption is possible.
 */
export class ChannelFSM {
  private _status: ChannelStatus = 'VOID';
  private readonly _listeners: StatusChangeListener[] = [];

  get status(): ChannelStatus {
    return this._status;
  }

  /**
   * Attempt a state transition. Throws `InvalidTransitionError` if the
   * transition is not in the legal transition table for the current state.
   *
   * @param to - The target state
   * @param trigger - Human-readable label for the operation that triggered
   *                  this transition (used in error messages)
   */
  transition(to: ChannelStatus, trigger: string): void {
    const allowed = VALID_TRANSITIONS[this._status];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(this._status, trigger);
    }
    const prev = this._status;
    this._status = to;
    this._emit(to, prev);
  }

  /**
   * Check whether a transition is legal without performing it.
   */
  canTransition(to: ChannelStatus): boolean {
    return VALID_TRANSITIONS[this._status].includes(to);
  }

  /**
   * Subscribe to status change events.
   * Returns an unsubscribe function.
   */
  onStatusChange(listener: StatusChangeListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Force-set the state without going through the transition table.
   * Only used when restoring a channel from persistence or on-chain state.
   * Should not be used in normal operation.
   *
   * @internal
   */
  _forceSet(status: ChannelStatus): void {
    const prev = this._status;
    this._status = status;
    if (prev !== status) {
      this._emit(status, prev);
    }
  }

  private _emit(to: ChannelStatus, from: ChannelStatus): void {
    for (const listener of this._listeners) {
      try {
        listener(to, from);
      } catch {
        // Never let listener errors crash the FSM
      }
    }
  }
}

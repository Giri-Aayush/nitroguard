import { EventEmitter } from 'events';
import type { SignedState } from '../../../src/channel/types.js';
import type { ClearNodeTransport } from '../../../src/channel/transport.js';

export type MockClearNodeMode =
  | 'normal'    // co-signs everything promptly
  | 'silent'    // never responds (simulates offline ClearNode)
  | 'slow'      // delays co-signatures by `slowDelayMs`
  | 'malicious' // accepts updates but submits stale challenge on-chain

/**
 * In-process mock of a ClearNode WebSocket transport.
 *
 * Implements `ClearNodeTransport` so it can be injected directly into
 * `ChannelFactory.open()` for integration tests — no real WebSocket needed.
 */
export class MockClearNode extends EventEmitter implements ClearNodeTransport {
  private _mode: MockClearNodeMode = 'normal';
  private _connected = false;
  private _slowDelayMs = 200;
  private readonly _messageListeners: Array<(msg: unknown) => void> = [];

  // Third Anvil default account — used as mock ClearNode identity
  readonly clearNodeAddress: `0x${string}` =
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

  // ─── State tracking (for malicious mode) ─────────────────────────────────
  private readonly _channelStates = new Map<string, SignedState[]>();

  // ─── ClearNodeTransport interface ────────────────────────────────────────

  get isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    // Simulate connection latency
    await delay(10);
    this._connected = true;
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.emit('disconnected');
  }

  async proposeState(
    channelId: string,
    state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` },
    timeoutMs: number,
  ): Promise<SignedState> {
    return this._handleStateProposal(channelId, state, timeoutMs);
  }

  async openChannel(
    channelId: string,
    state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` },
    timeoutMs = 10_000,
  ): Promise<SignedState> {
    return this._handleStateProposal(channelId, state, timeoutMs);
  }

  async closeChannel(
    channelId: string,
    state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` },
    timeoutMs = 10_000,
  ): Promise<SignedState> {
    return this._handleStateProposal(channelId, state, timeoutMs);
  }

  onMessage(handler: (message: unknown) => void): () => void {
    this._messageListeners.push(handler);
    return () => {
      const idx = this._messageListeners.indexOf(handler);
      if (idx !== -1) this._messageListeners.splice(idx, 1);
    };
  }

  // ─── Test control API ─────────────────────────────────────────────────────

  setMode(mode: MockClearNodeMode): void {
    this._mode = mode;
  }

  setSlowDelay(ms: number): void {
    this._slowDelayMs = ms;
  }

  /** Simulate the ClearNode going offline mid-session */
  goOffline(): void {
    this._mode = 'silent';
    this._connected = false;
    this.emit('disconnected');
  }

  /** Restore normal operation after going offline */
  goOnline(): void {
    this._mode = 'normal';
    this._connected = true;
    this.emit('reconnected');
  }

  /** Get all states received for a channel (for assertions) */
  getStatesForChannel(channelId: string): SignedState[] {
    return [...(this._channelStates.get(channelId) ?? [])];
  }

  /** Get the count of state proposals received */
  getProposalCount(channelId: string): number {
    return (this._channelStates.get(channelId) ?? []).length;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _handleStateProposal(
    channelId: string,
    state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` },
    timeoutMs: number,
  ): Promise<SignedState> {
    if (!this._connected) {
      throw new Error(`MockClearNode: not connected`);
    }

    if (this._mode === 'silent') {
      // Never respond — caller will hit the timeout
      await delay(timeoutMs + 100);
      throw new Error(`timeout: MockClearNode in silent mode`);
    }

    if (this._mode === 'slow') {
      await delay(this._slowDelayMs);
    }

    // Co-sign the state
    const coSigned: SignedState = {
      ...state,
      sigClient: state.sigClient ?? '0xCLIENTSIG0000000000000000000000',
      sigClearNode: '0xCLEARNODESIG000000000000000000000',
      savedAt: Date.now(),
    };

    // Track for assertions and malicious mode
    const existing = this._channelStates.get(channelId) ?? [];
    existing.push(coSigned);
    this._channelStates.set(channelId, existing);

    // Notify message listeners
    for (const listener of this._messageListeners) {
      listener({ type: 'STATE_CO_SIGNED', channelId, version: coSigned.version });
    }

    return coSigned;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

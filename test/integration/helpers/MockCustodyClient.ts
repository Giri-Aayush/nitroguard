import type { ICustodyClient } from '../../../src/dispute/types.js';
import type { SignedState, ChannelStatus } from '../../../src/channel/types.js';

/**
 * In-process mock of the CustodyClient for dispute integration tests.
 *
 * Does not make any on-chain calls. All contract interactions are tracked
 * in-memory for assertion, and test code can fire simulated events via
 * `simulateChallenge()` and `simulateFinalization()`.
 *
 * Implements `ICustodyClient` so it can be injected anywhere the real
 * CustodyClient would be used.
 */
export class MockCustodyClient implements ICustodyClient {
  // ─── Call recording ───────────────────────────────────────────────────────
  readonly calls = {
    challenge: [] as Array<{ channelId: string; state: SignedState }>,
    respond: [] as Array<{ channelId: string; state: SignedState }>,
    checkpoint: [] as Array<{ channelId: string; state: SignedState }>,
    withdraw: [] as Array<{ channelId: string; recipient: string }>,
    close: [] as Array<{ channelId: string; state: SignedState }>,
  };

  // ─── Event handlers (registered via watch*) ───────────────────────────────
  private _challengeHandler: ((channelId: string, version: number, deadline: bigint) => void) | null = null;
  private _finalizedHandler: ((channelId: string, finalVersion: number) => void) | null = null;

  // ─── Configurable on-chain status per channel ────────────────────────────
  private readonly _statuses = new Map<string, ChannelStatus>();

  // ─── Tx hash counter ──────────────────────────────────────────────────────
  private _txCounter = 0;
  private _nextTxHash(): `0x${string}` {
    return `0x${(++this._txCounter).toString(16).padStart(64, '0')}`;
  }

  // ─── ICustodyClient ───────────────────────────────────────────────────────

  async getOnChainStatus(channelId: `0x${string}`): Promise<ChannelStatus> {
    return this._statuses.get(channelId) ?? 'ACTIVE';
  }

  async challenge(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    this.calls.challenge.push({ channelId, state });
    this._statuses.set(channelId, 'DISPUTE');
    return this._nextTxHash();
  }

  async respond(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    this.calls.respond.push({ channelId, state });
    this._statuses.set(channelId, 'ACTIVE');
    return this._nextTxHash();
  }

  async checkpoint(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    this.calls.checkpoint.push({ channelId, state });
    return this._nextTxHash();
  }

  async withdraw(channelId: `0x${string}`, recipient: `0x${string}`): Promise<`0x${string}`> {
    this.calls.withdraw.push({ channelId, recipient });
    this._statuses.set(channelId, 'VOID');
    return this._nextTxHash();
  }

  async close(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    this.calls.close.push({ channelId, state });
    this._statuses.set(channelId, 'FINAL');
    return this._nextTxHash();
  }

  watchChallengeRegistered(
    _channelId: `0x${string}` | null,
    onChallenge: (channelId: string, version: number, deadline: bigint) => void,
  ): () => void {
    this._challengeHandler = onChallenge;
    return () => { this._challengeHandler = null; };
  }

  watchChannelFinalized(
    _channelId: `0x${string}` | null,
    onFinalized: (channelId: string, finalVersion: number) => void,
  ): () => void {
    this._finalizedHandler = onFinalized;
    return () => { this._finalizedHandler = null; };
  }

  async pollForFinalization(
    channelId: `0x${string}`,
    _timeoutMs: number,
    _pollIntervalMs?: number,
  ): Promise<void> {
    // In tests, the status is set immediately by simulateFinalization().
    // Poll once and resolve if already FINAL.
    const status = await this.getOnChainStatus(channelId);
    if (status === 'FINAL' || status === 'VOID') return;
    // If not final yet, wait for simulateFinalization to be called
    return new Promise<void>((resolve) => {
      const check = (): void => {
        void this.getOnChainStatus(channelId).then(s => {
          if (s === 'FINAL' || s === 'VOID') {
            resolve();
          } else {
            setTimeout(check, 10);
          }
        });
      };
      check();
    });
  }

  // ─── Test control API ─────────────────────────────────────────────────────

  /**
   * Simulate a ChallengeRegistered event from the contract.
   * This triggers any registered challenge handler.
   */
  simulateChallenge(channelId: string, version: number, deadline?: bigint): void {
    this._statuses.set(channelId, 'DISPUTE');
    this._challengeHandler?.(
      channelId,
      version,
      deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600),
    );
  }

  /**
   * Simulate a ChannelFinalized event from the contract.
   * This triggers any registered finalized handler.
   */
  simulateFinalization(channelId: string, finalVersion = 0): void {
    this._statuses.set(channelId, 'FINAL');
    this._finalizedHandler?.(channelId, finalVersion);
  }

  /** Manually set the on-chain status for a channel. */
  setStatus(channelId: string, status: ChannelStatus): void {
    this._statuses.set(channelId, status);
  }

  /** Reset all recorded calls. */
  resetCalls(): void {
    this.calls.challenge.length = 0;
    this.calls.respond.length = 0;
    this.calls.checkpoint.length = 0;
    this.calls.withdraw.length = 0;
    this.calls.close.length = 0;
  }
}

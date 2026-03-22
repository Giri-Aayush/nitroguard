import type { ICustodyClient } from './types.js';
import type { PersistenceAdapter } from '../persistence/PersistenceAdapter.js';

type HandleChallengeResult = 'responded' | 'challenge_lost' | 'already_responded';

/**
 * Executes the ERC-7824 challenge-response flow.
 *
 * Stateless: no event watching, no timers. It just runs the logic when
 * `handleChallenge()` is called by the DisputeWatcher.
 *
 * Tracks which channels have already been responded to in this process
 * lifetime to prevent double-spending of gas on duplicate responses.
 */
export class ChallengeManager {
  private readonly _responded = new Set<string>();

  constructor(
    private readonly _custody: ICustodyClient,
    private readonly _persistence: PersistenceAdapter,
  ) {}

  /**
   * Respond to a challenge on-chain if we have a higher-version persisted state.
   *
   * @returns
   *   - `'responded'` — respond() tx submitted successfully
   *   - `'challenge_lost'` — we have no state or our version is ≤ challenge version
   *   - `'already_responded'` — we already responded to this channel's challenge
   */
  async handleChallenge(
    channelId: string,
    challengeVersion: number,
  ): Promise<{ result: HandleChallengeResult; txHash?: `0x${string}` }> {
    if (this._responded.has(channelId)) {
      return { result: 'already_responded' };
    }

    const latestState = await this._persistence.loadLatest(channelId);

    if (!latestState || latestState.version <= challengeVersion) {
      // Cannot beat the challenge
      return { result: 'challenge_lost' };
    }

    const txHash = await this._custody.respond(channelId as `0x${string}`, latestState);
    this._responded.add(channelId);

    return { result: 'responded', txHash };
  }

  /**
   * Call `withdraw()` on the custody contract after the challenge window expires.
   *
   * @returns the withdraw transaction hash
   */
  async handleFinalized(
    channelId: string,
    recipient: `0x${string}`,
  ): Promise<`0x${string}`> {
    return this._custody.withdraw(channelId as `0x${string}`, recipient);
  }

  /**
   * Clear the responded-set for a channel (e.g. after channel returns to ACTIVE).
   * Allows a future challenge to be responded to again.
   */
  clearResponse(channelId: string): void {
    this._responded.delete(channelId);
  }
}

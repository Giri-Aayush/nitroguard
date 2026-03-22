import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DisputeWatcher } from '../../../src/dispute/DisputeWatcher.js';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import { MockCustodyClient } from '../../integration/helpers/MockCustodyClient.js';
import type { SignedState } from '../../../src/channel/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ZERO_SIG = '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

function makeState(channelId: string, version: number): SignedState {
  return {
    channelId,
    version,
    intent: 'APP',
    data: '0x' as `0x${string}`,
    allocations: [
      {
        token: ZERO_ADDR,
        clientBalance: 100n,
        clearNodeBalance: 100n,
      },
    ],
    sigClient: ZERO_SIG,
    sigClearNode: ZERO_SIG,
    savedAt: Date.now(),
  };
}

/**
 * Drain the microtask queue deeply enough for chained async/await calls inside
 * DisputeWatcher._onChallenge and ChallengeManager.handleChallenge to settle.
 * Each `await` inside those methods advances one microtask tick, so four rounds
 * covers the full call chain (_onChallenge → handleChallenge → respond).
 */
async function flushAsync(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

const CH1 = '0xch1channel000000000000000000000000000000000000000000000000000001';
const CH2 = '0xch2channel000000000000000000000000000000000000000000000000000002';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('DisputeWatcher', () => {
  let custody: MockCustodyClient;
  let persistence: MemoryAdapter;
  let watcher: DisputeWatcher;

  beforeEach(() => {
    custody = new MockCustodyClient();
    persistence = new MemoryAdapter();
    watcher = new DisputeWatcher({ custodyClient: custody, persistence });
  });

  afterEach(async () => {
    await watcher.stop();
  });

  // 1. watch() registers a channel — checkAll() detects it when status is DISPUTE
  it('watch() registers a channel so checkAll() can detect it when status is DISPUTE', async () => {
    const state = makeState(CH1, 5);
    await persistence.save(CH1, state);

    watcher.watch(CH1, state);
    custody.setStatus(CH1, 'DISPUTE');

    const challengeHandler = vi.fn();
    watcher.on('challenge', challengeHandler);

    await watcher.checkAll();

    expect(challengeHandler).toHaveBeenCalledWith(CH1, expect.any(Number));
  });

  // 2. start() attaches watchChallengeRegistered and watchChannelFinalized on custody
  it('start() attaches watchChallengeRegistered and watchChannelFinalized handlers on the custody client', async () => {
    const watchChallengeSpy = vi.spyOn(custody, 'watchChallengeRegistered');
    const watchFinalizedSpy = vi.spyOn(custody, 'watchChannelFinalized');

    await watcher.start();

    expect(watchChallengeSpy).toHaveBeenCalledTimes(1);
    expect(watchFinalizedSpy).toHaveBeenCalledTimes(1);
  });

  // 3. Challenge event for a watched channel triggers 'challenge' event emission
  it("challenge event for a watched channel triggers 'challenge' event emission", async () => {
    const state = makeState(CH1, 5);
    watcher.watch(CH1, state);
    await watcher.start();

    const challengeHandler = vi.fn();
    watcher.on('challenge', challengeHandler);

    custody.simulateChallenge(CH1, 3);
    await flushAsync();

    expect(challengeHandler).toHaveBeenCalledWith(CH1, 3);
  });

  // 4. Challenge event for an unwatched channel is ignored
  it('challenge event for an unwatched channel is ignored — no handler called', async () => {
    await watcher.start();

    const challengeHandler = vi.fn();
    watcher.on('challenge', challengeHandler);

    custody.simulateChallenge(CH2, 3);
    await flushAsync();

    expect(challengeHandler).not.toHaveBeenCalled();
  });

  // 5. When ourVersion (10) > challengeVersion (3): respond() is called on custody
  it('respond() is called on custody when our persisted version (10) beats the challenge version (3)', async () => {
    const state = makeState(CH1, 10);
    await persistence.save(CH1, state);
    watcher.watch(CH1, state);
    await watcher.start();

    custody.simulateChallenge(CH1, 3);
    await flushAsync();

    expect(custody.calls.respond.length).toBe(1);
    expect(custody.calls.respond[0].channelId).toBe(CH1);
  });

  // 6. When ourVersion ≤ challengeVersion: respond() is NOT called, 'challenge_lost' emitted
  it("respond() is NOT called and 'challenge_lost' is emitted when challenge version (10) >= our version (3)", async () => {
    const state = makeState(CH1, 3);
    await persistence.save(CH1, state);
    watcher.watch(CH1, state);
    await watcher.start();

    const lostHandler = vi.fn();
    watcher.on('challenge_lost', lostHandler);

    custody.simulateChallenge(CH1, 10);
    await flushAsync();

    expect(custody.calls.respond.length).toBe(0);
    expect(lostHandler).toHaveBeenCalledWith(CH1);
  });

  // 7. 'responded' event fires with channelId and txHash after successful respond
  it("'responded' event fires with channelId and a txHash after a successful respond()", async () => {
    const state = makeState(CH1, 10);
    await persistence.save(CH1, state);
    watcher.watch(CH1, state);
    await watcher.start();

    const respondedHandler = vi.fn();
    watcher.on('responded', respondedHandler);

    custody.simulateChallenge(CH1, 3);
    await flushAsync();

    expect(respondedHandler).toHaveBeenCalledTimes(1);
    const [channelId, txHash] = respondedHandler.mock.calls[0] as [string, string];
    expect(channelId).toBe(CH1);
    expect(typeof txHash).toBe('string');
    expect(txHash.startsWith('0x')).toBe(true);
  });

  // 8. No double-response: once the first challenge is fully resolved, a second
  //    simulateChallenge is a no-op because _responded already contains the channelId.
  it('does not respond a second time when simulateChallenge fires again after the first response has settled', async () => {
    const state = makeState(CH1, 10);
    await persistence.save(CH1, state);
    watcher.watch(CH1, state);
    await watcher.start();

    // First challenge — wait for the full async chain to resolve so _responded is populated
    custody.simulateChallenge(CH1, 3);
    await flushAsync();
    expect(custody.calls.respond.length).toBe(1);

    // Second challenge fires after the first is completely settled
    custody.simulateChallenge(CH1, 3);
    await flushAsync();

    // ChallengeManager._responded now contains CH1 → 'already_responded' is returned
    expect(custody.calls.respond.length).toBe(1);
  });

  // 9. unwatch() removes channel — subsequent challenge for that channel is ignored
  it('unwatch() removes a channel so subsequent challenges for it are ignored', async () => {
    const state = makeState(CH1, 10);
    await persistence.save(CH1, state);
    watcher.watch(CH1, state);
    await watcher.start();

    watcher.unwatch(CH1);

    const challengeHandler = vi.fn();
    watcher.on('challenge', challengeHandler);

    custody.simulateChallenge(CH1, 3);
    await flushAsync();

    expect(challengeHandler).not.toHaveBeenCalled();
    expect(custody.calls.respond.length).toBe(0);
  });

  // 10. stop() calls the unwatch function (watchContractEvent cleanup)
  it('stop() invokes the unwatch callbacks returned by watchChallengeRegistered and watchChannelFinalized', async () => {
    const unwatchChallenge = vi.fn();
    const unwatchFinalized = vi.fn();

    vi.spyOn(custody, 'watchChallengeRegistered').mockReturnValue(unwatchChallenge);
    vi.spyOn(custody, 'watchChannelFinalized').mockReturnValue(unwatchFinalized);

    await watcher.start();
    await watcher.stop();

    expect(unwatchChallenge).toHaveBeenCalledTimes(1);
    expect(unwatchFinalized).toHaveBeenCalledTimes(1);
  });

  // 11. 'finalized' event emits when ChannelFinalized fires for a watched channel
  it("'finalized' event is emitted when ChannelFinalized fires for a watched channel", async () => {
    const state = makeState(CH1, 5);
    watcher.watch(CH1, state);
    await watcher.start();

    const finalizedHandler = vi.fn();
    watcher.on('finalized', finalizedHandler);

    custody.simulateFinalization(CH1, 5);

    expect(finalizedHandler).toHaveBeenCalledWith(CH1);
  });

  // 12. 'finalized' event NOT emitted for an unwatched channel
  it("'finalized' event is NOT emitted when ChannelFinalized fires for an unwatched channel", async () => {
    await watcher.start();

    const finalizedHandler = vi.fn();
    watcher.on('finalized', finalizedHandler);

    custody.simulateFinalization(CH2, 5);

    expect(finalizedHandler).not.toHaveBeenCalled();
  });

  // 13. updateState() keeps the latest state in sync
  it('updateState() updates the state so a subsequent challenge uses the newer version', async () => {
    const oldState = makeState(CH1, 3);
    const newState = makeState(CH1, 10);

    await persistence.save(CH1, oldState);
    watcher.watch(CH1, oldState);
    await watcher.start();

    // Save the newer state to persistence and update the watcher
    await persistence.save(CH1, newState);
    watcher.updateState(CH1, newState);

    const respondedHandler = vi.fn();
    watcher.on('responded', respondedHandler);

    // Challenge at v5 — old state (v3) would lose, but new state (v10) wins
    custody.simulateChallenge(CH1, 5);
    await flushAsync();

    expect(custody.calls.respond.length).toBe(1);
    expect(respondedHandler).toHaveBeenCalledTimes(1);
  });

  // 14. checkAll() — when custody returns 'DISPUTE' for a watched channel, triggers challenge handler
  it("checkAll() triggers the challenge handler when a watched channel has on-chain status 'DISPUTE'", async () => {
    const state = makeState(CH1, 8);
    await persistence.save(CH1, state);
    watcher.watch(CH1, state);

    custody.setStatus(CH1, 'DISPUTE');

    const challengeHandler = vi.fn();
    watcher.on('challenge', challengeHandler);

    await watcher.checkAll();

    expect(challengeHandler).toHaveBeenCalledWith(CH1, expect.any(Number));
  });

  // 15. checkAll() — when custody returns 'ACTIVE', no challenge triggered
  it("checkAll() does NOT trigger the challenge handler when a watched channel has on-chain status 'ACTIVE'", async () => {
    const state = makeState(CH1, 5);
    watcher.watch(CH1, state);

    custody.setStatus(CH1, 'ACTIVE');

    const challengeHandler = vi.fn();
    watcher.on('challenge', challengeHandler);

    await watcher.checkAll();

    expect(challengeHandler).not.toHaveBeenCalled();
  });
});

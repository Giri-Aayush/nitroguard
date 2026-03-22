import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClearNodeMonitor } from '../../../src/dispute/ClearNodeMonitor.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHANNEL_ID = '0xaaaa';
const SILENCE_TIMEOUT = 1000;

function makeMonitor(silenceTimeout = SILENCE_TIMEOUT): ClearNodeMonitor {
  return new ClearNodeMonitor(CHANNEL_ID, { silenceTimeout });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClearNodeMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. 'silence' is NOT emitted before the timeout expires
  it("does not emit 'silence' before the timeout expires", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    vi.advanceTimersByTime(999);

    expect(handler).not.toHaveBeenCalled();
    monitor.stop();
  });

  // 2. 'silence' IS emitted when the timeout expires
  it("emits 'silence' when the timeout expires", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    vi.advanceTimersByTime(1000);

    expect(handler).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  // 3. 'silence' includes the correct channelId as first argument
  it("emits 'silence' with the correct channelId as the first argument", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    vi.advanceTimersByTime(1000);

    expect(handler).toHaveBeenCalledWith(CHANNEL_ID, expect.any(Number));
    monitor.stop();
  });

  // 4. heartbeat() resets the timer — no silence if called before timeout elapses
  it("heartbeat() resets the timer so 'silence' is not emitted within the reset window", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    vi.advanceTimersByTime(500);   // 500 ms into the first window
    monitor.heartbeat();           // reset — new 1000 ms window begins
    vi.advanceTimersByTime(999);   // 999 ms into the reset window (total 1499 ms)

    expect(handler).not.toHaveBeenCalled();
    monitor.stop();
  });

  // 5. heartbeat() called after timeout resets correctly — no second silence in the new window
  it("heartbeat() after timeout resets the timer so no second silence fires within the reset window", () => {
    const monitor = makeMonitor();
    const silenceCount = { value: 0 };
    monitor.on('silence', () => { silenceCount.value++; });

    monitor.start();
    vi.advanceTimersByTime(1001);   // first silence fires
    expect(silenceCount.value).toBe(1);

    monitor.heartbeat();            // reset after silence
    vi.advanceTimersByTime(999);    // 999 ms into the new window — still no second silence

    expect(silenceCount.value).toBe(1);
    monitor.stop();
  });

  // 6. handleMessage() is equivalent to heartbeat()
  it("handleMessage() resets the timer equivalently to heartbeat()", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    vi.advanceTimersByTime(500);
    monitor.handleMessage({});      // should act exactly like heartbeat()
    vi.advanceTimersByTime(999);    // 999 ms into the reset window

    expect(handler).not.toHaveBeenCalled();
    monitor.stop();
  });

  // 7. stop() prevents silence from firing
  it("stop() prevents 'silence' from firing after it is called", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    monitor.stop();
    vi.advanceTimersByTime(2000);   // well past the original timeout

    expect(handler).not.toHaveBeenCalled();
  });

  // 8. start() is idempotent — calling twice does not set up double timers
  it("calling start() twice emits 'silence' exactly once, not twice", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    monitor.start();               // second call should be a no-op
    vi.advanceTimersByTime(1001);

    expect(handler).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  // 9. can restart after being stopped
  it("can be restarted after stop() and emits 'silence' in the new window", () => {
    const monitor = makeMonitor();
    const handler = vi.fn();
    monitor.on('silence', handler);

    monitor.start();
    monitor.stop();
    vi.advanceTimersByTime(2000);   // no emission while stopped
    expect(handler).not.toHaveBeenCalled();

    monitor.start();               // restart
    vi.advanceTimersByTime(1001);  // new window elapses

    expect(handler).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  // 10. lastSeenAt is updated by heartbeat()
  it("lastSeenAt is updated by heartbeat()", () => {
    const monitor = makeMonitor();
    const before = monitor.lastSeenAt;

    vi.advanceTimersByTime(200);
    monitor.heartbeat();

    expect(monitor.lastSeenAt).toBeGreaterThan(before);
    monitor.stop();
  });

  // 11. silenceTimeout getter returns the configured value
  it("silenceTimeout getter returns the configured value", () => {
    const monitor = makeMonitor(5000);
    expect(monitor.silenceTimeout).toBe(5000);
  });

  // 12. 'silence' emitted with correct elapsedMs (second argument > 0)
  it("'silence' is emitted with an elapsedMs value greater than 0 as the second argument", () => {
    const monitor = makeMonitor();
    let capturedElapsed: number | undefined;
    monitor.on('silence', (_channelId: string, elapsedMs: number) => {
      capturedElapsed = elapsedMs;
    });

    monitor.start();
    vi.advanceTimersByTime(1000);

    expect(capturedElapsed).toBeDefined();
    expect(capturedElapsed).toBeGreaterThan(0);
    monitor.stop();
  });
});

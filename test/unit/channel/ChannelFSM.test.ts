import { describe, it, expect, vi } from 'vitest';
import { ChannelFSM } from '../../../src/channel/ChannelFSM.js';
import { InvalidTransitionError } from '../../../src/errors/index.js';

describe('ChannelFSM', () => {
  it('starts in VOID state', () => {
    const fsm = new ChannelFSM();
    expect(fsm.status).toBe('VOID');
  });

  // ─── Valid transitions ────────────────────────────────────────────────────

  it('VOID → INITIAL is valid', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    expect(fsm.status).toBe('INITIAL');
  });

  it('INITIAL → ACTIVE is valid', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    expect(fsm.status).toBe('ACTIVE');
  });

  it('ACTIVE → FINAL is valid (close)', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');
    expect(fsm.status).toBe('FINAL');
  });

  it('ACTIVE → DISPUTE is valid (forceClose)', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('DISPUTE', 'forceClose');
    expect(fsm.status).toBe('DISPUTE');
  });

  it('ACTIVE → ACTIVE is valid (checkpoint)', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('ACTIVE', 'checkpoint');
    expect(fsm.status).toBe('ACTIVE');
  });

  it('DISPUTE → ACTIVE is valid (challenge responded)', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('DISPUTE', 'forceClose');
    fsm.transition('ACTIVE', 'respond');
    expect(fsm.status).toBe('ACTIVE');
  });

  it('DISPUTE → FINAL is valid (window expired)', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('DISPUTE', 'forceClose');
    fsm.transition('FINAL', 'windowExpired');
    expect(fsm.status).toBe('FINAL');
  });

  it('FINAL → VOID is valid (reclaimed)', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');
    fsm.transition('VOID', 'withdraw');
    expect(fsm.status).toBe('VOID');
  });

  // ─── Invalid transitions ──────────────────────────────────────────────────

  it('VOID → ACTIVE throws InvalidTransitionError (must go through INITIAL)', () => {
    const fsm = new ChannelFSM();
    expect(() => fsm.transition('ACTIVE', 'open')).toThrow(InvalidTransitionError);
  });

  it('VOID → DISPUTE throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    expect(() => fsm.transition('DISPUTE', 'forceClose')).toThrow(InvalidTransitionError);
  });

  it('VOID → FINAL throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    expect(() => fsm.transition('FINAL', 'close')).toThrow(InvalidTransitionError);
  });

  it('FINAL → ACTIVE throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');
    expect(() => fsm.transition('ACTIVE', 'send')).toThrow(InvalidTransitionError);
  });

  it('INITIAL → DISPUTE throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    expect(() => fsm.transition('DISPUTE', 'forceClose')).toThrow(InvalidTransitionError);
  });

  it('INITIAL → VOID throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    expect(() => fsm.transition('VOID', 'withdraw')).toThrow(InvalidTransitionError);
  });

  // ─── Error details ────────────────────────────────────────────────────────

  it('InvalidTransitionError carries from and attempted fields', () => {
    const fsm = new ChannelFSM();
    let caught: InvalidTransitionError | undefined;
    try {
      fsm.transition('ACTIVE', 'send');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught).toBeInstanceOf(InvalidTransitionError);
    expect(caught?.from).toBe('VOID');
    expect(caught?.attempted).toBe('send');
  });

  // ─── canTransition ────────────────────────────────────────────────────────

  it('canTransition returns true for valid next states', () => {
    const fsm = new ChannelFSM();
    expect(fsm.canTransition('INITIAL')).toBe(true);
    expect(fsm.canTransition('ACTIVE')).toBe(false);
  });

  // ─── Callbacks ───────────────────────────────────────────────────────────

  it('onStatusChange callback fires on every valid transition', () => {
    const fsm = new ChannelFSM();
    const calls: Array<[string, string]> = [];
    fsm.onStatusChange((to, from) => calls.push([to, from]));

    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');

    expect(calls).toEqual([
      ['INITIAL', 'VOID'],
      ['ACTIVE', 'INITIAL'],
      ['FINAL', 'ACTIVE'],
    ]);
  });

  it('onStatusChange receives both (to, from) values', () => {
    const fsm = new ChannelFSM();
    let captured: [string, string] | undefined;
    fsm.onStatusChange((to, from) => { captured = [to, from]; });

    fsm.transition('INITIAL', 'open');
    expect(captured).toEqual(['INITIAL', 'VOID']);
  });

  it('callback is NOT fired on invalid transition attempt', () => {
    const fsm = new ChannelFSM();
    const calls: unknown[] = [];
    fsm.onStatusChange(() => calls.push(1));

    expect(() => fsm.transition('ACTIVE', 'open')).toThrow(InvalidTransitionError);
    expect(calls).toHaveLength(0);
  });

  it('unsubscribe function stops receiving events', () => {
    const fsm = new ChannelFSM();
    const calls: unknown[] = [];
    const unsub = fsm.onStatusChange(() => calls.push(1));

    fsm.transition('INITIAL', 'open');
    unsub();
    fsm.transition('ACTIVE', 'open');

    expect(calls).toHaveLength(1);
  });

  it('multiple listeners all receive events', () => {
    const fsm = new ChannelFSM();
    const a: unknown[] = [];
    const b: unknown[] = [];
    fsm.onStatusChange(() => a.push(1));
    fsm.onStatusChange(() => b.push(1));

    fsm.transition('INITIAL', 'open');

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('listener throwing does not crash the FSM', () => {
    const fsm = new ChannelFSM();
    fsm.onStatusChange(() => { throw new Error('listener error'); });
    // Should not throw
    expect(() => fsm.transition('INITIAL', 'open')).not.toThrow();
    expect(fsm.status).toBe('INITIAL');
  });

  it('_forceSet bypasses transition table', () => {
    const fsm = new ChannelFSM();
    fsm._forceSet('ACTIVE');
    expect(fsm.status).toBe('ACTIVE');
  });

  it('_forceSet emits statusChange when state changes', () => {
    const fsm = new ChannelFSM();
    const calls: Array<[string, string]> = [];
    fsm.onStatusChange((to, from) => calls.push([to, from]));

    fsm._forceSet('ACTIVE');
    expect(calls).toEqual([['ACTIVE', 'VOID']]);
  });

  it('_forceSet does not emit when state is unchanged', () => {
    const fsm = new ChannelFSM();
    const calls: unknown[] = [];
    fsm.onStatusChange(() => calls.push(1));

    fsm._forceSet('VOID'); // already VOID
    expect(calls).toHaveLength(0);
  });

  // ─── Complete invalid transition matrix (all 12 untested invalids) ─────────

  it('VOID → VOID throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    expect(() => fsm.transition('VOID', 'noop')).toThrow(InvalidTransitionError);
  });

  it('INITIAL → INITIAL throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    expect(() => fsm.transition('INITIAL', 'open')).toThrow(InvalidTransitionError);
  });

  it('INITIAL → FINAL throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    expect(() => fsm.transition('FINAL', 'close')).toThrow(InvalidTransitionError);
  });

  it('ACTIVE → INITIAL throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    expect(() => fsm.transition('INITIAL', 'rollback')).toThrow(InvalidTransitionError);
  });

  it('ACTIVE → VOID throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    expect(() => fsm.transition('VOID', 'withdraw')).toThrow(InvalidTransitionError);
  });

  it('DISPUTE → DISPUTE throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('DISPUTE', 'forceClose');
    expect(() => fsm.transition('DISPUTE', 'forceClose')).toThrow(InvalidTransitionError);
  });

  it('DISPUTE → INITIAL throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('DISPUTE', 'forceClose');
    expect(() => fsm.transition('INITIAL', 'rollback')).toThrow(InvalidTransitionError);
  });

  it('DISPUTE → VOID throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('DISPUTE', 'forceClose');
    expect(() => fsm.transition('VOID', 'withdraw')).toThrow(InvalidTransitionError);
  });

  it('FINAL → INITIAL throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');
    expect(() => fsm.transition('INITIAL', 'rollback')).toThrow(InvalidTransitionError);
  });

  it('FINAL → DISPUTE throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');
    expect(() => fsm.transition('DISPUTE', 'forceClose')).toThrow(InvalidTransitionError);
  });

  it('FINAL → FINAL throws InvalidTransitionError', () => {
    const fsm = new ChannelFSM();
    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');
    expect(() => fsm.transition('FINAL', 'close')).toThrow(InvalidTransitionError);
  });

  // ─── canTransition completeness ────────────────────────────────────────────

  it('canTransition covers all 5 target states from VOID', () => {
    const fsm = new ChannelFSM();
    expect(fsm.canTransition('VOID')).toBe(false);
    expect(fsm.canTransition('INITIAL')).toBe(true);
    expect(fsm.canTransition('ACTIVE')).toBe(false);
    expect(fsm.canTransition('DISPUTE')).toBe(false);
    expect(fsm.canTransition('FINAL')).toBe(false);
  });

  it('canTransition covers all 5 target states from ACTIVE', () => {
    const fsm = new ChannelFSM();
    fsm._forceSet('ACTIVE');
    expect(fsm.canTransition('VOID')).toBe(false);
    expect(fsm.canTransition('INITIAL')).toBe(false);
    expect(fsm.canTransition('ACTIVE')).toBe(true);
    expect(fsm.canTransition('DISPUTE')).toBe(true);
    expect(fsm.canTransition('FINAL')).toBe(true);
  });

  it('canTransition covers all 5 target states from DISPUTE', () => {
    const fsm = new ChannelFSM();
    fsm._forceSet('DISPUTE');
    expect(fsm.canTransition('VOID')).toBe(false);
    expect(fsm.canTransition('INITIAL')).toBe(false);
    expect(fsm.canTransition('ACTIVE')).toBe(true);
    expect(fsm.canTransition('DISPUTE')).toBe(false);
    expect(fsm.canTransition('FINAL')).toBe(true);
  });

  // ─── FSM state is unchanged after invalid transition ───────────────────────

  it('state is unchanged after failed transition', () => {
    const fsm = new ChannelFSM();
    try { fsm.transition('ACTIVE', 'bad'); } catch { /* expected */ }
    expect(fsm.status).toBe('VOID');
  });

  it('can succeed after a failed attempt', () => {
    const fsm = new ChannelFSM();
    try { fsm.transition('ACTIVE', 'bad'); } catch { /* expected */ }
    fsm.transition('INITIAL', 'open'); // should still work
    expect(fsm.status).toBe('INITIAL');
  });

  // ─── Listener edge cases ──────────────────────────────────────────────────

  it('10 listeners all fire on every transition', () => {
    const fsm = new ChannelFSM();
    const counts = Array.from({ length: 10 }, () => 0);
    counts.forEach((_, i) => fsm.onStatusChange(() => { counts[i]++; }));

    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');

    expect(counts.every(c => c === 2)).toBe(true);
  });

  it('multiple listener throws do not prevent other listeners from firing', () => {
    const fsm = new ChannelFSM();
    const fired: number[] = [];
    fsm.onStatusChange(() => { throw new Error('A'); });
    fsm.onStatusChange(() => fired.push(1));
    fsm.onStatusChange(() => { throw new Error('B'); });
    fsm.onStatusChange(() => fired.push(2));

    fsm.transition('INITIAL', 'open');
    expect(fired).toEqual([1, 2]);
  });

  it('unsubscribing all listeners leaves FSM intact', () => {
    const fsm = new ChannelFSM();
    const unsub1 = fsm.onStatusChange(() => {});
    const unsub2 = fsm.onStatusChange(() => {});
    unsub1();
    unsub2();

    expect(() => fsm.transition('INITIAL', 'open')).not.toThrow();
    expect(fsm.status).toBe('INITIAL');
  });

  it('full cycle VOID→INITIAL→ACTIVE→FINAL→VOID emits 4 events', () => {
    const fsm = new ChannelFSM();
    const events: Array<[string, string]> = [];
    fsm.onStatusChange((to, from) => events.push([to, from]));

    fsm.transition('INITIAL', 'open');
    fsm.transition('ACTIVE', 'open');
    fsm.transition('FINAL', 'close');
    fsm.transition('VOID', 'withdraw');

    expect(events).toEqual([
      ['INITIAL', 'VOID'],
      ['ACTIVE', 'INITIAL'],
      ['FINAL', 'ACTIVE'],
      ['VOID', 'FINAL'],
    ]);
  });

  it('full dispute cycle ACTIVE→DISPUTE→ACTIVE→FINAL→VOID emits correctly', () => {
    const fsm = new ChannelFSM();
    fsm._forceSet('ACTIVE');
    const events: Array<[string, string]> = [];
    fsm.onStatusChange((to, from) => events.push([to, from]));

    fsm.transition('DISPUTE', 'forceClose');
    fsm.transition('ACTIVE', 'respond');
    fsm.transition('FINAL', 'close');
    fsm.transition('VOID', 'withdraw');

    expect(events).toEqual([
      ['DISPUTE', 'ACTIVE'],
      ['ACTIVE', 'DISPUTE'],
      ['FINAL', 'ACTIVE'],
      ['VOID', 'FINAL'],
    ]);
  });
});

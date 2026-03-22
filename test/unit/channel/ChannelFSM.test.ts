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
});

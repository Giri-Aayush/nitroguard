/**
 * Property-based / fuzz tests for ChannelFSM.
 *
 * These tests generate random inputs and sequences to verify invariants
 * that must hold regardless of input. No external fuzzing library needed —
 * we use a seeded PRNG for reproducibility.
 */
import { describe, it, expect } from 'vitest';
import { ChannelFSM } from '../../../src/channel/ChannelFSM.js';
import { InvalidTransitionError } from '../../../src/errors/index.js';
import type { ChannelStatus } from '../../../src/channel/types.js';

// ─── Deterministic PRNG (LCG) ─────────────────────────────────────────────────

function makePrng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

const ALL_STATES: ChannelStatus[] = ['VOID', 'INITIAL', 'ACTIVE', 'DISPUTE', 'FINAL'];

const VALID_TRANSITIONS: Record<ChannelStatus, ChannelStatus[]> = {
  VOID:    ['INITIAL'],
  INITIAL: ['ACTIVE'],
  ACTIVE:  ['ACTIVE', 'FINAL', 'DISPUTE'],
  DISPUTE: ['ACTIVE', 'FINAL'],
  FINAL:   ['VOID'],
};

// ─── Helper: execute a random valid walk through the FSM ──────────────────────

function randomValidWalk(steps: number, rng: () => number): ChannelStatus[] {
  const fsm = new ChannelFSM();
  const path: ChannelStatus[] = [fsm.status];
  for (let i = 0; i < steps; i++) {
    const allowed = VALID_TRANSITIONS[fsm.status];
    const next = allowed[Math.floor(rng() * allowed.length)]!;
    fsm.transition(next, 'fuzz');
    path.push(fsm.status);
  }
  return path;
}

// ─── Properties ───────────────────────────────────────────────────────────────

describe('ChannelFSM — property tests', () => {
  describe('Property: valid transitions never throw', () => {
    it('1000 random valid walks complete without error (seed=1)', () => {
      const rng = makePrng(1);
      for (let i = 0; i < 1000; i++) {
        expect(() => randomValidWalk(10, rng)).not.toThrow();
      }
    });

    it('valid walk of 10000 steps completes without error (seed=42)', () => {
      const rng = makePrng(42);
      expect(() => randomValidWalk(10000, rng)).not.toThrow();
    });
  });

  describe('Property: FSM status is always a valid ChannelStatus', () => {
    it('after any valid transition, status is in ALL_STATES', () => {
      const rng = makePrng(99);
      for (let trial = 0; trial < 500; trial++) {
        const path = randomValidWalk(20, rng);
        for (const state of path) {
          expect(ALL_STATES).toContain(state);
        }
      }
    });
  });

  describe('Property: invalid transitions always throw InvalidTransitionError', () => {
    it('random invalid transitions all throw InvalidTransitionError', () => {
      const rng = makePrng(7);
      const states: ChannelStatus[] = ['VOID', 'INITIAL', 'ACTIVE', 'DISPUTE', 'FINAL'];

      for (let trial = 0; trial < 500; trial++) {
        const fromIdx = Math.floor(rng() * states.length);
        const toIdx = Math.floor(rng() * states.length);
        const from = states[fromIdx]!;
        const to = states[toIdx]!;

        const allowed = VALID_TRANSITIONS[from];
        if (allowed.includes(to)) continue; // skip valid ones

        const fsm = new ChannelFSM();
        fsm._forceSet(from);
        expect(() => fsm.transition(to, 'fuzz')).toThrow(InvalidTransitionError);
      }
    });
  });

  describe('Property: failed transition leaves state unchanged', () => {
    it('state is unchanged after every invalid attempt (100 trials)', () => {
      const rng = makePrng(13);
      const states: ChannelStatus[] = ['VOID', 'INITIAL', 'ACTIVE', 'DISPUTE', 'FINAL'];

      for (let trial = 0; trial < 100; trial++) {
        const from = states[Math.floor(rng() * states.length)]!;
        const to = states[Math.floor(rng() * states.length)]!;
        const allowed = VALID_TRANSITIONS[from];
        if (allowed.includes(to)) continue;

        const fsm = new ChannelFSM();
        fsm._forceSet(from);
        const statusBefore = fsm.status;
        try { fsm.transition(to, 'fuzz'); } catch { /* expected */ }
        expect(fsm.status).toBe(statusBefore);
      }
    });
  });

  describe('Property: listener receives exactly one event per valid transition', () => {
    it('event count matches transition count over 200 random walks', () => {
      const rng = makePrng(21);
      for (let trial = 0; trial < 200; trial++) {
        const fsm = new ChannelFSM();
        let eventCount = 0;
        let transitionCount = 0;
        fsm.onStatusChange(() => { eventCount++; });

        const steps = 5 + Math.floor(rng() * 10);
        for (let i = 0; i < steps; i++) {
          const allowed = VALID_TRANSITIONS[fsm.status];
          const next = allowed[Math.floor(rng() * allowed.length)]!;
          fsm.transition(next, 'fuzz');
          transitionCount++;
        }
        expect(eventCount).toBe(transitionCount);
      }
    });
  });

  describe('Property: _forceSet always produces valid state', () => {
    it('_forceSet with any ChannelStatus yields that status', () => {
      for (const state of ALL_STATES) {
        const fsm = new ChannelFSM();
        fsm._forceSet(state);
        expect(fsm.status).toBe(state);
      }
    });
  });

  describe('Property: canTransition is consistent with actual transitions', () => {
    it('canTransition() matches whether transition succeeds (1000 checks)', () => {
      const rng = makePrng(55);
      const states: ChannelStatus[] = ['VOID', 'INITIAL', 'ACTIVE', 'DISPUTE', 'FINAL'];

      for (let trial = 0; trial < 1000; trial++) {
        const from = states[Math.floor(rng() * states.length)]!;
        const to = states[Math.floor(rng() * states.length)]!;

        const fsm = new ChannelFSM();
        fsm._forceSet(from);
        const predicted = fsm.canTransition(to);

        let succeeded = false;
        try {
          fsm.transition(to, 'fuzz');
          succeeded = true;
        } catch { /* expected */ }

        expect(predicted).toBe(succeeded);
      }
    });
  });

  describe('Property: listener exceptions never change FSM status', () => {
    it('throwing listeners do not affect FSM state (100 walks)', () => {
      const rng = makePrng(77);
      for (let trial = 0; trial < 100; trial++) {
        const fsm = new ChannelFSM();
        // Add a crashing listener
        fsm.onStatusChange(() => { throw new Error('crash!'); });

        const steps = 3 + Math.floor(rng() * 7);
        const path = randomValidWalk(steps, rng);

        // The FSM should reach the same end state as if no listener was attached
        const fsm2 = new ChannelFSM();
        for (let i = 1; i < path.length; i++) {
          fsm2.transition(path[i]!, 'verify');
        }

        // Reset the first FSM and replay with listener
        const fsm3 = new ChannelFSM();
        fsm3.onStatusChange(() => { throw new Error('crash!'); });
        for (let i = 1; i < path.length; i++) {
          fsm3.transition(path[i]!, 'verify');
        }

        expect(fsm3.status).toBe(fsm2.status);
      }
    });
  });
});

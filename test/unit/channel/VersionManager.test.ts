import { describe, it, expect } from 'vitest';
import { VersionManager } from '../../../src/channel/VersionManager.js';

describe('VersionManager', () => {
  it('starts at version 0', () => {
    const vm = new VersionManager();
    expect(vm.current).toBe(0);
  });

  it('can be initialized with a custom start version', () => {
    const vm = new VersionManager(10);
    expect(vm.current).toBe(10);
  });

  it('next() returns 1 on first call', () => {
    const vm = new VersionManager();
    expect(vm.next()).toBe(1);
  });

  it('next() returns 2, 3, 4 on subsequent calls', () => {
    const vm = new VersionManager();
    vm.next(); // 1
    expect(vm.next()).toBe(2);
    expect(vm.next()).toBe(3);
    expect(vm.next()).toBe(4);
  });

  it('hasPending is false initially', () => {
    const vm = new VersionManager();
    expect(vm.hasPending).toBe(false);
  });

  it('hasPending is true while in-flight versions exist', () => {
    const vm = new VersionManager();
    vm.next();
    expect(vm.hasPending).toBe(true);
  });

  it('hasPending is false when all confirmed', () => {
    const vm = new VersionManager();
    const v1 = vm.next();
    const v2 = vm.next();
    vm.confirm(v1);
    vm.confirm(v2);
    expect(vm.hasPending).toBe(false);
  });

  it('confirm() removes version from in-flight set', () => {
    const vm = new VersionManager();
    const v = vm.next();
    vm.confirm(v);
    expect(vm.hasPending).toBe(false);
    expect(vm.pendingVersions).not.toContain(v);
  });

  it('rollback() decrements version to v-1', () => {
    const vm = new VersionManager();
    const v = vm.next(); // v = 1
    expect(vm.current).toBe(1);
    vm.rollback(v);
    expect(vm.current).toBe(0);
  });

  it('rollback() sets hasPending false for that version', () => {
    const vm = new VersionManager();
    const v = vm.next();
    expect(vm.hasPending).toBe(true);
    vm.rollback(v);
    expect(vm.hasPending).toBe(false);
  });

  it('rollback() is no-op for version not in in-flight', () => {
    const vm = new VersionManager();
    vm.next(); // v=1
    expect(vm.current).toBe(1);
    vm.rollback(999); // not in flight
    expect(vm.current).toBe(1); // unchanged
  });

  it('after rollback, next() reuses the rolled-back version number', () => {
    const vm = new VersionManager();
    const v = vm.next(); // 1
    vm.rollback(v);
    const v2 = vm.next(); // should be 1 again
    expect(v2).toBe(1);
  });

  it('pendingVersions returns all in-flight versions sorted', () => {
    const vm = new VersionManager();
    const v1 = vm.next(); // 1
    const v2 = vm.next(); // 2
    const v3 = vm.next(); // 3
    expect(vm.pendingVersions).toEqual([v1, v2, v3]);
  });

  it('pendingCount matches number of in-flight versions', () => {
    const vm = new VersionManager();
    vm.next();
    vm.next();
    expect(vm.pendingCount).toBe(2);
    vm.confirm(1);
    expect(vm.pendingCount).toBe(1);
  });

  it('100 sequential next() calls return unique values 1..100', () => {
    const vm = new VersionManager();
    const versions = Array.from({ length: 100 }, () => vm.next());
    const unique = new Set(versions);
    expect(unique.size).toBe(100);
    expect(Math.min(...versions)).toBe(1);
    expect(Math.max(...versions)).toBe(100);
  });

  it('confirm() is idempotent — double-confirm does not throw', () => {
    const vm = new VersionManager();
    const v = vm.next();
    vm.confirm(v);
    expect(() => vm.confirm(v)).not.toThrow();
  });

  it('partial confirm: one of two in-flight confirmed, hasPending still true', () => {
    const vm = new VersionManager();
    const v1 = vm.next();
    vm.next();
    vm.confirm(v1);
    expect(vm.hasPending).toBe(true);
  });

  // ─── Multi-rollback edge cases ────────────────────────────────────────────

  it('rollback of already-confirmed version is a no-op (does not decrement)', () => {
    const vm = new VersionManager();
    const v = vm.next(); // v=1
    vm.confirm(v);
    vm.rollback(v); // not in-flight anymore
    expect(vm.current).toBe(1); // unchanged
  });

  it('rollback of v=1 from initial 0 brings current back to 0', () => {
    const vm = new VersionManager(0);
    const v = vm.next(); // 1
    vm.rollback(v);
    expect(vm.current).toBe(0);
  });

  it('two rollbacks of different versions: latest one wins', () => {
    const vm = new VersionManager();
    const v1 = vm.next(); // 1
    const v2 = vm.next(); // 2
    // Roll back v2 first (the latest one in-flight)
    vm.rollback(v2); // current → 1
    expect(vm.current).toBe(1);
    // Now v1 is still in-flight — roll it back too
    vm.rollback(v1); // current → 0
    expect(vm.current).toBe(0);
  });

  it('rolling back v1 while v2 is also in-flight: v1 rollback sets current to 0', () => {
    const vm = new VersionManager();
    vm.next(); // v1=1
    vm.next(); // v2=2
    vm.rollback(1); // rolls current to 0, removes 1 from in-flight
    expect(vm.current).toBe(0);
    // v2 is still in-flight
    expect(vm.hasPending).toBe(true);
    expect(vm.pendingVersions).toContain(2);
  });

  it('after rollback from version 5 with non-latest, current drops to v-1 not just latest', () => {
    // rollback(v) sets current = v - 1, regardless of what other versions are in-flight
    const vm = new VersionManager();
    vm.next(); // 1
    vm.next(); // 2
    vm.next(); // 3
    vm.next(); // 4
    vm.next(); // 5
    vm.rollback(3); // rolls back to 2
    expect(vm.current).toBe(2);
  });

  // ─── Confirm after rollback ───────────────────────────────────────────────

  it('confirm of version that was rolled back is a no-op', () => {
    const vm = new VersionManager();
    const v = vm.next(); // 1
    vm.rollback(v);
    vm.confirm(v); // no-op: already gone from in-flight
    expect(vm.current).toBe(0);
    expect(vm.hasPending).toBe(false);
  });

  // ─── initialVersion edge cases ────────────────────────────────────────────

  it('initialized at 100: next() returns 101', () => {
    const vm = new VersionManager(100);
    expect(vm.next()).toBe(101);
  });

  it('initialized at 100: rollback brings back to 100', () => {
    const vm = new VersionManager(100);
    const v = vm.next(); // 101
    vm.rollback(v);
    expect(vm.current).toBe(100);
  });

  // ─── pendingVersions order ────────────────────────────────────────────────

  it('pendingVersions is sorted ascending even after partial confirms', () => {
    const vm = new VersionManager();
    vm.next(); // 1
    vm.next(); // 2
    vm.next(); // 3
    vm.confirm(2); // confirm middle one
    expect(vm.pendingVersions).toEqual([1, 3]);
  });

  // ─── Large-scale stress ───────────────────────────────────────────────────

  it('1000 next() + confirm() pairs produce no in-flight state', () => {
    const vm = new VersionManager();
    for (let i = 0; i < 1000; i++) {
      const v = vm.next();
      vm.confirm(v);
    }
    expect(vm.current).toBe(1000);
    expect(vm.hasPending).toBe(false);
    expect(vm.pendingCount).toBe(0);
  });

  it('1000 next() then 1000 rollbacks brings current back to 0', () => {
    const vm = new VersionManager();
    const versions: number[] = [];
    for (let i = 0; i < 1000; i++) {
      versions.push(vm.next());
    }
    // Roll back in reverse order (latest first)
    for (let i = versions.length - 1; i >= 0; i--) {
      vm.rollback(versions[i]!);
    }
    expect(vm.current).toBe(0);
    expect(vm.hasPending).toBe(false);
  });
});

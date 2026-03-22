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
});

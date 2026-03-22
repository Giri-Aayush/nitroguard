import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/channel/SessionManager.js';

const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const CLEARNODE_URL = 'wss://clearnet.yellow.com/ws';

function makeSigner(address = ALICE) {
  return {
    address: address as `0x${string}`,
    signTypedData: vi.fn().mockResolvedValue('0xsignedTypedData'),
    signMessage: vi.fn().mockResolvedValue('0xsignedMessage'),
  };
}

describe('SessionManager', () => {
  let signer: ReturnType<typeof makeSigner>;
  let manager: SessionManager;

  beforeEach(() => {
    signer = makeSigner();
    manager = new SessionManager(signer, CLEARNODE_URL);
  });

  // ─── Initial state ────────────────────────────────────────────────────────

  it('has no valid session initially', () => {
    expect(manager.hasValidSession).toBe(false);
  });

  it('sessionKey is null initially', () => {
    expect(manager.sessionKey).toBeNull();
  });

  // ─── establish() ─────────────────────────────────────────────────────────

  it('establish() returns a SessionToken', async () => {
    const token = await manager.establish({});
    expect(token).toBeDefined();
    expect(token.address).toBe(ALICE);
    expect(token.clearNodeUrl).toBe(CLEARNODE_URL);
    expect(typeof token.expiresAt).toBe('number');
    expect(token.scope).toBe('channel');
  });

  it('establish() calls signer.signMessage', async () => {
    await manager.establish({});
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('after establish(), hasValidSession is true', async () => {
    await manager.establish({});
    expect(manager.hasValidSession).toBe(true);
  });

  it('after establish(), sessionKey is non-null', async () => {
    await manager.establish({});
    expect(manager.sessionKey).not.toBeNull();
    expect(manager.sessionKey).toBe('0xsignedMessage');
  });

  it('expiresAt is in the future after establish()', async () => {
    const before = Date.now();
    const token = await manager.establish({});
    expect(token.expiresAt).toBeGreaterThan(before);
  });

  it('default TTL is 1 hour (3600000ms)', async () => {
    const before = Date.now();
    const token = await manager.establish({});
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 3_590_000); // ~1hr with slack
  });

  it('custom TTL is used when provided', async () => {
    const before = Date.now();
    const token = await manager.establish({ ttlMs: 10_000 });
    expect(token.expiresAt).toBeLessThanOrEqual(before + 11_000);
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 9_000);
  });

  it('custom scope is passed through', async () => {
    const token = await manager.establish({ scope: 'payment' });
    expect(token.scope).toBe('payment');
  });

  it('default scope is "channel"', async () => {
    const token = await manager.establish({});
    expect(token.scope).toBe('channel');
  });

  it('token.address matches signer.address', async () => {
    const token = await manager.establish({});
    expect(token.address).toBe(ALICE);
  });

  it('token.clearNodeUrl matches constructor arg', async () => {
    const token = await manager.establish({});
    expect(token.clearNodeUrl).toBe(CLEARNODE_URL);
  });

  // ─── hasValidSession near expiry ─────────────────────────────────────────

  it('hasValidSession is false when expiresAt is within 60s of now', async () => {
    await manager.establish({ ttlMs: 30_000 }); // expires in 30s < 60s threshold
    // This depends on internal logic: ttl=30000 → expiresAt = now+30000
    // hasValidSession checks: Date.now() < expiresAt - 60_000
    // now < now+30000-60000 = now-30000 → false
    expect(manager.hasValidSession).toBe(false);
  });

  it('hasValidSession is true when ttl is well beyond 60s threshold', async () => {
    await manager.establish({ ttlMs: 3_600_000 }); // 1 hour
    expect(manager.hasValidSession).toBe(true);
  });

  // ─── invalidate() ────────────────────────────────────────────────────────

  it('invalidate() clears sessionKey', async () => {
    await manager.establish({});
    manager.invalidate();
    expect(manager.sessionKey).toBeNull();
  });

  it('invalidate() sets hasValidSession to false', async () => {
    await manager.establish({ ttlMs: 3_600_000 });
    expect(manager.hasValidSession).toBe(true);
    manager.invalidate();
    expect(manager.hasValidSession).toBe(false);
  });

  it('invalidate() is idempotent — calling twice does not throw', () => {
    manager.invalidate();
    expect(() => manager.invalidate()).not.toThrow();
  });

  it('invalidate() on fresh manager does not throw', () => {
    expect(() => manager.invalidate()).not.toThrow();
  });

  // ─── Re-establish after invalidate ───────────────────────────────────────

  it('can establish a new session after invalidation', async () => {
    await manager.establish({ ttlMs: 3_600_000 });
    manager.invalidate();
    await manager.establish({ ttlMs: 3_600_000 });
    expect(manager.hasValidSession).toBe(true);
  });

  it('re-establish calls signMessage again', async () => {
    await manager.establish({});
    manager.invalidate();
    await manager.establish({});
    expect(signer.signMessage).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect } from 'vitest';
import {
  NitroGuardError,
  InvalidTransitionError,
  CoSignatureTimeoutError,
  ClearNodeUnreachableError,
  ClearNodeSilenceError,
  InsufficientFundsError,
  NoPersistenceError,
  PersistenceQuotaError,
  ChannelNotFoundError,
  OnChainStatusError,
  ChallengeMissedError,
  VersionDesyncError,
  InvalidConfigError,
} from '../../../src/errors/index.js';

// ─── NitroGuardError (base) ───────────────────────────────────────────────────

describe('NitroGuardError', () => {
  it('is an instance of Error', () => {
    const e = new NitroGuardError('test', 'TEST_CODE');
    expect(e).toBeInstanceOf(Error);
  });

  it('carries a code field', () => {
    const e = new NitroGuardError('msg', 'MY_CODE');
    expect(e.code).toBe('MY_CODE');
  });

  it('message is set correctly', () => {
    const e = new NitroGuardError('hello world', 'X');
    expect(e.message).toBe('hello world');
  });

  it('name is NitroGuardError', () => {
    const e = new NitroGuardError('msg', 'X');
    expect(e.name).toBe('NitroGuardError');
  });

  it('has a stack trace', () => {
    const e = new NitroGuardError('msg', 'X');
    expect(e.stack).toBeDefined();
  });
});

// ─── InvalidTransitionError ───────────────────────────────────────────────────

describe('InvalidTransitionError', () => {
  it('is instance of NitroGuardError and Error', () => {
    const e = new InvalidTransitionError('VOID', 'send');
    expect(e).toBeInstanceOf(NitroGuardError);
    expect(e).toBeInstanceOf(Error);
  });

  it('from field is set', () => {
    const e = new InvalidTransitionError('ACTIVE', 'forceClose');
    expect(e.from).toBe('ACTIVE');
  });

  it('attempted field is set', () => {
    const e = new InvalidTransitionError('VOID', 'send');
    expect(e.attempted).toBe('send');
  });

  it('code is INVALID_TRANSITION', () => {
    const e = new InvalidTransitionError('VOID', 'send');
    expect(e.code).toBe('INVALID_TRANSITION');
  });

  it('name is InvalidTransitionError', () => {
    const e = new InvalidTransitionError('VOID', 'send');
    expect(e.name).toBe('InvalidTransitionError');
  });

  it('message mentions the from state and trigger', () => {
    const e = new InvalidTransitionError('FINAL', 'send');
    expect(e.message).toContain('FINAL');
    expect(e.message).toContain('send');
  });

  it('all ChannelStatus values are accepted as from', () => {
    const states = ['VOID', 'INITIAL', 'ACTIVE', 'DISPUTE', 'FINAL'] as const;
    for (const s of states) {
      const e = new InvalidTransitionError(s, 'op');
      expect(e.from).toBe(s);
    }
  });
});

// ─── CoSignatureTimeoutError ──────────────────────────────────────────────────

describe('CoSignatureTimeoutError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new CoSignatureTimeoutError(5000, 1)).toBeInstanceOf(NitroGuardError);
  });

  it('timeoutMs field is set', () => {
    const e = new CoSignatureTimeoutError(3000, 7);
    expect(e.timeoutMs).toBe(3000);
  });

  it('version field is set', () => {
    const e = new CoSignatureTimeoutError(5000, 42);
    expect(e.version).toBe(42);
  });

  it('code is COSIG_TIMEOUT', () => {
    expect(new CoSignatureTimeoutError(1000, 1).code).toBe('COSIG_TIMEOUT');
  });

  it('name is CoSignatureTimeoutError', () => {
    expect(new CoSignatureTimeoutError(1000, 1).name).toBe('CoSignatureTimeoutError');
  });

  it('message mentions version and timeout', () => {
    const e = new CoSignatureTimeoutError(5000, 99);
    expect(e.message).toContain('99');
    expect(e.message).toContain('5000');
  });
});

// ─── ClearNodeUnreachableError ────────────────────────────────────────────────

describe('ClearNodeUnreachableError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new ClearNodeUnreachableError('ws://x', 3)).toBeInstanceOf(NitroGuardError);
  });

  it('url field is set', () => {
    const e = new ClearNodeUnreachableError('wss://clearnet.yellow.com', 5);
    expect(e.url).toBe('wss://clearnet.yellow.com');
  });

  it('attempts field is set', () => {
    const e = new ClearNodeUnreachableError('ws://x', 7);
    expect(e.attempts).toBe(7);
  });

  it('code is CLEARNODE_UNREACHABLE', () => {
    expect(new ClearNodeUnreachableError('ws://x', 1).code).toBe('CLEARNODE_UNREACHABLE');
  });

  it('name is ClearNodeUnreachableError', () => {
    expect(new ClearNodeUnreachableError('ws://x', 1).name).toBe('ClearNodeUnreachableError');
  });
});

// ─── ClearNodeSilenceError ────────────────────────────────────────────────────

describe('ClearNodeSilenceError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new ClearNodeSilenceError('0xabc', 30000)).toBeInstanceOf(NitroGuardError);
  });

  it('channelId field is set', () => {
    const e = new ClearNodeSilenceError('0xchannel', 15000);
    expect(e.channelId).toBe('0xchannel');
  });

  it('lastSeenMs field is set', () => {
    const e = new ClearNodeSilenceError('0xchannel', 45000);
    expect(e.lastSeenMs).toBe(45000);
  });

  it('code is CLEARNODE_SILENCE', () => {
    expect(new ClearNodeSilenceError('x', 1).code).toBe('CLEARNODE_SILENCE');
  });
});

// ─── InsufficientFundsError ───────────────────────────────────────────────────

describe('InsufficientFundsError', () => {
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  it('is instance of NitroGuardError', () => {
    expect(new InsufficientFundsError(100n, 50n, USDC)).toBeInstanceOf(NitroGuardError);
  });

  it('required field is set (bigint)', () => {
    const e = new InsufficientFundsError(100n, 50n, USDC);
    expect(e.required).toBe(100n);
  });

  it('available field is set (bigint)', () => {
    const e = new InsufficientFundsError(100n, 50n, USDC);
    expect(e.available).toBe(50n);
  });

  it('token field is set', () => {
    const e = new InsufficientFundsError(100n, 50n, USDC);
    expect(e.token).toBe(USDC);
  });

  it('code is INSUFFICIENT_FUNDS', () => {
    expect(new InsufficientFundsError(1n, 0n, USDC).code).toBe('INSUFFICIENT_FUNDS');
  });

  it('name is InsufficientFundsError', () => {
    expect(new InsufficientFundsError(1n, 0n, USDC).name).toBe('InsufficientFundsError');
  });

  it('message mentions token and amounts', () => {
    const e = new InsufficientFundsError(200n, 50n, USDC);
    expect(e.message).toContain('200');
    expect(e.message).toContain('50');
    expect(e.message).toContain(USDC);
  });
});

// ─── NoPersistenceError ───────────────────────────────────────────────────────

describe('NoPersistenceError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new NoPersistenceError('0xabc')).toBeInstanceOf(NitroGuardError);
  });

  it('channelId field is set', () => {
    const e = new NoPersistenceError('0xdeadbeef');
    expect(e.channelId).toBe('0xdeadbeef');
  });

  it('code is NO_PERSISTENCE', () => {
    expect(new NoPersistenceError('0x').code).toBe('NO_PERSISTENCE');
  });

  it('name is NoPersistenceError', () => {
    expect(new NoPersistenceError('0x').name).toBe('NoPersistenceError');
  });

  it('message mentions channelId', () => {
    const e = new NoPersistenceError('0xchannel123');
    expect(e.message).toContain('0xchannel123');
  });
});

// ─── PersistenceQuotaError ────────────────────────────────────────────────────

describe('PersistenceQuotaError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new PersistenceQuotaError('quota exceeded')).toBeInstanceOf(NitroGuardError);
  });

  it('code is PERSISTENCE_QUOTA', () => {
    expect(new PersistenceQuotaError('msg').code).toBe('PERSISTENCE_QUOTA');
  });

  it('name is PersistenceQuotaError', () => {
    expect(new PersistenceQuotaError('msg').name).toBe('PersistenceQuotaError');
  });

  it('message is passed through', () => {
    expect(new PersistenceQuotaError('storage full').message).toBe('storage full');
  });
});

// ─── ChannelNotFoundError ─────────────────────────────────────────────────────

describe('ChannelNotFoundError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new ChannelNotFoundError('0xabc')).toBeInstanceOf(NitroGuardError);
  });

  it('channelId field is set', () => {
    const e = new ChannelNotFoundError('0xdeadbeef');
    expect(e.channelId).toBe('0xdeadbeef');
  });

  it('code is CHANNEL_NOT_FOUND', () => {
    expect(new ChannelNotFoundError('0x').code).toBe('CHANNEL_NOT_FOUND');
  });

  it('name is ChannelNotFoundError', () => {
    expect(new ChannelNotFoundError('0x').name).toBe('ChannelNotFoundError');
  });

  it('message mentions channelId', () => {
    const e = new ChannelNotFoundError('0xchannel999');
    expect(e.message).toContain('0xchannel999');
  });
});

// ─── OnChainStatusError ───────────────────────────────────────────────────────

describe('OnChainStatusError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new OnChainStatusError('0xabc', 'ACTIVE', 'FINAL')).toBeInstanceOf(NitroGuardError);
  });

  it('channelId field is set', () => {
    const e = new OnChainStatusError('0xchan', 'ACTIVE', 'FINAL');
    expect(e.channelId).toBe('0xchan');
  });

  it('expected field is set', () => {
    const e = new OnChainStatusError('0xchan', 'ACTIVE', 'FINAL');
    expect(e.expected).toBe('ACTIVE');
  });

  it('actual field is set', () => {
    const e = new OnChainStatusError('0xchan', 'ACTIVE', 'FINAL');
    expect(e.actual).toBe('FINAL');
  });

  it('code is ONCHAIN_STATUS_MISMATCH', () => {
    expect(new OnChainStatusError('0x', 'ACTIVE', 'FINAL').code).toBe('ONCHAIN_STATUS_MISMATCH');
  });

  it('name is OnChainStatusError', () => {
    expect(new OnChainStatusError('0x', 'ACTIVE', 'VOID').name).toBe('OnChainStatusError');
  });

  it('message mentions both expected and actual', () => {
    const e = new OnChainStatusError('0xchan', 'ACTIVE', 'VOID');
    expect(e.message).toContain('ACTIVE');
    expect(e.message).toContain('VOID');
  });
});

// ─── ChallengeMissedError ─────────────────────────────────────────────────────

describe('ChallengeMissedError', () => {
  const DEADLINE = new Date('2026-01-01T12:00:00Z');

  it('is instance of NitroGuardError', () => {
    expect(new ChallengeMissedError('0xabc', DEADLINE)).toBeInstanceOf(NitroGuardError);
  });

  it('channelId field is set', () => {
    const e = new ChallengeMissedError('0xchan', DEADLINE);
    expect(e.channelId).toBe('0xchan');
  });

  it('deadline field is set to provided Date', () => {
    const e = new ChallengeMissedError('0xchan', DEADLINE);
    expect(e.deadline).toBe(DEADLINE);
    expect(e.deadline.toISOString()).toBe(DEADLINE.toISOString());
  });

  it('code is CHALLENGE_MISSED', () => {
    expect(new ChallengeMissedError('0x', DEADLINE).code).toBe('CHALLENGE_MISSED');
  });

  it('name is ChallengeMissedError', () => {
    expect(new ChallengeMissedError('0x', DEADLINE).name).toBe('ChallengeMissedError');
  });

  it('message includes deadline ISO string', () => {
    const e = new ChallengeMissedError('0xchan', DEADLINE);
    expect(e.message).toContain(DEADLINE.toISOString());
  });
});

// ─── VersionDesyncError ───────────────────────────────────────────────────────

describe('VersionDesyncError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new VersionDesyncError('0xabc', 5, 10)).toBeInstanceOf(NitroGuardError);
  });

  it('channelId field is set', () => {
    const e = new VersionDesyncError('0xchan', 3, 7);
    expect(e.channelId).toBe('0xchan');
  });

  it('localVersion field is set', () => {
    const e = new VersionDesyncError('0xchan', 3, 7);
    expect(e.localVersion).toBe(3);
  });

  it('remoteVersion field is set', () => {
    const e = new VersionDesyncError('0xchan', 3, 7);
    expect(e.remoteVersion).toBe(7);
  });

  it('code is VERSION_DESYNC', () => {
    expect(new VersionDesyncError('0x', 1, 2).code).toBe('VERSION_DESYNC');
  });

  it('name is VersionDesyncError', () => {
    expect(new VersionDesyncError('0x', 1, 2).name).toBe('VersionDesyncError');
  });

  it('message mentions both local and remote versions', () => {
    const e = new VersionDesyncError('0xchan', 5, 10);
    expect(e.message).toContain('5');
    expect(e.message).toContain('10');
  });
});

// ─── InvalidConfigError ───────────────────────────────────────────────────────

describe('InvalidConfigError', () => {
  it('is instance of NitroGuardError', () => {
    expect(new InvalidConfigError('rpcUrl', 'missing')).toBeInstanceOf(NitroGuardError);
  });

  it('code is INVALID_CONFIG', () => {
    expect(new InvalidConfigError('rpcUrl', 'reason').code).toBe('INVALID_CONFIG');
  });

  it('name is InvalidConfigError', () => {
    expect(new InvalidConfigError('rpcUrl', 'reason').name).toBe('InvalidConfigError');
  });

  it('message includes field name and reason', () => {
    const e = new InvalidConfigError('myField', 'must be non-empty');
    expect(e.message).toContain('myField');
    expect(e.message).toContain('must be non-empty');
  });
});

// ─── Inheritance hierarchy ────────────────────────────────────────────────────

describe('Error inheritance', () => {
  const allErrors = [
    new InvalidTransitionError('VOID', 'send'),
    new CoSignatureTimeoutError(1000, 1),
    new ClearNodeUnreachableError('ws://x', 1),
    new ClearNodeSilenceError('0x', 1),
    new InsufficientFundsError(1n, 0n, '0x'),
    new NoPersistenceError('0x'),
    new PersistenceQuotaError('full'),
    new ChannelNotFoundError('0x'),
    new OnChainStatusError('0x', 'ACTIVE', 'VOID'),
    new ChallengeMissedError('0x', new Date()),
    new VersionDesyncError('0x', 1, 2),
    new InvalidConfigError('field', 'reason'),
  ];

  it('all error subclasses are instanceof NitroGuardError', () => {
    for (const e of allErrors) {
      expect(e).toBeInstanceOf(NitroGuardError);
    }
  });

  it('all error subclasses are instanceof Error', () => {
    for (const e of allErrors) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('all errors have non-empty code', () => {
    for (const e of allErrors) {
      expect(e.code).toBeTruthy();
      expect(typeof e.code).toBe('string');
    }
  });

  it('all errors have non-empty message', () => {
    for (const e of allErrors) {
      expect(e.message).toBeTruthy();
    }
  });

  it('all errors have a name that is not just "Error"', () => {
    for (const e of allErrors) {
      expect(e.name).not.toBe('Error');
      expect(e.name.length).toBeGreaterThan(5);
    }
  });

  it('all errors have distinct codes', () => {
    const codes = allErrors.map(e => e.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

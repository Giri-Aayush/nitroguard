import type { ChannelStatus } from '../channel/types.js';

// ─── Base ────────────────────────────────────────────────────────────────────

export class NitroGuardError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'NitroGuardError';
    this.code = code;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ─── State Machine ───────────────────────────────────────────────────────────

export class InvalidTransitionError extends NitroGuardError {
  readonly from: ChannelStatus;
  readonly attempted: string;

  constructor(from: ChannelStatus, attempted: string) {
    super(
      `Invalid state transition: cannot perform "${attempted}" from state "${from}"`,
      'INVALID_TRANSITION',
    );
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.attempted = attempted;
  }
}

// ─── Co-Signature ────────────────────────────────────────────────────────────

export class CoSignatureTimeoutError extends NitroGuardError {
  readonly timeoutMs: number;
  readonly version: number;

  constructor(timeoutMs: number, version: number) {
    super(
      `ClearNode did not co-sign state version ${version} within ${timeoutMs}ms`,
      'COSIG_TIMEOUT',
    );
    this.name = 'CoSignatureTimeoutError';
    this.timeoutMs = timeoutMs;
    this.version = version;
  }
}

// ─── ClearNode Connectivity ──────────────────────────────────────────────────

export class ClearNodeUnreachableError extends NitroGuardError {
  readonly url: string;
  readonly attempts: number;

  constructor(url: string, attempts: number) {
    super(
      `ClearNode at "${url}" is unreachable after ${attempts} attempt(s)`,
      'CLEARNODE_UNREACHABLE',
    );
    this.name = 'ClearNodeUnreachableError';
    this.url = url;
    this.attempts = attempts;
  }
}

export class ClearNodeSilenceError extends NitroGuardError {
  readonly channelId: string;
  readonly lastSeenMs: number;

  constructor(channelId: string, lastSeenMs: number) {
    super(
      `ClearNode went silent on channel ${channelId}. Last message ${lastSeenMs}ms ago.`,
      'CLEARNODE_SILENCE',
    );
    this.name = 'ClearNodeSilenceError';
    this.channelId = channelId;
    this.lastSeenMs = lastSeenMs;
  }
}

// ─── Funds ───────────────────────────────────────────────────────────────────

export class InsufficientFundsError extends NitroGuardError {
  readonly required: bigint;
  readonly available: bigint;
  readonly token: string;

  constructor(required: bigint, available: bigint, token: string) {
    super(
      `Insufficient funds for token ${token}: required ${required}, available ${available}`,
      'INSUFFICIENT_FUNDS',
    );
    this.name = 'InsufficientFundsError';
    this.required = required;
    this.available = available;
    this.token = token;
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export class NoPersistenceError extends NitroGuardError {
  readonly channelId: string;

  constructor(channelId: string) {
    super(
      `No persisted state found for channel ${channelId}. Cannot proceed with forceClose without a co-signed state.`,
      'NO_PERSISTENCE',
    );
    this.name = 'NoPersistenceError';
    this.channelId = channelId;
  }
}

export class PersistenceQuotaError extends NitroGuardError {
  constructor(message: string) {
    super(message, 'PERSISTENCE_QUOTA');
    this.name = 'PersistenceQuotaError';
  }
}

// ─── Channel Not Found ───────────────────────────────────────────────────────

export class ChannelNotFoundError extends NitroGuardError {
  readonly channelId: string;

  constructor(channelId: string) {
    super(
      `Channel ${channelId} not found in persistence or on-chain`,
      'CHANNEL_NOT_FOUND',
    );
    this.name = 'ChannelNotFoundError';
    this.channelId = channelId;
  }
}

// ─── On-Chain ────────────────────────────────────────────────────────────────

export class OnChainStatusError extends NitroGuardError {
  readonly channelId: string;
  readonly expected: ChannelStatus;
  readonly actual: ChannelStatus;

  constructor(channelId: string, expected: ChannelStatus, actual: ChannelStatus) {
    super(
      `Channel ${channelId} has on-chain status "${actual}", expected "${expected}"`,
      'ONCHAIN_STATUS_MISMATCH',
    );
    this.name = 'OnChainStatusError';
    this.channelId = channelId;
    this.expected = expected;
    this.actual = actual;
  }
}

export class ChallengeMissedError extends NitroGuardError {
  readonly channelId: string;
  readonly deadline: Date;

  constructor(channelId: string, deadline: Date) {
    super(
      `Challenge window for channel ${channelId} expired at ${deadline.toISOString()} without response`,
      'CHALLENGE_MISSED',
    );
    this.name = 'ChallengeMissedError';
    this.channelId = channelId;
    this.deadline = deadline;
  }
}

// ─── Version ─────────────────────────────────────────────────────────────────

export class VersionDesyncError extends NitroGuardError {
  readonly channelId: string;
  readonly localVersion: number;
  readonly remoteVersion: number;

  constructor(channelId: string, localVersion: number, remoteVersion: number) {
    super(
      `Version desync on channel ${channelId}: local=${localVersion}, remote=${remoteVersion}`,
      'VERSION_DESYNC',
    );
    this.name = 'VersionDesyncError';
    this.channelId = channelId;
    this.localVersion = localVersion;
    this.remoteVersion = remoteVersion;
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

export class InvalidConfigError extends NitroGuardError {
  constructor(field: string, reason: string) {
    super(`Invalid config field "${field}": ${reason}`, 'INVALID_CONFIG');
    this.name = 'InvalidConfigError';
  }
}

// ─── Protocol ─────────────────────────────────────────────────────────────────

export class ProtocolValidationError extends NitroGuardError {
  readonly protocolId: string;

  constructor(protocolId: string, issue: string) {
    super(
      `Protocol "${protocolId}" payload validation failed: ${issue}`,
      'PROTOCOL_VALIDATION',
    );
    this.name = 'ProtocolValidationError';
    this.protocolId = protocolId;
  }
}

export class ProtocolTransitionError extends NitroGuardError {
  readonly protocolId: string;
  readonly guardName: string;

  constructor(protocolId: string, guardName: string) {
    super(
      `Protocol "${protocolId}" rejected transition — guard "${guardName}" returned false`,
      'PROTOCOL_TRANSITION',
    );
    this.name = 'ProtocolTransitionError';
    this.protocolId = protocolId;
    this.guardName = guardName;
  }
}

import type { EIP712Signer } from '../signing/types.js';

/**
 * Manages the ClearNode session key authentication.
 *
 * The Yellow Network protocol requires a short-lived session key to be
 * established before sending channel state updates. SessionManager handles:
 *  - Initial session creation
 *  - Session key generation and signing
 *  - Re-auth after WebSocket reconnect
 *
 * Phase 1: stub implementation — full session management is wired up in
 * Phase 3 when NitroGuard.restore() handles full reconnect semantics.
 */
export class SessionManager {
  private _sessionKey: string | null = null;
  private _expiresAt: number | null = null;
  private readonly _signer: EIP712Signer;
  private readonly _clearNodeUrl: string;

  constructor(signer: EIP712Signer, clearNodeUrl: string) {
    this._signer = signer;
    this._clearNodeUrl = clearNodeUrl;
  }

  get hasValidSession(): boolean {
    if (!this._sessionKey || !this._expiresAt) return false;
    // Refresh if within 60 seconds of expiry
    return Date.now() < this._expiresAt - 60_000;
  }

  get sessionKey(): string | null {
    return this._sessionKey;
  }

  /**
   * Establish or refresh the ClearNode session.
   * Signs the session payload with the client's signer.
   */
  async establish(params: SessionParams): Promise<SessionToken> {
    const expiresAt = Date.now() + (params.ttlMs ?? 3_600_000); // 1 hour default

    const token: SessionToken = {
      address: this._signer.address,
      clearNodeUrl: this._clearNodeUrl,
      expiresAt,
      scope: params.scope ?? 'channel',
    };

    // Sign the session token
    const sig = await this._signer.signMessage(
      JSON.stringify({ ...token, type: 'SESSION_AUTH' }),
    );

    this._sessionKey = sig;
    this._expiresAt = expiresAt;

    return token;
  }

  /**
   * Invalidate the current session (called on disconnect).
   */
  invalidate(): void {
    this._sessionKey = null;
    this._expiresAt = null;
  }
}

export interface SessionParams {
  /** TTL for the session in ms (default 3600000 = 1 hour) */
  ttlMs?: number;
  /** Session scope (default 'channel') */
  scope?: string;
  /** Channel-specific allowances */
  allowances?: Array<{ token: string; amount: bigint }>;
}

export interface SessionToken {
  address: `0x${string}`;
  clearNodeUrl: string;
  expiresAt: number;
  scope: string;
}

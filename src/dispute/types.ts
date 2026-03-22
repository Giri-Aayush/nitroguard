import type { Chain } from 'viem';
import type { SignedState, ChannelStatus } from '../channel/types.js';
import type { PersistenceAdapter } from '../persistence/PersistenceAdapter.js';
import type { EIP712Signer } from '../signing/types.js';

// ─── ICustodyClient ───────────────────────────────────────────────────────────

/**
 * Structural interface for on-chain custody contract interactions.
 *
 * Both CustodyClient (real) and MockCustodyClient (tests) implement this.
 * All dispute/checkpoint/withdraw operations accept this instead of the
 * concrete class to keep everything testable without a real chain.
 */
export interface ICustodyClient {
  getOnChainStatus(channelId: `0x${string}`): Promise<ChannelStatus>;
  challenge(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`>;
  respond(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`>;
  checkpoint(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`>;
  withdraw(channelId: `0x${string}`, recipient: `0x${string}`): Promise<`0x${string}`>;
  close(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`>;
  watchChallengeRegistered(
    channelId: `0x${string}` | null,
    onChallenge: (channelId: string, version: number, deadline: bigint) => void,
  ): () => void;
  watchChannelFinalized(
    channelId: `0x${string}` | null,
    onFinalized: (channelId: string, finalVersion: number) => void,
  ): () => void;
  pollForFinalization(
    channelId: `0x${string}`,
    timeoutMs: number,
    pollIntervalMs?: number,
  ): Promise<void>;
}

// ─── DisputeWatcher config ────────────────────────────────────────────────────

export interface DisputeWatcherConfig {
  custodyClient: ICustodyClient;
  persistence: PersistenceAdapter;
  /** ms — default 15_000 */
  pollInterval?: number;
}

// ─── ClearNodeMonitor config ──────────────────────────────────────────────────

export interface ClearNodeMonitorConfig {
  /** ms without any ClearNode message before emitting 'silence' — default 30_000 */
  silenceTimeout: number;
}

// ─── DisputeWatcher events ────────────────────────────────────────────────────

export type DisputeWatcherEvent = 'challenge' | 'responded' | 'finalized' | 'reclaimed';

export interface ChallengeInfo {
  channelId: string;
  challengeVersion: number;
  deadline: Date;
}

export interface RespondedInfo {
  channelId: string;
  txHash: `0x${string}`;
  ourVersion: number;
}

// ─── CustodyClient config ─────────────────────────────────────────────────────

export interface CustodyClientConfig {
  rpcUrl: string;
  chain: Chain;
  custodyAddress: `0x${string}`;
  /** viem WalletClient with account attached — required for write operations */
  walletClient: import('viem').WalletClient;
}

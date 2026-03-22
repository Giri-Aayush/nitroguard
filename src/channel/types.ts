import type { Chain } from 'viem';

// ─── Channel Status ──────────────────────────────────────────────────────────

export type ChannelStatus = 'VOID' | 'INITIAL' | 'ACTIVE' | 'DISPUTE' | 'FINAL';

// On-chain uint8 enum mapping (mirrors ERC-7824 Status)
export const CHANNEL_STATUS_UINT: Record<ChannelStatus, number> = {
  VOID: 0,
  INITIAL: 1,
  ACTIVE: 2,
  DISPUTE: 3,
  FINAL: 4,
};

export const UINT_CHANNEL_STATUS: Record<number, ChannelStatus> = {
  0: 'VOID',
  1: 'INITIAL',
  2: 'ACTIVE',
  3: 'DISPUTE',
  4: 'FINAL',
};

// ─── State Intent ────────────────────────────────────────────────────────────

export type StateIntent = 'CHANOPEN' | 'CHANFINAL' | 'APP';

// ─── Assets ──────────────────────────────────────────────────────────────────

export interface AssetAllocation {
  /** ERC-20 token address (0x0 for native ETH) */
  token: `0x${string}`;
  /** Amount in token's smallest unit */
  amount: bigint;
}

export interface Amount {
  token: `0x${string}`;
  amount: bigint;
}

// ─── Allocation (per-participant balances for a given asset) ─────────────────

export interface Allocation {
  /** Token address */
  token: `0x${string}`;
  /** Balance for participant[0] (client) */
  clientBalance: bigint;
  /** Balance for participant[1] (ClearNode) */
  clearNodeBalance: bigint;
}

// ─── Channel Parameters (FixedPart equivalent) ───────────────────────────────

export interface ChannelParams {
  /** [clientAddress, clearNodeAddress] */
  participants: [string, string];
  /** Unique nonce to differentiate channels between same participants */
  nonce: bigint;
  /** App definition contract address */
  appDefinition: `0x${string}`;
  /** Challenge period in seconds (default 3600) */
  challengeDuration: number;
  /** Chain ID */
  chainId: number;
}

// ─── Signed State (VariablePart + co-signatures) ─────────────────────────────

export interface SignedState {
  /** Derived channel ID */
  channelId: string;
  /** Monotonically increasing version counter (maps to turnNum in nitrolite) */
  version: number;
  /** State intent */
  intent: StateIntent;
  /** ABI-encoded application data */
  data: `0x${string}`;
  /** Per-asset allocation at this version */
  allocations: Allocation[];
  /** Client's EIP-712 signature */
  sigClient: `0x${string}`;
  /** ClearNode's EIP-712 signature */
  sigClearNode: `0x${string}`;
  /** Timestamp when this state was saved locally */
  savedAt: number;
}

// ─── Channel Events ──────────────────────────────────────────────────────────

export type ChannelEvent =
  | 'statusChange'
  | 'stateUpdate'
  | 'error'
  | 'challengeDetected'
  | 'challengeResponded'
  | 'fundsReclaimed';

export type ChannelEventMap = {
  statusChange: [status: ChannelStatus, prev: ChannelStatus];
  stateUpdate: [version: number, state: SignedState];
  error: [error: Error];
  challengeDetected: [channelId: string];
  challengeResponded: [channelId: string, txHash: `0x${string}`];
  fundsReclaimed: [channelId: string, amounts: Amount[]];
};

// ─── Send Options / Results ──────────────────────────────────────────────────

export interface SendOptions {
  /** Co-signature timeout in ms (default 5000) */
  timeoutMs?: number;
}

export interface SendResult {
  version: number;
  state: SignedState;
}

// ─── Close Options / Results ─────────────────────────────────────────────────

export interface CloseOptions {
  /** If co-sig times out, skip auto forceClose (default: false) */
  noAutoForce?: boolean;
  /** Co-signature timeout in ms (default 10000) */
  timeoutMs?: number;
}

export interface CloseResult {
  txHash: `0x${string}`;
  finalState: SignedState;
}

// ─── ForceClose Options / Results ────────────────────────────────────────────

export interface ForceCloseOptions {
  /** Override the state to submit (default: latest persisted) */
  state?: SignedState;
}

export interface ForceCloseResult {
  challengeTxHash: `0x${string}`;
  withdrawTxHash: `0x${string}`;
  reclaimedAmounts: Amount[];
}

// ─── Checkpoint Result ────────────────────────────────────────────────────────

export interface CheckpointResult {
  txHash: `0x${string}`;
  version: number;
}

// ─── Withdraw Result ─────────────────────────────────────────────────────────

export interface WithdrawResult {
  txHash: `0x${string}`;
  amounts: Amount[];
}

// ─── Open Config ─────────────────────────────────────────────────────────────

export interface OpenConfig {
  // Required
  clearnode: string;
  signer: import('../signing/types.js').EIP712Signer;
  assets: AssetAllocation[];

  // Network
  chain: Chain;
  rpcUrl: string;
  custodyAddress?: `0x${string}`;

  // Channel parameters
  challengePeriod?: number;
  counterparty?: string;

  // Persistence
  persistence?: import('../persistence/PersistenceAdapter.js').PersistenceAdapter;

  // Dispute
  autoDispute?: boolean;
  clearnodeSilenceTimeout?: number;
  /** Phase 2: inject a custody client (use MockCustodyClient in tests) */
  custodyClient?: import('../dispute/types.js').ICustodyClient;

  // Callbacks
  onStatusChange?: (status: ChannelStatus, prev: ChannelStatus) => void;
  onStateUpdate?: (version: number, state: SignedState) => void;
  onError?: (error: Error) => void;
  onChallengeDetected?: (channelId: string) => void;
  onChallengeResponded?: (channelId: string, txHash: `0x${string}`) => void;
  onFundsReclaimed?: (channelId: string, amounts: Amount[]) => void;
}

// ─── Restore Config ──────────────────────────────────────────────────────────

export interface RestoreConfig {
  clearnode: string;
  signer: import('../signing/types.js').EIP712Signer;
  chain: Chain;
  rpcUrl: string;
  custodyAddress?: `0x${string}`;
  persistence?: import('../persistence/PersistenceAdapter.js').PersistenceAdapter;
  /** Phase 2: inject a custody client for dispute protection after restore */
  custodyClient?: import('../dispute/types.js').ICustodyClient;
  onStatusChange?: (status: ChannelStatus, prev: ChannelStatus) => void;
  onError?: (error: Error) => void;
}

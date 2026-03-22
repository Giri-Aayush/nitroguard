/**
 * NitroGuard — Production-grade state channel lifecycle SDK for Yellow Network.
 *
 * @example
 * ```ts
 * import { NitroGuard } from 'nitroguard';
 * import { mainnet } from 'viem/chains';
 *
 * const channel = await NitroGuard.open({
 *   clearnode: 'wss://clearnet.yellow.com/ws',
 *   signer,
 *   chain: mainnet,
 *   rpcUrl: 'https://eth.llamarpc.com',
 *   assets: [{ token: USDC, amount: 100n * 10n ** 6n }],
 * });
 *
 * await channel.send({ type: 'payment', to: bob, amount: 10n });
 * await channel.close();
 * ```
 */

export { Channel } from './channel/Channel.js';
export { ChannelFactory } from './channel/ChannelFactory.js';
export { ChannelFSM } from './channel/ChannelFSM.js';
export { VersionManager } from './channel/VersionManager.js';

export { MemoryAdapter } from './persistence/MemoryAdapter.js';
export type { PersistenceAdapter } from './persistence/PersistenceAdapter.js';

export { ViemSigner } from './signing/adapters/ViemSigner.js';
export { RawSigner } from './signing/adapters/RawSigner.js';
export type { EIP712Signer, EIP712SignParams, EIP712Domain } from './signing/types.js';

export type {
  ChannelStatus,
  ChannelEvent,
  ChannelEventMap,
  ChannelParams,
  SignedState,
  AssetAllocation,
  Amount,
  Allocation,
  StateIntent,
  OpenConfig,
  RestoreConfig,
  SendOptions,
  SendResult,
  CloseOptions,
  CloseResult,
  ForceCloseOptions,
  ForceCloseResult,
  CheckpointResult,
  WithdrawResult,
} from './channel/types.js';

export {
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
} from './errors/index.js';

export type { ClearNodeTransport } from './channel/transport.js';

// ─── NitroGuard namespace ─────────────────────────────────────────────────────

import { ChannelFactory } from './channel/ChannelFactory.js';
import type { OpenConfig, RestoreConfig, ChannelStatus, ChannelParams } from './channel/types.js';
import type { ClearNodeTransport } from './channel/transport.js';

export const NitroGuard = {
  /**
   * Open a new state channel.
   *
   * @param config - Channel configuration
   * @param transport - ClearNode transport (Phase 1: inject manually;
   *                    Phase 2: built-in yellow-ts transport)
   */
  open: (config: OpenConfig, transport: ClearNodeTransport) =>
    ChannelFactory.open(config, transport),

  /**
   * Restore a channel from persistence after a disconnect or restart.
   */
  restore: (channelId: string, config: RestoreConfig, transport: ClearNodeTransport) =>
    ChannelFactory.restore(channelId, config, transport),

  /**
   * Restore all channels found in persistence.
   */
  restoreAll: (config: RestoreConfig, transport: ClearNodeTransport) =>
    ChannelFactory.restoreAll(config, transport),

  /**
   * Compute the deterministic channel ID from channel parameters.
   */
  computeChannelId: (params: ChannelParams) =>
    ChannelFactory.computeChannelId(params),
};

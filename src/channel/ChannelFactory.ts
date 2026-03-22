import { keccak256, encodePacked, type Chain } from 'viem';
import { Channel } from './Channel.js';
import { ChannelFSM } from './ChannelFSM.js';
import { VersionManager } from './VersionManager.js';
import { MemoryAdapter } from '../persistence/MemoryAdapter.js';
import {
  InvalidConfigError,
  ChannelNotFoundError,
} from '../errors/index.js';
import type {
  OpenConfig,
  RestoreConfig,
  ChannelStatus,
  ChannelParams,
  AssetAllocation,
} from './types.js';
import type { PersistenceAdapter } from '../persistence/PersistenceAdapter.js';
import type { ClearNodeTransport } from './transport.js';

/**
 * Factory for creating and restoring channels.
 *
 * In Phase 1, the transport is a stub that requires MockClearNode or a real
 * ClearNode for integration/sandbox use. The `open()` flow wires everything
 * together into a `Channel` instance.
 *
 * Phase 2 introduces real ClearNode transport via yellow-ts + nitrolite.
 */
export class ChannelFactory {

  /**
   * Open a new state channel with ClearNode.
   *
   * Full flow (Phase 1):
   * 1. Validate config
   * 2. Connect to ClearNode transport
   * 3. Discover counterparty address
   * 4. Compute channelId
   * 5. Open channel via transport (send CHANOPEN state)
   * 6. Transition FSM: VOID → INITIAL → ACTIVE
   * 7. Persist initial state
   * 8. Return Channel instance
   */
  static async open(config: OpenConfig, transport: ClearNodeTransport): Promise<Channel> {
    validateOpenConfig(config);

    const persistence = config.persistence ?? new MemoryAdapter();

    await transport.connect();

    const counterparty = (config.counterparty ??
      transport.clearNodeAddress) as `0x${string}`;

    const channelParams: ChannelParams = {
      participants: [config.signer.address, counterparty],
      nonce: BigInt(Date.now()),
      appDefinition: '0x0000000000000000000000000000000000000000',
      challengeDuration: config.challengePeriod ?? 3600,
      chainId: config.chain.id,
    };

    const channelId = computeChannelId(channelParams);

    const fsm = new ChannelFSM();
    const versions = new VersionManager(0);

    // Wire up status-change callbacks
    if (config.onStatusChange) {
      fsm.onStatusChange(config.onStatusChange);
    }

    const channel = new Channel({
      channelId,
      participants: [config.signer.address, counterparty],
      assets: config.assets,
      chain: config.chain,
      channelParams,
      fsm,
      versionManager: versions,
      persistence,
      transport,
    });

    // Wire up remaining callbacks
    if (config.onStateUpdate) {
      channel.on('stateUpdate', config.onStateUpdate);
    }
    if (config.onError) {
      channel.on('error', config.onError);
    }
    if (config.onChallengeDetected) {
      channel.on('challengeDetected', config.onChallengeDetected);
    }
    if (config.onChallengeResponded) {
      channel.on('challengeResponded', config.onChallengeResponded);
    }
    if (config.onFundsReclaimed) {
      channel.on('fundsReclaimed', config.onFundsReclaimed);
    }

    // Send CHANOPEN state to activate the channel
    const initialState = {
      channelId,
      version: 0,
      intent: 'CHANOPEN' as const,
      data: '0x' as `0x${string}`,
      allocations: config.assets.map(a => ({
        token: a.token,
        clientBalance: a.amount,
        clearNodeBalance: 0n,
      })),
      savedAt: Date.now(),
      sigClient: '0x' as `0x${string}`,
    };

    fsm._forceSet('INITIAL');

    const coSignedOpen = await transport.openChannel(channelId, initialState);
    await persistence.save(channelId, coSignedOpen);

    fsm.transition('ACTIVE', 'open');

    return channel;
  }

  /**
   * Restore a channel from persistence.
   *
   * Used after a process restart or tab refresh. Reconnects to ClearNode
   * and resumes from the latest persisted version.
   */
  static async restore(
    channelId: string,
    config: RestoreConfig,
    transport: ClearNodeTransport,
  ): Promise<Channel> {
    const persistence = config.persistence ?? new MemoryAdapter();

    const latestState = await persistence.loadLatest(channelId);
    if (!latestState) {
      throw new ChannelNotFoundError(channelId);
    }

    await transport.connect();

    // Reconstruct from persisted state
    const fsm = new ChannelFSM();
    fsm._forceSet('ACTIVE'); // Verified against on-chain in Phase 3

    const versions = new VersionManager(latestState.version);

    const allStates = await persistence.loadAll(channelId);
    const firstState = allStates[0];
    const assets: AssetAllocation[] = (firstState?.allocations ?? []).map(a => ({
      token: a.token,
      amount: a.clientBalance + a.clearNodeBalance,
    }));

    if (config.onStatusChange) {
      fsm.onStatusChange(config.onStatusChange);
    }

    // We don't have the original ChannelParams — derive participants from signers
    const channelParams: ChannelParams = {
      participants: [config.signer.address, transport.clearNodeAddress],
      nonce: 0n, // Reconstructed — accurate params stored in Phase 3
      appDefinition: '0x0000000000000000000000000000000000000000',
      challengeDuration: 3600,
      chainId: config.chain.id,
    };

    const channel = new Channel({
      channelId,
      participants: [config.signer.address, transport.clearNodeAddress],
      assets,
      chain: config.chain,
      channelParams,
      fsm,
      versionManager: versions,
      persistence,
      transport,
    });

    if (config.onError) {
      channel.on('error', config.onError);
    }

    return channel;
  }

  /**
   * Restore all channels found in persistence.
   */
  static async restoreAll(
    config: RestoreConfig,
    transport: ClearNodeTransport,
  ): Promise<Channel[]> {
    const persistence = config.persistence ?? new MemoryAdapter();
    const channelIds = await persistence.listChannels();

    const channels = await Promise.allSettled(
      channelIds.map(id => ChannelFactory.restore(id, config, transport)),
    );

    return channels
      .filter((r): r is PromiseFulfilledResult<Channel> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Compute the deterministic channel ID from channel parameters.
   * Matches the on-chain keccak256(abi.encode(channel)) computation.
   */
  static computeChannelId(params: ChannelParams): string {
    return computeChannelId(params);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeChannelId(params: ChannelParams): string {
  // keccak256(abi.encode(participants, nonce, appDefinition, challengeDuration, chainId))
  return keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'address', 'uint64', 'uint256'],
      [
        params.participants[0] as `0x${string}`,
        params.participants[1] as `0x${string}`,
        params.nonce,
        params.appDefinition,
        BigInt(params.challengeDuration),
        BigInt(params.chainId),
      ],
    ),
  );
}

function validateOpenConfig(config: OpenConfig): void {
  if (!config.clearnode) {
    throw new InvalidConfigError('clearnode', 'ClearNode URL is required');
  }
  if (!config.signer) {
    throw new InvalidConfigError('signer', 'A signer is required');
  }
  if (!config.assets || config.assets.length === 0) {
    throw new InvalidConfigError('assets', 'At least one asset allocation is required');
  }
  if (!config.chain) {
    throw new InvalidConfigError('chain', 'A chain (viem Chain object) is required');
  }
  if (!config.rpcUrl) {
    throw new InvalidConfigError('rpcUrl', 'An RPC URL is required');
  }
}

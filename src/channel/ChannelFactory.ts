import { keccak256, encodePacked, type Chain } from 'viem';
import { Channel } from './Channel.js';
import { ChannelFSM } from './ChannelFSM.js';
import { VersionManager } from './VersionManager.js';
import { MemoryAdapter } from '../persistence/MemoryAdapter.js';
import { ClearNodeMonitor } from '../dispute/ClearNodeMonitor.js';
import { DisputeWatcher } from '../dispute/DisputeWatcher.js';
import {
  InvalidConfigError,
  ChannelNotFoundError,
} from '../errors/index.js';
import type {
  OpenConfig,
  RestoreConfig,
  ChannelParams,
  AssetAllocation,
} from './types.js';
import type { ClearNodeTransport } from './transport.js';

/**
 * Factory for creating and restoring channels.
 *
 * Wires together Channel, FSM, VersionManager, persistence, transport,
 * CustodyClient (Phase 2), ClearNodeMonitor (Phase 2), and DisputeWatcher
 * (Phase 2) into a ready-to-use Channel instance.
 */
export class ChannelFactory {

  /**
   * Open a new state channel with ClearNode.
   *
   * Full flow:
   * 1. Validate config
   * 2. Connect to ClearNode transport
   * 3. Discover counterparty address
   * 4. Compute channelId
   * 5. Open channel via transport (send CHANOPEN state)
   * 6. Transition FSM: VOID → INITIAL → ACTIVE
   * 7. Persist initial state
   * 8. Wire ClearNodeMonitor and DisputeWatcher (if custodyClient provided)
   * 9. Return Channel instance
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
      custodyClient: config.custodyClient,
    });

    // Wire up callbacks
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

    // Phase 2: wire ClearNodeMonitor
    if (config.clearnodeSilenceTimeout && config.clearnodeSilenceTimeout > 0) {
      const monitor = new ClearNodeMonitor(channelId, {
        silenceTimeout: config.clearnodeSilenceTimeout,
      });

      const unsubMsg = transport.onMessage((msg) => monitor.handleMessage(msg));

      monitor.on('silence', () => {
        if (config.autoDispute !== false && channel.status === 'ACTIVE') {
          channel.forceClose().catch(() => {
            // Error surfaced via channel 'error' event inside forceClose
          });
        }
      });

      monitor.start();

      channel.on('statusChange', (to) => {
        if (to === 'FINAL' || to === 'VOID') {
          monitor.stop();
          unsubMsg();
        }
      });
    }

    // Phase 2: wire DisputeWatcher
    if (config.custodyClient && (config.autoDispute !== false)) {
      const watcher = new DisputeWatcher({
        custodyClient: config.custodyClient,
        persistence,
      });

      const latestState = await persistence.loadLatest(channelId);
      if (latestState) {
        watcher.watch(channelId, latestState);
      }

      channel.on('stateUpdate', (_, state) => {
        watcher.updateState(channelId, state);
      });

      watcher.on('responded', (cId: unknown, txHash: unknown) => {
        if (cId === channelId) {
          channel._onChallengeCleared(txHash as `0x${string}`);
        }
      });

      await watcher.start();
    }

    return channel;
  }

  /**
   * Restore a channel from persistence after a process restart or tab refresh.
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

    const fsm = new ChannelFSM();
    fsm._forceSet('ACTIVE');

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

    const channelParams: ChannelParams = {
      participants: [config.signer.address, transport.clearNodeAddress],
      nonce: 0n,
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
      custodyClient: config.custodyClient,
    });

    if (config.onError) {
      channel.on('error', config.onError);
    }

    // Phase 2: re-attach DisputeWatcher on restore
    if (config.custodyClient) {
      const watcher = new DisputeWatcher({
        custodyClient: config.custodyClient,
        persistence,
      });

      watcher.watch(channelId, latestState);

      channel.on('stateUpdate', (_, state) => {
        watcher.updateState(channelId, state);
      });

      watcher.on('responded', (cId: unknown, txHash: unknown) => {
        if (cId === channelId) {
          channel._onChallengeCleared(txHash as `0x${string}`);
        }
      });

      await watcher.start();
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
   */
  static computeChannelId(params: ChannelParams): string {
    return computeChannelId(params);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeChannelId(params: ChannelParams): string {
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

import {
  createPublicClient,
  http,
  type WalletClient,
  type Chain,
  type PublicClient,
} from 'viem';
import { CUSTODY_ABI } from './CustodyABI.js';
import { ChallengeMissedError } from '../errors/index.js';
import type { ICustodyClient, CustodyClientConfig } from '../dispute/types.js';
import type { SignedState, ChannelStatus } from '../channel/types.js';
import { UINT_CHANNEL_STATUS } from '../channel/types.js';

// ─── Intent encoding ──────────────────────────────────────────────────────────

const STATE_INTENT_UINT = {
  CHANOPEN: 0,
  APP: 1,
  CHANFINAL: 2,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signedStateToArgs(state: SignedState) {
  return {
    stateData: {
      intent: STATE_INTENT_UINT[state.intent],
      version: BigInt(state.version),
      data: state.data,
      allocations: state.allocations.map(a => ({
        token: a.token,
        clientBalance: a.clientBalance,
        clearNodeBalance: a.clearNodeBalance,
      })),
    },
    sigs: [state.sigClient, state.sigClearNode] as [`0x${string}`, `0x${string}`],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── CustodyClient ────────────────────────────────────────────────────────────

/**
 * Wraps the Yellow Network Custody contract for all on-chain interactions.
 *
 * Uses viem for typed contract calls. Requires a WalletClient with an account
 * attached for write operations.
 *
 * In tests, use MockCustodyClient instead.
 */
export class CustodyClient implements ICustodyClient {
  private readonly _public: PublicClient;
  private readonly _wallet: WalletClient;
  private readonly _custodyAddress: `0x${string}`;
  private readonly _chain: Chain;

  constructor(config: CustodyClientConfig) {
    this._custodyAddress = config.custodyAddress;
    this._chain = config.chain;
    this._wallet = config.walletClient;
    this._public = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async getOnChainStatus(channelId: `0x${string}`): Promise<ChannelStatus> {
    const raw = await this._public.readContract({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'getChannelStatus',
      args: [channelId],
    });
    const status = UINT_CHANNEL_STATUS[Number(raw)];
    return status ?? 'VOID';
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  async challenge(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    const { stateData, sigs } = signedStateToArgs(state);
    const account = this._wallet.account;
    if (!account) throw new Error('CustodyClient: walletClient has no account');
    return this._wallet.writeContract({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'challenge',
      args: [channelId, stateData, sigs],
      account,
      chain: this._chain,
    });
  }

  async respond(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    const { stateData, sigs } = signedStateToArgs(state);
    const account = this._wallet.account;
    if (!account) throw new Error('CustodyClient: walletClient has no account');
    return this._wallet.writeContract({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'respond',
      args: [channelId, stateData, sigs],
      account,
      chain: this._chain,
    });
  }

  async checkpoint(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    const { stateData, sigs } = signedStateToArgs(state);
    const account = this._wallet.account;
    if (!account) throw new Error('CustodyClient: walletClient has no account');
    return this._wallet.writeContract({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'checkpoint',
      args: [channelId, stateData, sigs],
      account,
      chain: this._chain,
    });
  }

  async withdraw(channelId: `0x${string}`, recipient: `0x${string}`): Promise<`0x${string}`> {
    const account = this._wallet.account;
    if (!account) throw new Error('CustodyClient: walletClient has no account');
    return this._wallet.writeContract({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'withdraw',
      args: [channelId, recipient],
      account,
      chain: this._chain,
    });
  }

  async close(channelId: `0x${string}`, state: SignedState): Promise<`0x${string}`> {
    const { stateData, sigs } = signedStateToArgs(state);
    const account = this._wallet.account;
    if (!account) throw new Error('CustodyClient: walletClient has no account');
    return this._wallet.writeContract({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'close',
      args: [channelId, stateData, sigs],
      account,
      chain: this._chain,
    });
  }

  // ─── Event watching ───────────────────────────────────────────────────────

  watchChallengeRegistered(
    channelId: `0x${string}` | null,
    onChallenge: (channelId: string, version: number, deadline: bigint) => void,
  ): () => void {
    return this._public.watchContractEvent({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      eventName: 'ChallengeRegistered',
      args: channelId ? { channelId } : undefined,
      onLogs: (logs) => {
        for (const log of logs) {
          const { channelId: cId, challengeVersion, deadline } = (log as {
            args: { channelId: `0x${string}`; challengeVersion: bigint; deadline: bigint };
          }).args;
          if (cId) {
            onChallenge(cId, Number(challengeVersion), deadline);
          }
        }
      },
    });
  }

  watchChannelFinalized(
    channelId: `0x${string}` | null,
    onFinalized: (channelId: string, finalVersion: number) => void,
  ): () => void {
    return this._public.watchContractEvent({
      address: this._custodyAddress,
      abi: CUSTODY_ABI,
      eventName: 'ChannelFinalized',
      args: channelId ? { channelId } : undefined,
      onLogs: (logs) => {
        for (const log of logs) {
          const { channelId: cId, finalVersion } = (log as {
            args: { channelId: `0x${string}`; finalVersion: bigint };
          }).args;
          if (cId) {
            onFinalized(cId, Number(finalVersion));
          }
        }
      },
    });
  }

  // ─── Polling ──────────────────────────────────────────────────────────────

  async pollForFinalization(
    channelId: `0x${string}`,
    timeoutMs: number,
    pollIntervalMs = 5_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getOnChainStatus(channelId);
      if (status === 'FINAL' || status === 'VOID') return;
      await sleep(Math.min(pollIntervalMs, deadline - Date.now()));
    }
    throw new ChallengeMissedError(channelId, new Date(deadline));
  }
}

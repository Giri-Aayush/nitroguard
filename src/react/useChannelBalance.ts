import { useState, useEffect } from 'react';
import type { Channel } from '../channel/Channel.js';
import type { Amount, SignedState } from '../channel/types.js';

export interface ChannelBalance {
  /** Client-side balance summed across all assets */
  myBalance: bigint;
  /** ClearNode-side balance summed across all assets */
  theirBalance: bigint;
  /** Per-token client balances */
  balances: Amount[];
}

/**
 * Reactive channel balance hook. Updates on every co-signed state.
 *
 * Reads real-time allocation data directly from `SignedState.allocations`
 * rather than the initial `channel.assets` deposits, so it reflects
 * the actual current split between client and ClearNode.
 *
 * @example
 * ```tsx
 * const { myBalance, theirBalance } = useChannelBalance(channel);
 * return <p>{myBalance.toString()} USDC</p>;
 * ```
 */
export function useChannelBalance(channel: Channel | null): ChannelBalance {
  const [balance, setBalance] = useState<ChannelBalance>(() =>
    computeInitialBalance(channel),
  );

  useEffect(() => {
    if (!channel) {
      setBalance({ myBalance: 0n, theirBalance: 0n, balances: [] });
      return;
    }

    setBalance(computeInitialBalance(channel));

    return channel.on('stateUpdate', (_version, state: SignedState) => {
      setBalance(computeFromState(state));
    });
  }, [channel]);

  return balance;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeInitialBalance(channel: Channel | null): ChannelBalance {
  if (!channel) return { myBalance: 0n, theirBalance: 0n, balances: [] };
  const myBalance = channel.assets.reduce((sum, a) => sum + a.amount, 0n);
  return {
    myBalance,
    theirBalance: 0n,
    balances: channel.assets.map(a => ({ token: a.token, amount: a.amount })),
  };
}

function computeFromState(state: SignedState): ChannelBalance {
  const myBalance = state.allocations.reduce(
    (sum, a) => sum + a.clientBalance,
    0n,
  );
  const theirBalance = state.allocations.reduce(
    (sum, a) => sum + a.clearNodeBalance,
    0n,
  );
  const balances: Amount[] = state.allocations.map(a => ({
    token: a.token,
    amount: a.clientBalance,
  }));
  return { myBalance, theirBalance, balances };
}

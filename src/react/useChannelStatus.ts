import { useState, useEffect } from 'react';
import type { Channel } from '../channel/Channel.js';
import type { ChannelStatus } from '../channel/types.js';

/**
 * Lightweight hook that subscribes to status changes on a Channel.
 *
 * Returns 'VOID' when channel is null. Re-renders only on status changes,
 * not on every state update — prefer this over `useChannel()` when you only
 * need to display the channel status badge.
 *
 * @example
 * ```tsx
 * const status = useChannelStatus(channel);
 * return <Badge color={status === 'ACTIVE' ? 'green' : 'gray'}>{status}</Badge>;
 * ```
 */
export function useChannelStatus(channel: Channel | null): ChannelStatus {
  const [status, setStatus] = useState<ChannelStatus>(
    channel?.status ?? 'VOID',
  );

  useEffect(() => {
    if (!channel) {
      setStatus('VOID');
      return;
    }

    setStatus(channel.status);
    // channel.on() returns the unsubscribe function — return it directly
    return channel.on('statusChange', (to) => setStatus(to));
  }, [channel]);

  return status;
}

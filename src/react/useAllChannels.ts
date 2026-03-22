import { useState, useEffect } from 'react';
import { useNitroGuardContext } from './NitroGuardProvider.js';

export interface UseAllChannelsResult {
  /** Channel IDs found in the persistence adapter. */
  channelIds: string[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Lists all channel IDs stored in the configured persistence adapter.
 *
 * SSR-safe: `createPersistence()` is only called inside `useEffect`.
 * Use this to render a list of channels that can be restored with
 * `ChannelFactory.restore()`.
 *
 * Returns an empty array when no persistence adapter is configured.
 *
 * @example
 * ```tsx
 * const { channelIds, isLoading } = useAllChannels();
 * return isLoading ? <Spinner /> : channelIds.map(id => <ChannelRow key={id} id={id} />);
 * ```
 */
export function useAllChannels(): UseAllChannelsResult {
  const ctx = useNitroGuardContext();
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!ctx.createPersistence) {
      setChannelIds([]);
      return;
    }

    setIsLoading(true);
    const persistence = ctx.createPersistence();

    persistence
      .listChannels()
      .then(ids => {
        setChannelIds(ids);
        setError(null);
      })
      .catch(err => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setIsLoading(false));
  }, [ctx]);

  return { channelIds, isLoading, error };
}

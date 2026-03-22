import { useState, useEffect, useRef, useCallback } from 'react';
import { ChannelFactory } from '../channel/ChannelFactory.js';
import { useNitroGuardContext } from './NitroGuardProvider.js';
import type { Channel } from '../channel/Channel.js';
import type {
  ChannelStatus,
  AssetAllocation,
  SendOptions,
  SendResult,
  CloseOptions,
  CloseResult,
} from '../channel/types.js';
import type { ClearNodeTransport } from '../channel/transport.js';

export interface UseChannelOptions {
  /** If provided, the channel is opened automatically on mount with these assets. */
  autoOpen?: AssetAllocation[];
}

export interface UseChannelResult {
  /** The live Channel instance, or null before open() is called. */
  channel: Channel | null;
  /** Current FSM status ('VOID' before open). */
  status: ChannelStatus;
  /** Latest confirmed version (0 before any send). */
  version: number;
  /** True while open() or close() is in flight. */
  isLoading: boolean;
  /** Last error, or null. Cleared on the next successful operation. */
  error: Error | null;
  /** Open a new channel with the given assets. */
  open: (assets: AssetAllocation[]) => Promise<void>;
  /** Cooperatively close the channel. */
  close: (options?: CloseOptions) => Promise<CloseResult | undefined>;
  /** Send a typed state update. */
  send: (payload: unknown, options?: SendOptions) => Promise<SendResult | undefined>;
}

/**
 * Primary hook for the full channel lifecycle.
 *
 * SSR-safe: transport and persistence factories are only called inside
 * `useEffect`, never during server-side rendering.
 *
 * StrictMode-safe: the `openingRef` guard prevents the double-invocation
 * in React 18 development mode from opening the channel twice.
 *
 * @example
 * ```tsx
 * const { channel, status, open, send, close } = useChannel();
 *
 * <button onClick={() => open([{ token: USDC, amount: 100n }])}>Open</button>
 * <button onClick={() => send({ type: 'payment', amount: 10n })}>Pay</button>
 * <button onClick={() => close()}>Close</button>
 * ```
 */
export function useChannel(opts?: UseChannelOptions): UseChannelResult {
  const ctx = useNitroGuardContext();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [status, setStatus] = useState<ChannelStatus>('VOID');
  const [version, setVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Whether the effect is still mounted — prevents state updates after unmount
  const mountedRef = useRef(false);
  // Holds the live transport so we can disconnect it on unmount
  const transportRef = useRef<ClearNodeTransport | null>(null);
  // Holds the live channel so send/close can access it without closure staleness
  const channelRef = useRef<Channel | null>(null);
  // Prevents StrictMode double-open (React 18 calls effects twice in dev)
  const openingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Disconnect transport — does NOT close the channel on-chain.
      // State is persisted; the caller can restore it.
      transportRef.current?.disconnect().catch(() => {});
      transportRef.current = null;
      channelRef.current = null;
    };
  }, []);

  const open = useCallback(async (assets: AssetAllocation[]) => {
    // StrictMode guard: skip if already opening or already opened
    if (openingRef.current || channelRef.current) return;
    openingRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      const transport = ctx.createTransport();
      transportRef.current = transport;

      const persistence = ctx.createPersistence?.();

      const ch = await ChannelFactory.open(
        {
          ...ctx.config,
          assets,
          ...(persistence ? { persistence } : {}),
        },
        transport,
      );

      // Guard: component may have unmounted while open() was in flight
      if (!mountedRef.current) {
        await transport.disconnect().catch(() => {});
        return;
      }

      channelRef.current = ch;
      setChannel(ch);
      setStatus(ch.status);
      setVersion(ch.version);

      ch.on('statusChange', (to) => {
        if (mountedRef.current) setStatus(to);
      });
      ch.on('stateUpdate', (v) => {
        if (mountedRef.current) setVersion(v);
      });
      ch.on('error', (err) => {
        if (mountedRef.current) setError(err);
      });
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      openingRef.current = false;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [ctx]);

  const close = useCallback(async (options?: CloseOptions) => {
    const ch = channelRef.current;
    if (!ch) return undefined;
    try {
      setIsLoading(true);
      setError(null);
      return await ch.close(options);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      return undefined;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  const send = useCallback(async (payload: unknown, options?: SendOptions) => {
    const ch = channelRef.current;
    if (!ch) return undefined;
    try {
      setError(null);
      return await ch.send(payload, options);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      return undefined;
    }
  }, []);

  // autoOpen: open with provided assets on first mount
  useEffect(() => {
    if (opts?.autoOpen) {
      open(opts.autoOpen).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally run once on mount only

  return { channel, status, version, isLoading, error, open, close, send };
}

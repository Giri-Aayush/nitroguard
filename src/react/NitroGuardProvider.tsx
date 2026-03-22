import React, { createContext, useContext, useRef } from 'react';
import type { OpenConfig } from '../channel/types.js';
import type { ClearNodeTransport } from '../channel/transport.js';
import type { PersistenceAdapter } from '../persistence/PersistenceAdapter.js';

// ─── Context ──────────────────────────────────────────────────────────────────

export interface NitroGuardContextValue {
  /** Base config passed to ChannelFactory.open(). assets overridden per call. */
  config: Omit<OpenConfig, 'assets' | 'persistence'>;
  /**
   * Factory function for ClearNode transport — called lazily inside useEffect
   * so it is never invoked during SSR.
   */
  createTransport: () => ClearNodeTransport;
  /**
   * Optional persistence adapter factory — called lazily inside useEffect.
   * If omitted, MemoryAdapter is used (Phase 1 default).
   */
  createPersistence?: () => PersistenceAdapter;
}

const NitroGuardContext = createContext<NitroGuardContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface NitroGuardProviderProps extends NitroGuardContextValue {
  children: React.ReactNode;
}

/**
 * Provides NitroGuard configuration to the component tree.
 *
 * Pass factory functions for the transport and persistence adapter — they are
 * called lazily inside `useEffect` so the provider is safe during SSR.
 *
 * @example
 * ```tsx
 * <NitroGuardProvider
 *   config={{ clearnode: 'wss://...', signer, chain: mainnet, rpcUrl: '...' }}
 *   createTransport={() => new MockClearNode()}
 * >
 *   <App />
 * </NitroGuardProvider>
 * ```
 */
export function NitroGuardProvider({
  children,
  config,
  createTransport,
  createPersistence,
}: NitroGuardProviderProps) {
  // useRef keeps the context value referentially stable so consumers
  // don't re-render on every parent render.
  const valueRef = useRef<NitroGuardContextValue>({
    config,
    createTransport,
    ...(createPersistence ? { createPersistence } : {}),
  });

  return (
    <NitroGuardContext.Provider value={valueRef.current}>
      {children}
    </NitroGuardContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the NitroGuard context value from the nearest `<NitroGuardProvider>`.
 * Throws if called outside a provider.
 */
export function useNitroGuardContext(): NitroGuardContextValue {
  const ctx = useContext(NitroGuardContext);
  if (!ctx) {
    throw new Error(
      'useNitroGuardContext: must be used inside <NitroGuardProvider>',
    );
  }
  return ctx;
}

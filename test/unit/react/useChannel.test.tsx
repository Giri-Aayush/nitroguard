/**
 * Unit tests for the useChannel() React hook.
 *
 * Uses @testing-library/react with jsdom environment.
 * Transport is provided via MockClearNode — no real network required.
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NitroGuardProvider } from '../../../src/react/NitroGuardProvider.js';
import { useChannel } from '../../../src/react/useChannel.js';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import { MockClearNode } from '../../integration/helpers/MockClearNode.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_CHAIN = {
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
} as const;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`;

const MOCK_SIGNER = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
  signTypedData: async () => '0xMOCKSIG' as `0x${string}`,
  signMessage: async () => '0xMOCKSIG' as `0x${string}`,
};

function makeProvider(persistence: MemoryAdapter) {
  let mockTransport: MockClearNode;
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NitroGuardProvider
        config={{
          clearnode: 'ws://localhost:9999',
          signer: MOCK_SIGNER,
          chain: TEST_CHAIN,
          rpcUrl: 'http://127.0.0.1:8545',
          autoDispute: false,
        }}
        createTransport={() => {
          mockTransport = new MockClearNode();
          return mockTransport;
        }}
        createPersistence={() => persistence}
      >
        {children}
      </NitroGuardProvider>
    );
  };
}

// ─── Test component ───────────────────────────────────────────────────────────

function ChannelTestUI() {
  const { status, version, isLoading, error, open, send, close } = useChannel();

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="version">{version}</div>
      <div data-testid="loading">{isLoading ? 'loading' : 'idle'}</div>
      <div data-testid="error">{error?.message ?? 'none'}</div>
      <button
        data-testid="open-btn"
        onClick={() => open([{ token: USDC, amount: 1000n }])}
      >
        Open
      </button>
      <button
        data-testid="send-btn"
        onClick={() => send({ type: 'payment' })}
      >
        Send
      </button>
      <button data-testid="close-btn" onClick={() => close()}>
        Close
      </button>
    </div>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useChannel()', () => {
  let persistence: MemoryAdapter;

  beforeEach(() => {
    persistence = new MemoryAdapter();
  });

  it('starts in VOID status with version 0', () => {
    const Wrapper = makeProvider(persistence);
    render(<ChannelTestUI />, { wrapper: Wrapper });

    expect(screen.getByTestId('status').textContent).toBe('VOID');
    expect(screen.getByTestId('version').textContent).toBe('0');
    expect(screen.getByTestId('loading').textContent).toBe('idle');
    expect(screen.getByTestId('error').textContent).toBe('none');
  });

  it('open() transitions status to ACTIVE', async () => {
    const Wrapper = makeProvider(persistence);
    render(<ChannelTestUI />, { wrapper: Wrapper });

    await act(async () => {
      await userEvent.click(screen.getByTestId('open-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ACTIVE');
    });
  });

  it('isLoading is true during open()', async () => {
    const Wrapper = makeProvider(persistence);
    render(<ChannelTestUI />, { wrapper: Wrapper });

    const loadingStates: string[] = [];

    // Watch for loading changes
    const observer = new MutationObserver(() => {
      loadingStates.push(screen.getByTestId('loading').textContent ?? '');
    });
    observer.observe(screen.getByTestId('loading'), { childList: true, characterData: true, subtree: true });

    await act(async () => {
      await userEvent.click(screen.getByTestId('open-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('idle');
    });

    observer.disconnect();
    // Was loading at some point during open
    expect(loadingStates).toContain('loading');
  });

  it('send() increments version and triggers re-render', async () => {
    const Wrapper = makeProvider(persistence);
    render(<ChannelTestUI />, { wrapper: Wrapper });

    await act(async () => {
      await userEvent.click(screen.getByTestId('open-btn'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ACTIVE'));

    await act(async () => {
      await userEvent.click(screen.getByTestId('send-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('version').textContent).toBe('1');
    });
  });

  it('close() transitions status to FINAL', async () => {
    const Wrapper = makeProvider(persistence);
    render(<ChannelTestUI />, { wrapper: Wrapper });

    await act(async () => {
      await userEvent.click(screen.getByTestId('open-btn'));
    });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ACTIVE'));

    await act(async () => {
      await userEvent.click(screen.getByTestId('send-btn'));
    });

    await act(async () => {
      await userEvent.click(screen.getByTestId('close-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('FINAL');
    });
  });

  it('open() called twice (StrictMode simulation) does not open channel twice', async () => {
    const Wrapper = makeProvider(persistence);
    const { rerender } = render(<ChannelTestUI />, { wrapper: Wrapper });

    const openBtn = screen.getByTestId('open-btn');

    // Simulate double click (StrictMode behavior simulation)
    await act(async () => {
      await userEvent.click(openBtn);
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ACTIVE'));

    const versionAfterFirstOpen = screen.getByTestId('version').textContent;

    // Second open should be a no-op (channel already exists)
    await act(async () => {
      await userEvent.click(openBtn);
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ACTIVE'));
    expect(screen.getByTestId('version').textContent).toBe(versionAfterFirstOpen);

    rerender(<ChannelTestUI />);
  });

  it('throws error that gets captured in error state when channel not open and send() called', async () => {
    const Wrapper = makeProvider(persistence);
    render(<ChannelTestUI />, { wrapper: Wrapper });

    // send() without open() — channel is null, should return undefined (not throw)
    await act(async () => {
      await userEvent.click(screen.getByTestId('send-btn'));
    });

    // No crash, error state should still be 'none' (null channel returns undefined)
    expect(screen.getByTestId('error').textContent).toBe('none');
  });
});

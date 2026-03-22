/**
 * Unit tests for useChannelBalance() and useChannelStatus().
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NitroGuardProvider } from '../../../src/react/NitroGuardProvider.js';
import { useChannel } from '../../../src/react/useChannel.js';
import { useChannelBalance } from '../../../src/react/useChannelBalance.js';
import { useChannelStatus } from '../../../src/react/useChannelStatus.js';
import { MemoryAdapter } from '../../../src/persistence/MemoryAdapter.js';
import { MockClearNode } from '../../integration/helpers/MockClearNode.js';

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

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NitroGuardProvider
      config={{
        clearnode: 'ws://localhost:9999',
        signer: MOCK_SIGNER,
        chain: TEST_CHAIN,
        rpcUrl: 'http://127.0.0.1:8545',
        autoDispute: false,
      }}
      createTransport={() => new MockClearNode()}
      createPersistence={() => new MemoryAdapter()}
    >
      {children}
    </NitroGuardProvider>
  );
}

// ─── Balance component ────────────────────────────────────────────────────────

function BalanceUI() {
  const { channel, open, send } = useChannel();
  const { myBalance, theirBalance } = useChannelBalance(channel);
  const status = useChannelStatus(channel);

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="my-balance">{myBalance.toString()}</div>
      <div data-testid="their-balance">{theirBalance.toString()}</div>
      <button onClick={() => open([{ token: USDC, amount: 500n }])}>Open</button>
      <button onClick={() => send({ amount: 10n })}>Send</button>
    </div>
  );
}

describe('useChannelBalance()', () => {
  it('shows zero balances before open', () => {
    render(<BalanceUI />, { wrapper: Wrapper });

    expect(screen.getByTestId('my-balance').textContent).toBe('0');
    expect(screen.getByTestId('their-balance').textContent).toBe('0');
  });

  it('shows initial balance from assets after open', async () => {
    render(<BalanceUI />, { wrapper: Wrapper });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('my-balance').textContent).toBe('500');
    });
  });
});

describe('useChannelStatus()', () => {
  it('shows VOID before channel is opened', () => {
    render(<BalanceUI />, { wrapper: Wrapper });
    expect(screen.getByTestId('status').textContent).toBe('VOID');
  });

  it('shows ACTIVE after channel is opened', async () => {
    render(<BalanceUI />, { wrapper: Wrapper });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ACTIVE');
    });
  });
});

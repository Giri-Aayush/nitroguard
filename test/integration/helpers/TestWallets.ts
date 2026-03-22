import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, type WalletClient, type Account } from 'viem';
import { RawSigner } from '../../../src/signing/adapters/RawSigner.js';
import type { EIP712Signer } from '../../../src/signing/types.js';

/**
 * Pre-funded test wallets for integration tests.
 *
 * Uses well-known Anvil default private keys — never use on mainnet.
 */

// Anvil default accounts (deterministic from mnemonic:
// "test test test test test test test test test test test junk")
export const ANVIL_PRIVATE_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
] as const;

export const ANVIL_ADDRESSES = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
] as const;

export const USDC_ADDRESS: `0x${string}` = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const ETH_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

export interface TestWallet {
  account: Account;
  client: WalletClient;
  signer: EIP712Signer;
  address: `0x${string}`;
}

/**
 * Create test wallets connected to a local Anvil instance.
 */
export function createTestWallets(rpcUrl: string, count = 2): TestWallet[] {
  return Array.from({ length: Math.min(count, ANVIL_PRIVATE_KEYS.length) }, (_, i) => {
    const pk = ANVIL_PRIVATE_KEYS[i] as `0x${string}`;
    const account = privateKeyToAccount(pk);
    const client = createWalletClient({ account, transport: http(rpcUrl) });
    return {
      account,
      client,
      signer: new RawSigner(pk, 31337, rpcUrl),
      address: account.address as `0x${string}`,
    };
  });
}

/** Alice — first test wallet */
export function alice(rpcUrl: string): TestWallet {
  return createTestWallets(rpcUrl, 1)[0]!;
}

/** Bob — second test wallet */
export function bob(rpcUrl: string): TestWallet {
  return createTestWallets(rpcUrl, 2)[1]!;
}

/**
 * Simple payment example — open a channel, send 3 payments, close.
 *
 * Run against the Yellow Network sandbox:
 *   PRIVATE_KEY=0x... RPC_URL=https://rpc.sepolia.org npx ts-node index.ts
 */

import { NitroGuard } from 'nitroguard';
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CLEARNODE_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;

async function main() {
  const privateKey = process.env['PRIVATE_KEY'] as `0x${string}`;
  const rpcUrl = process.env['RPC_URL'] ?? 'https://rpc.sepolia.org';

  if (!privateKey) {
    throw new Error('Set PRIVATE_KEY env var to a Sepolia-funded wallet');
  }

  // ── 1. Create signer ────────────────────────────────────────────────────────
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const signer = {
    address: account.address,
    signTypedData: (params: Parameters<typeof walletClient.signTypedData>[0]) =>
      walletClient.signTypedData(params),
    signMessage: (params: Parameters<typeof walletClient.signMessage>[0]) =>
      walletClient.signMessage(params),
  };

  console.log('Wallet:', account.address);

  // ── 2. Open channel ─────────────────────────────────────────────────────────
  console.log('\nOpening channel...');
  const channel = await NitroGuard.open({
    clearnode: CLEARNODE_URL,
    signer,
    chain: sepolia,
    rpcUrl,
    assets: [{ token: USDC_SEPOLIA, amount: parseUnits('1', 6) }], // 1 USDC
  });

  console.log('Channel ID:', channel.id);
  console.log('Status:', channel.status); // ACTIVE

  // ── 3. Send off-chain payments ───────────────────────────────────────────────
  console.log('\nSending 3 payments...');

  await channel.send({ type: 'payment', to: '0x000000000000000000000000000000000000dEaD', amount: 100_000n });
  console.log(`  Payment 1 sent (version ${channel.version})`);

  await channel.send({ type: 'payment', to: '0x000000000000000000000000000000000000dEaD', amount: 200_000n });
  console.log(`  Payment 2 sent (version ${channel.version})`);

  await channel.send({ type: 'payment', to: '0x000000000000000000000000000000000000dEaD', amount: 50_000n });
  console.log(`  Payment 3 sent (version ${channel.version})`);

  // ── 4. Close cooperatively ───────────────────────────────────────────────────
  console.log('\nClosing channel...');
  const result = await channel.close();

  console.log('Done!');
  console.log('  tx:', result.txHash);
  console.log('  final version:', result.version);
  console.log('  status:', channel.status); // FINAL
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

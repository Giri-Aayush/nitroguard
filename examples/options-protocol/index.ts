/**
 * Options protocol example — typed state channel with Zod schema + transition guards.
 *
 * Demonstrates:
 *   - defineProtocol() with a custom Zod schema
 *   - Transition guards that enforce business rules
 *   - TypedChannel.send() with full TypeScript inference
 *   - ProtocolTransitionError on guard violation
 *
 * Run:
 *   PRIVATE_KEY=0x... RPC_URL=https://rpc.sepolia.org npx ts-node index.ts
 */

import { NitroGuard, defineProtocol, ProtocolTransitionError, ProtocolValidationError } from 'nitroguard';
import { createWalletClient, http, parseUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

const CLEARNODE_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;

// ── 1. Define the protocol ────────────────────────────────────────────────────

const OptionsProtocol = defineProtocol({
  name: 'options-v1',
  version: 1,
  schema: z.object({
    type: z.enum(['open', 'exercise', 'expire']),
    strikePrice: z.bigint().positive(),
    expiry: z.number().positive(),    // Unix milliseconds
    premium: z.bigint().nonnegative(),
  }),
  transitions: {
    // Strike price must always be positive
    validStrike: (_prev, next) => next.strikePrice > 0n,

    // Premium must be non-negative
    validPremium: (_prev, next) => next.premium >= 0n,

    // Can only exercise before expiry
    exerciseBeforeExpiry: (_prev, next) =>
      next.type !== 'exercise' || Date.now() <= next.expiry,

    // Can't go back to 'open' after expiry
    noReopenAfterExpiry: (_prev, next) =>
      next.type !== 'open' || Date.now() <= next.expiry,
  },
});

// ── 2. Main ───────────────────────────────────────────────────────────────────

async function main() {
  const privateKey = process.env['PRIVATE_KEY'] as `0x${string}`;
  const rpcUrl = process.env['RPC_URL'] ?? 'https://rpc.sepolia.org';

  if (!privateKey) {
    throw new Error('Set PRIVATE_KEY env var');
  }

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

  // ── 3. Open a typed channel ──────────────────────────────────────────────────

  console.log('\nOpening options channel...');
  const channel = await NitroGuard.open(
    {
      clearnode: CLEARNODE_URL,
      signer,
      chain: sepolia,
      rpcUrl,
      assets: [{ token: USDC_SEPOLIA, amount: parseUnits('10', 6) }], // 10 USDC collateral
      protocol: OptionsProtocol,
    },
  );

  console.log('Channel ID:', channel.id);
  console.log('Status:', channel.status);

  // ── 4. Open a position ───────────────────────────────────────────────────────

  const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now

  console.log('\nOpening position...');
  await channel.send({
    type: 'open',
    strikePrice: 3_000n * 10n ** 6n,  // $3000 strike
    expiry,
    premium: 50n * 10n ** 6n,         // $50 premium
  });
  console.log('Position opened (version', channel.version, ')');

  // ── 5. Demonstrate validation ────────────────────────────────────────────────

  console.log('\nTrying invalid payload (wrong type)...');
  try {
    // @ts-expect-error — intentional runtime test
    await channel.send({ type: 'invalid-type', strikePrice: 3000n, expiry, premium: 50n });
  } catch (err) {
    if (err instanceof ProtocolValidationError) {
      console.log('  ProtocolValidationError caught (expected):', err.message);
    }
  }

  console.log('\nTrying guard violation (exercise after expiry)...');
  try {
    await channel.send({
      type: 'exercise',
      strikePrice: 3_000n * 10n ** 6n,
      expiry: Date.now() - 1000, // already expired
      premium: 50n * 10n ** 6n,
    });
  } catch (err) {
    if (err instanceof ProtocolTransitionError) {
      console.log('  ProtocolTransitionError caught (expected):', err.message);
      console.log('  Failed guard:', err.guard);
    }
  }

  // ── 6. Exercise the option ────────────────────────────────────────────────────

  console.log('\nExercising option...');
  await channel.send({
    type: 'exercise',
    strikePrice: 3_000n * 10n ** 6n,
    expiry,
    premium: 50n * 10n ** 6n,
  });
  console.log('Option exercised (version', channel.version, ')');

  // ── 7. Settle ────────────────────────────────────────────────────────────────

  console.log('\nSettling channel...');
  const result = await channel.close();
  console.log('Done!');
  console.log('  tx:', result.txHash);
  console.log('  status:', channel.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

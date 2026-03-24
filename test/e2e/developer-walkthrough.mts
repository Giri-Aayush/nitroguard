/**
 * Developer Walkthrough — third-pass end-to-end simulation
 *
 * Simulates exactly what a developer would copy-paste from the docs:
 * 1. quick-start.md  — open, send, metrics, close
 * 2. state-machine.md — invalid transition, restore, restoreAll
 * 3. protocol-schemas.md — PaymentProtocol, SwapProtocol, defineProtocol
 * 4. persistence-guide.md — MemoryAdapter, custom adapter shape
 * 5. dispute-guide.md — forceClose (manual)
 * 6. error handling
 *
 * All against local dist/ — no testnet needed.
 */

import { NitroGuard, MemoryAdapter, InvalidTransitionError, NoPersistenceError, ChannelNotFoundError, defineProtocol } from '../../dist/index.js';
import { PaymentProtocol, SwapProtocol } from '../../dist/protocols/index.js';
import { z } from 'zod';

// ──────────────────────────────────────────────────────────
// Minimal transport stub (copy-pasted from quick-start.md)
// ──────────────────────────────────────────────────────────
const CLEARNODE_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as `0x${string}`;

const transport = {
  isConnected: true,
  clearNodeAddress: CLEARNODE_ADDRESS,
  connect:    async () => {},
  disconnect: async () => {},
  openChannel:  async (_id: string, state: any) => ({ ...state, sigClearNode: '0x' as `0x${string}`, savedAt: Date.now() }),
  closeChannel: async (_id: string, state: any) => ({ ...state, sigClearNode: '0x' as `0x${string}`, savedAt: Date.now() }),
  proposeState: async (_id: string, state: any) => ({ ...state, sigClearNode: '0x' as `0x${string}`, savedAt: Date.now() }),
  onMessage: (_handler: (msg: unknown) => void) => () => {},
};

// ──────────────────────────────────────────────────────────
// Minimal signer stub
// ──────────────────────────────────────────────────────────
const MY_ADDRESS    = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`;
const BOB_ADDRESS   = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as `0x${string}`;
const signer = {
  address: MY_ADDRESS,
  signTypedData: async (_params: any): Promise<`0x${string}`> => '0xdeadbeef' as `0x${string}`,
  signMessage:   async (_params: any): Promise<`0x${string}`> => '0xdeadbeef' as `0x${string}`,
};

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`;
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`;

const config = {
  clearnode: 'wss://clearnet-sandbox.yellow.com/ws',
  signer,
  chain: { id: 1, name: 'mainnet' } as any,
  rpcUrl: 'https://eth.llamarpc.com',
  assets: [{ token: USDC, amount: 100n * 10n ** 6n }],
};

let pass = 0;
let fail = 0;

function ok(label: string) {
  console.log(`  ✓ ${label}`);
  pass++;
}

function ko(label: string, err: unknown) {
  console.error(`  ✗ ${label}:`, err instanceof Error ? err.message : err);
  fail++;
}

// ─────────────────────────────────────────
// 1. Basic open → send → metrics → close
// ─────────────────────────────────────────
console.log('\n[1] Basic lifecycle (quick-start.md)');

{
  const channel = await NitroGuard.open(config, transport);

  try {
    if (channel.status === 'ACTIVE') ok('channel opens in ACTIVE status');
    else ko('channel.status after open', `expected ACTIVE, got ${channel.status}`);
  } catch (e) { ko('open', e); }

  try {
    await channel.send({ type: 'payment', to: '0xBob', amount: 1_000_000n });
    await channel.send({ type: 'payment', to: '0xBob', amount: 500_000n });
    if (channel.version === 2) ok('version increments correctly (2 sends)');
    else ko('channel.version', `expected 2, got ${channel.version}`);
  } catch (e) { ko('send', e); }

  try {
    const m = channel.metrics();
    if (m.messagesSent === 2)           ok('metrics.messagesSent === 2');
    else ko('metrics.messagesSent', m.messagesSent);
    if (typeof m.avgLatencyMs === 'number') ok('metrics.avgLatencyMs is a number');
    else ko('metrics.avgLatencyMs type', typeof m.avgLatencyMs);
    if (typeof m.uptimeMs === 'number')     ok('metrics.uptimeMs is a number');
    else ko('metrics.uptimeMs type', typeof m.uptimeMs);
    if (m.disputeCount === 0)           ok('metrics.disputeCount === 0 before any dispute');
    else ko('metrics.disputeCount', m.disputeCount);
  } catch (e) { ko('metrics()', e); }

  try {
    const result = await channel.close();
    if (result.txHash)                              ok('close() returns txHash');
    if (typeof result.finalState?.version === 'number') ok('result.finalState.version is a number');
    else ko('result.finalState.version', result.finalState?.version);
    if (channel.status === 'FINAL') ok('channel.status is FINAL after close()');
    else ko('channel.status after close', channel.status);
  } catch (e) { ko('close', e); }
}

// ─────────────────────────────────────────
// 2. InvalidTransitionError (state-machine.md)
// ─────────────────────────────────────────
console.log('\n[2] Invalid transition (state-machine.md)');

{
  const channel = await NitroGuard.open(config, transport);

  try {
    await channel.withdraw(); // wrong state — ACTIVE
    ko('withdraw() in ACTIVE should throw', 'no error thrown');
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      ok('InvalidTransitionError thrown for withdraw() in ACTIVE');
      if (err.from === 'ACTIVE')     ok('err.from === ACTIVE');
      else ko('err.from value', err.from);
      if (err.attempted === 'withdraw') ok('err.attempted === withdraw');
      else ko('err.attempted value', err.attempted);
    } else {
      ko('wrong error type', err);
    }
  }

  await channel.close();
}

// ─────────────────────────────────────────
// 3. Persistence + restore (persistence-guide.md)
// ─────────────────────────────────────────
console.log('\n[3] Persistence + restore (persistence-guide.md)');

{
  const persistence = new MemoryAdapter();
  const channel = await NitroGuard.open({ ...config, persistence }, transport);
  await channel.send({ type: 'payment', amount: 5_000_000n });
  const savedId = channel.id;
  await channel.close();
  const closedVersion = channel.version; // version after close() — includes the close state

  try {
    const ids = await persistence.listChannels();
    if (ids.length > 0) ok('persistence.listChannels() returns stored ids');
    else ko('listChannels empty', ids);
  } catch (e) { ko('listChannels', e); }

  try {
    const restored = await NitroGuard.restore(savedId, { ...config, persistence }, transport);
    ok('restore() succeeds');
    if (restored.version === closedVersion) ok(`restored.version matches closed version (${closedVersion})`);
    else ko(`restored.version mismatch`, `expected ${closedVersion}, got ${restored.version}`);
  } catch (e) { ko('restore', e); }
}

// ─────────────────────────────────────────
// 4. ChannelNotFoundError for unknown channelId (persistence-guide.md)
// ─────────────────────────────────────────
console.log('\n[4] ChannelNotFoundError (persistence-guide.md)');

{
  const persistence = new MemoryAdapter();

  try {
    await NitroGuard.restore('0xnonexistent', { ...config, persistence }, transport);
    ko('restore() with unknown id should throw ChannelNotFoundError', 'no error');
  } catch (err) {
    if (err instanceof ChannelNotFoundError) ok('ChannelNotFoundError thrown for unknown channelId');
    else ko('wrong error type for restore()', err instanceof Error ? err.message : err);
  }
}

// ─────────────────────────────────────────
// 5. restoreAll (state-machine.md)
// ─────────────────────────────────────────
console.log('\n[5] restoreAll (state-machine.md)');

{
  const persistence = new MemoryAdapter();
  // Open channels at different timestamps (nonce = Date.now()) so they get different IDs
  const ch1 = await NitroGuard.open({ ...config, persistence }, transport);
  await ch1.send({ n: 1 });
  await ch1.close();
  await new Promise(r => setTimeout(r, 2)); // ensure different nonce
  const ch2 = await NitroGuard.open({ ...config, persistence }, transport);
  await ch2.send({ n: 2 });
  await ch2.close();

  try {
    const all = await NitroGuard.restoreAll({ ...config, persistence }, transport);
    if (all.length === 2) ok('restoreAll() returns 2 channels');
    else ko('restoreAll length', `expected 2, got ${all.length}`);
  } catch (e) { ko('restoreAll', e); }
}

// ─────────────────────────────────────────
// 6. forceClose — uses MemoryAdapter by default (dispute-guide.md)
// ─────────────────────────────────────────
console.log('\n[6] forceClose uses default MemoryAdapter (dispute-guide.md)');

{
  // No explicit persistence — MemoryAdapter is the default
  // forceClose() always works within a session because open() saves the opening state
  const channel = await NitroGuard.open(config, transport);
  await channel.send({ v: 1 });

  try {
    await channel.forceClose();
    // Without custodyClient, forceClose() moves to DISPUTE (challenge submitted).
    // FINAL + withdraw require on-chain settlement — needs a real custodyClient.
    if (channel.status === 'DISPUTE') ok('forceClose() transitions to DISPUTE (on-chain challenge submitted)');
    else ko('channel.status after forceClose', channel.status);
  } catch (e) { ko('forceClose', e); }
}

// ─────────────────────────────────────────
// 7. NoPersistenceError when adapter is cleared (dispute-guide.md)
// ─────────────────────────────────────────
console.log('\n[7] NoPersistenceError after persistence.clear() (dispute-guide.md)');

{
  const persistence = new MemoryAdapter();
  const channel = await NitroGuard.open({ ...config, persistence }, transport);
  const id = channel.id;

  // Manually clear the saved state (simulates corruption / wipe scenario)
  await persistence.clear(id);

  try {
    await channel.forceClose();
    ko('forceClose after clear() should throw NoPersistenceError', 'no error');
  } catch (err) {
    if (err instanceof NoPersistenceError) ok('NoPersistenceError thrown when persistence store is empty');
    else ko('wrong error type for forceClose after clear', err instanceof Error ? err.message : err);
  }
}

// ─────────────────────────────────────────
// 8. PaymentProtocol (protocol-schemas.md)
// ─────────────────────────────────────────
console.log('\n[8] PaymentProtocol (protocol-schemas.md)');

{
  const channel = await NitroGuard.open({ ...config, protocol: PaymentProtocol }, transport);

  try {
    await channel.send({
      type:   'payment',
      to:     BOB_ADDRESS,   // valid 40-char hex address
      amount: 10_000_000n,
      token:  USDC,
      memo:   'coffee',
    });
    ok('PaymentProtocol: valid payment accepted');
  } catch (e) { ko('PaymentProtocol valid send', e); }

  try {
    await (channel as any).send({ type: 'payment', to: BOB_ADDRESS, amount: -1n, token: USDC });
    ko('PaymentProtocol: negative amount should be rejected', 'no error');
  } catch (_e) { ok('PaymentProtocol: negative amount rejected'); }

  try {
    await (channel as any).send({ type: 'payment', to: 'not-an-address', amount: 1n, token: USDC });
    ko('PaymentProtocol: invalid address should be rejected', 'no error');
  } catch (_e) { ok('PaymentProtocol: invalid address rejected'); }

  await channel.close();
}

// ─────────────────────────────────────────
// 9. SwapProtocol (protocol-schemas.md)
// ─────────────────────────────────────────
console.log('\n[9] SwapProtocol (protocol-schemas.md)');

{
  const channel = await NitroGuard.open({ ...config, protocol: SwapProtocol }, transport);

  try {
    await channel.send({
      type:        'offer',
      offerToken:  USDC,
      offerAmount: 100_000_000n,
      wantToken:   WETH,
      wantAmount:  50_000_000_000_000_000n,
      expiry:      Date.now() + 60_000,
    });
    ok('SwapProtocol: valid offer accepted');
  } catch (e) { ko('SwapProtocol offer', e); }

  // same token — must be rejected
  try {
    await (channel as any).send({
      type: 'offer', offerToken: USDC, offerAmount: 100n, wantToken: USDC, wantAmount: 100n, expiry: Date.now() + 60_000,
    });
    ko('SwapProtocol: same-token offer should be rejected', 'no error');
  } catch (_e) { ok('SwapProtocol: same-token offer rejected'); }

  await channel.close();
}

// ─────────────────────────────────────────
// 10. defineProtocol with transition guards (protocol-schemas.md)
// ─────────────────────────────────────────
console.log('\n[10] defineProtocol + transition guards (protocol-schemas.md)');

{
  const TradeProtocol = defineProtocol({
    name:    'trade',
    version: 1,
    schema: z.object({
      amount:          z.bigint(),
      cumulativeTotal: z.bigint(),
    }),
    transitions: {
      positiveAmount:  (_prev: any, next: any) => next.amount > 0n,
      monotonicTotal:  (prev: any, next: any)  => prev === null || next.cumulativeTotal > prev.cumulativeTotal,
      maxPerTx:        (_prev: any, next: any) => next.amount <= 1_000n * 10n ** 6n,
    },
  });

  const channel = await NitroGuard.open({ ...config, protocol: TradeProtocol }, transport);

  try {
    await channel.send({ amount: 100n * 10n ** 6n, cumulativeTotal: 100n * 10n ** 6n });
    ok('defineProtocol: valid trade accepted');
  } catch (e) { ko('defineProtocol valid', e); }

  try {
    await channel.send({ amount: 5_000n * 10n ** 6n, cumulativeTotal: 5_100n * 10n ** 6n });
    ko('transition guard maxPerTx should throw', 'no error');
  } catch (_e) { ok('transition guard maxPerTx blocks over-limit trade'); }

  await channel.close();
}

// ─────────────────────────────────────────
// 11. Event emitter (channel.on) (README)
// ─────────────────────────────────────────
console.log('\n[11] Event emitter (README)');

{
  const channel = await NitroGuard.open(config, transport);
  const statusEvents: string[] = [];
  const stateEvents:  number[] = [];

  channel.on('statusChange', (to: string) => statusEvents.push(to));
  channel.on('stateUpdate',  (version: number) => stateEvents.push(version));

  await channel.send({ v: 1 });
  await channel.send({ v: 2 });
  await channel.close();

  if (stateEvents.length === 2) ok('stateUpdate fires once per send (2 total)');
  else ko('stateUpdate event count', stateEvents.length);

  if (statusEvents.includes('FINAL')) ok('statusChange fires FINAL after close()');
  else ko('statusChange events missing FINAL', statusEvents);
}

// ─────────────────────────────────────────
// Summary
// ─────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Walkthrough complete: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

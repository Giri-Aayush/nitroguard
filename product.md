# NitroGuard — State Channel Lifecycle SDK for Yellow Network
## Product Development Document v1.0

**Author:** Aayush Giri  
**Date:** March 2026  
**Status:** Pre-build / Active Planning  
**Target Ecosystem:** Yellow Network / ERC-7824 / Nitrolite  
**npm package name:** `nitroguard`  
**Repository:** `github.com/[your-handle]/nitroguard`

---

## Table of Contents

1. [Name Rationale](#1-name-rationale)
2. [Executive Summary](#2-executive-summary)
3. [Problem Statement — Deep Dive](#3-problem-statement--deep-dive)
4. [Product Vision & Design Philosophy](#4-product-vision--design-philosophy)
5. [State Machine Model](#5-state-machine-model)
6. [Full API Specification](#6-full-api-specification)
7. [Architecture & Package Structure](#7-architecture--package-structure)
8. [Dependency Map](#8-dependency-map)
9. [Phase 1 — Core Lifecycle Engine](#9-phase-1--core-lifecycle-engine)
10. [Phase 2 — Safety Layer (Persistence + Dispute)](#10-phase-2--safety-layer-persistence--dispute)
11. [Phase 3 — DX Layer (Protocol Schemas + React)](#11-phase-3--dx-layer-protocol-schemas--react)
12. [Phase 4 — Hardening + Publication](#12-phase-4--hardening--publication)
13. [Testing Strategy Overview](#13-testing-strategy-overview)
14. [Risk Register](#14-risk-register)
15. [Success Metrics](#15-success-metrics)
16. [Yellow Team Pitch Framing](#16-yellow-team-pitch-framing)

---

## 1. Name Rationale

**NitroGuard** was chosen for the following reasons:

- **Nitro** — directly anchors it in the Nitrolite / ERC-7824 ecosystem. Developers already
  using `@erc7824/nitrolite` will immediately understand the lineage. It is not a foreign
  product — it is an extension of the stack they are already on.

- **Guard** — communicates the core value proposition in one word. This SDK *guards* user funds
  against ClearNode failure. It *guards* developers from having to build dispute logic
  themselves. It *guards* the state channel lifecycle from misuse. The word carries weight in
  a financial infrastructure context.

- **Together** — "NitroGuard" reads as a protection layer built on the Nitro protocol. That is
  exactly what it is.

- **Practical** — short, memorable, searchable on npm, and distinct from existing packages.
  `yellow-channel`, `nitrolite-sdk`, `state-channel-manager` are all worse — generic, verbose,
  or already taken variants.

**Tagline:** *Production-grade state channel lifecycle management for Yellow Network.*

---

## 2. Executive Summary

Yellow Network launched on Ethereum mainnet on March 17, 2026. Over 500 projects are building
on its SDK. The canonical developer primitive — `@erc7824/nitrolite` — exposes raw state channel
operations: sign a message, create a session, send a WebSocket payload.

It does not give developers:
- A managed state machine over the channel lifecycle (VOID → INITIAL → ACTIVE → DISPUTE → FINAL)
- Automatic persistence of co-signed states required for dispute recovery
- An on-chain event watcher that responds to challenges before funds are lost
- A clean, typed API that abstracts away contract calls, EIP-712 encoding, and WebSocket wiring

**NitroGuard** fills this gap. It is a TypeScript SDK that wraps the full ERC-7824 lifecycle
into a safe, ergonomic API. It sits between `@erc7824/nitrolite` and the application layer,
handling everything from channel creation to unilateral fund recovery — automatically.

The prior art for this problem (statechannels.org / Counterfactual / L4) is dead or migrated.
go-perun solved an analogous problem in Go for a different protocol. Nobody has solved it for
ERC-7824. The ecosystem activation window for Yellow is right now.

---

## 3. Problem Statement — Deep Dive

### 3.1 The Abstraction Gap

The current Yellow developer stack has a critical missing layer:

```
┌──────────────────────────────────────────────────────────┐
│                    Your Application                       │
│                                                           │
│   You must handle:                                        │
│   - EIP-712 struct construction                          │
│   - Version counter management                           │
│   - Co-signature verification                            │
│   - State persistence (or lose ability to dispute)       │
│   - On-chain event watching                              │
│   - Challenge / respond / reclaim flow                   │
│   - WebSocket reconnection + re-auth                     │
│                                                           │
├──────────────────────────────────────────────────────────┤
│                 @erc7824/nitrolite                        │
│   Provides: sign(), encode(), RPC message builders        │
├──────────────────────────────────────────────────────────┤
│                ClearNode (WebSocket)                      │
├──────────────────────────────────────────────────────────┤
│           Custody Contract (EVM on-chain)                 │
└──────────────────────────────────────────────────────────┘
```

Every single one of the items in the gap box must be re-implemented by each developer building
on Yellow. This is not a feature gap — it is a structural gap in the developer tooling that
creates duplicated work, inconsistent safety standards, and fund loss risk.

### 3.2 The Five Developer Failure Modes

Based on analysis of the Nitrolite quick start docs, the ERC-7824 GitHub issues, and the
broader state channel developer literature, there are five distinct failure modes that affect
developers building on Yellow today:

**Failure Mode 1: Lost State = Lost Funds**

The ERC-7824 protocol requires that to dispute a channel, you must present the latest co-signed
state. If a developer does not persist this state (e.g., it is stored in-memory and the server
restarts), and the ClearNode submits a stale state during a dispute, the developer's users lose
funds. The current SDK provides no persistence mechanism whatsoever. Every developer must
implement their own.

**Failure Mode 2: Missed Challenge Window**

When a ClearNode submits a challenge on-chain, the counterparty has a minimum of 1 hour to
respond with a higher-version state. If the app is not watching the chain, the challenge
succeeds by default — even if it is fraudulent. No challenge watcher exists in the current SDK.

**Failure Mode 3: Manual State Machine Misuse**

The ERC-7824 channel moves through five on-chain statuses: VOID, INITIAL, ACTIVE, DISPUTE,
FINAL. Developers calling the wrong method in the wrong phase (e.g., `send()` on a FINAL
channel, or trying to `close()` a channel that is in DISPUTE) get raw Solidity reverts with no
helpful error messages. There is no SDK-level state machine enforcement.

**Failure Mode 4: Version Desync**

Every off-chain state update must have a strictly incrementing `version` number. If a developer
has multiple concurrent requests in flight, or does not properly handle failed sends, the version
counter can desync between client and ClearNode. This leads to rejected updates with no recovery
path. The current SDK provides no version management.

**Failure Mode 5: No Reconnection Safety**

If the WebSocket connection to a ClearNode drops mid-session, the app must re-authenticate,
re-establish the session, and resume from the correct version. `yellow-ts` handles reconnect at
the transport layer, but the application session re-establishment on top of a reconnect is not
handled anywhere. Most developers either crash or silently lose state.

### 3.3 Evidence From the Broader Ecosystem

> "67% of developers cited dispute resolution as the most frustrating part of building state
> channels. Developers spent 20–30% more time on dispute logic than expected."
>
> — Blockchain Research Institute, 2023

> "State channels require participants to remain online during the entire lifecycle of the
> channel to prevent execution forks, in which a malicious actor starts the dispute phase and
> submits stale state to the blockchain."
>
> — Process Channels: A New Layer for Process Enactment, arXiv 2304.01107

These are not Yellow-specific problems. They are state channel problems. They have not been
solved for ERC-7824.

### 3.4 Why yellow-ts Does Not Solve This

`yellow-ts` (github.com/stevenzeiler/yellow-ts, 2 stars, 16 commits, last updated December 2025)
solves exactly one problem: WebSocket reconnection with exponential backoff. Its entire API
surface is: `connect()`, `disconnect()`, `request()`, `sendMessage()`, `listen()`. It is a
transport client. It is not a channel lifecycle manager.

NitroGuard will use `yellow-ts` as a peer dependency for its WebSocket transport layer.
It does not compete with it — it builds on top of it.

---

## 4. Product Vision & Design Philosophy

### 4.1 Vision Statement

> **NitroGuard makes the ERC-7824 state channel lifecycle as safe and simple as a database
> connection — open it, use it, close it. NitroGuard handles everything in between.**

### 4.2 Design Principles

**Principle 1: Safety by Default**
Every unsafe operation (sending without persistence, closing without co-signature backup,
ignoring on-chain events) should require the developer to *opt out*, not opt in. The default
configuration of NitroGuard should make it impossible to accidentally lose user funds through
tooling gaps.

**Principle 2: Progressive Disclosure**
The 80% use case (open a channel, send payments, close cleanly) should require 10 lines of
code. The 20% advanced use case (custom persistence, manual dispute management, typed protocol
schemas) should be accessible but never required to get started.

**Principle 3: Protocol-Transparent**
NitroGuard does not hide the protocol. Every method maps to a well-documented protocol state
transition. Developers who want to understand what's happening under the hood can. The
abstraction is a convenience layer, not a black box.

**Principle 4: Fail Loudly, Recover Gracefully**
Invalid state transitions throw descriptive typed errors. Network failures trigger automatic
recovery (reconnect, re-auth, state sync). On-chain failures with user funds trigger automated
dispute processes. The developer is notified at every step via callbacks and events.

**Principle 5: Zero Lock-In**
NitroGuard has a pluggable architecture throughout. Persistence adapters, signing strategies,
RPC providers, and ClearNode endpoints are all injectable. The core is not opinionated about
your infrastructure stack.

---

## 5. State Machine Model

The entire NitroGuard SDK is built around a deterministic finite state machine that mirrors
the ERC-7824 on-chain `Status` enum exactly. Every method is a legal transition. Illegal
transitions throw `InvalidTransitionError`.

### 5.1 The Five States

```
┌─────────────────────────────────────────────────────────────────┐
│                   NitroGuard Channel FSM                        │
│                                                                  │
│                       open()                                     │
│          VOID ──────────────────────► INITIAL                   │
│           ▲                               │                      │
│           │                   (both parties sign                 │
│           │                    CHANOPEN funding state)           │
│           │                               │                      │
│           │                               ▼                      │
│     reclaim()               ┌─────────► ACTIVE ◄──────────┐     │
│    (after window)           │             │                │     │
│           │             restore()    ┌────┴────┐       checkpoint()
│           │           (reconnect)    │         │           │     │
│           │                     close()    forceClose()    │     │
│           │                         │    (or CN silence)   │     │
│           │                         │         │            │     │
│           │                         ▼         ▼            │     │
│           │                       FINAL    DISPUTE ────────┘     │
│           │                         │         │  (respond with   │
│           │                         │         │  higher version) │
│           └─────────────────────────┘         │                  │
│                                               │                  │
│                                         (window expires)         │
│                                               │                  │
│                                          reclaim() ──► VOID      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 State Descriptions

| State | On-Chain Status | Description |
|---|---|---|
| `VOID` | `Status.VOID` | Channel does not exist. Initial state before `open()`. |
| `INITIAL` | `Status.INITIAL` | Deposits submitted. Waiting for all participants to sign the funding state. |
| `ACTIVE` | `Status.ACTIVE` | Fully funded. Off-chain state updates happening via ClearNode. |
| `DISPUTE` | `Status.DISPUTE` | Challenge submitted on-chain. Timer running. |
| `FINAL` | `Status.FINAL` | Channel is finalized. Funds are withdrawable. |

### 5.3 Transition Table

| From | Method | To | On-Chain Call | Off-Chain Call |
|---|---|---|---|---|
| VOID | `open()` | INITIAL → ACTIVE | `deposit()`, `create()` | ClearNode handshake |
| ACTIVE | `send()` | ACTIVE | none | State update via WS |
| ACTIVE | `checkpoint()` | ACTIVE | `checkpoint()` | none |
| ACTIVE | `close()` | FINAL | `close()` (mutual) | Final state sign |
| ACTIVE | `forceClose()` | DISPUTE | `challenge()` | none |
| DISPUTE | (auto-respond) | ACTIVE | `respond()` | none |
| DISPUTE | (window expires) | FINAL | (auto) | none |
| FINAL | `reclaim()` | VOID | `withdraw()` | none |
| ANY | `restore()` | ACTIVE | none | ClearNode re-auth |

### 5.4 Error Types

```typescript
class InvalidTransitionError extends NitroGuardError {
  constructor(from: ChannelStatus, attempted: string) {}
}
class CoSignatureTimeoutError extends NitroGuardError {
  constructor(timeoutMs: number, version: number) {}
}
class ClearNodeUnreachableError extends NitroGuardError {
  constructor(url: string, attempts: number) {}
}
class InsufficientFundsError extends NitroGuardError {
  constructor(required: bigint, available: bigint, token: string) {}
}
class NoPersistenceError extends NitroGuardError {
  // Thrown when forceClose() is called but no persisted state exists
}
class ChallengeMissedError extends NitroGuardError {
  constructor(channelId: string, deadline: Date) {}
  // Should never be thrown if DisputeWatcher is active
}
```

---

## 6. Full API Specification

### 6.1 `NitroGuard` (top-level namespace)

```typescript
import { NitroGuard } from 'nitroguard';

const channel = await NitroGuard.open(config: OpenConfig): Promise<Channel>
const channel = await NitroGuard.restore(channelId: string, config: RestoreConfig): Promise<Channel>
const channels = await NitroGuard.restoreAll(config: RestoreConfig): Promise<Channel[]>
const id = NitroGuard.computeChannelId(params: ChannelParams): string
const status = await NitroGuard.getOnChainStatus(channelId: string, rpcUrl: string): Promise<ChannelStatus>
```

### 6.2 `OpenConfig`

```typescript
interface OpenConfig {
  // Required
  clearnode: string;
  signer: EIP712Signer;
  assets: AssetAllocation[];

  // Network
  chain: Chain;                         // viem Chain object
  rpcUrl: string;
  custodyAddress?: string;

  // Channel parameters
  challengePeriod?: number;             // seconds, default 3600
  counterparty?: string;                // auto-discovered from ClearNode if omitted

  // Persistence
  persistence?: PersistenceAdapter;     // default: IndexedDB (browser) / LevelDB (Node)

  // Dispute
  disputeWatcher?: DisputeWatcherConfig;
  autoDispute?: boolean;                // default true
  clearnodeSilenceTimeout?: number;     // ms, default 30000

  // Protocol schema (optional)
  protocol?: Protocol<any>;

  // Callbacks
  onStatusChange?: (status: ChannelStatus, prev: ChannelStatus) => void;
  onStateUpdate?: (version: number, state: SignedState) => void;
  onError?: (error: NitroGuardError) => void;
  onChallengeDetected?: (channelId: string) => void;
  onChallengeResponded?: (channelId: string, txHash: string) => void;
  onFundsReclaimed?: (channelId: string, amounts: Amount[]) => void;
}
```

### 6.3 `Channel` (main class)

```typescript
class Channel {
  // Properties
  readonly id: string;
  readonly status: ChannelStatus;
  readonly version: number;
  readonly participants: [string, string];
  readonly assets: AssetAllocation[];
  readonly createdAt: Date;
  readonly chain: Chain;

  // Core methods
  async send(payload: unknown, options?: SendOptions): Promise<SendResult>
  async close(options?: CloseOptions): Promise<CloseResult>
  async forceClose(options?: ForceCloseOptions): Promise<ForceCloseResult>
  async checkpoint(): Promise<CheckpointResult>
  async withdraw(): Promise<WithdrawResult>
  async getHistory(): Promise<SignedState[]>
  async getLatestPersistedState(): Promise<SignedState | null>

  // Event subscription
  on(event: ChannelEvent, listener: Function): () => void
  off(event: ChannelEvent, listener: Function): void
}
```

### 6.4 `DisputeWatcher`

```typescript
class DisputeWatcher {
  constructor(config: DisputeWatcherConfig)
  async start(): Promise<void>
  async stop(): Promise<void>
  async checkAll(): Promise<void>
  watch(channelId: string, latestState: SignedState): void
  unwatch(channelId: string): void
  on(event: 'challenge' | 'responded' | 'finalized' | 'reclaimed', listener: Function): void
}

interface DisputeWatcherConfig {
  rpcUrl: string;
  custodyAddress: string;
  persistence: PersistenceAdapter;
  signer: EIP712Signer;
  pollInterval?: number;              // ms, default 15000
  challengeResponseBuffer?: number;   // ms, default 2000
}
```

### 6.5 `PersistenceAdapter` Interface

```typescript
interface PersistenceAdapter {
  save(channelId: string, state: SignedState): Promise<void>
  loadLatest(channelId: string): Promise<SignedState | null>
  load(channelId: string, version: number): Promise<SignedState | null>
  loadAll(channelId: string): Promise<SignedState[]>
  listChannels(): Promise<string[]>
  clear(channelId: string): Promise<void>
}

// Built-in adapters
class IndexedDBAdapter implements PersistenceAdapter {}  // Browser default
class LevelDBAdapter implements PersistenceAdapter {}    // Node default
class MemoryAdapter implements PersistenceAdapter {}     // Tests
class PostgresAdapter implements PersistenceAdapter {}   // Production server
class SQLiteAdapter implements PersistenceAdapter {}     // Node lightweight
```

### 6.6 `defineProtocol()` — Typed Schema Layer

```typescript
import { defineProtocol } from 'nitroguard';
import { z } from 'zod';

const TradeProtocol = defineProtocol({
  name: 'options-v1',
  version: 1,

  schema: z.object({
    type: z.enum(['open', 'exercise', 'expire']),
    strikePrice: z.bigint(),
    expiry: z.number(),
    premium: z.bigint(),
    buyer: z.string(),
    writer: z.string(),
  }),

  transitions: {
    open:     (prev, next) => next.strikePrice > 0n && next.premium > 0n,
    exercise: (prev, next) => prev.type === 'open' && Date.now() <= prev.expiry,
    expire:   (prev, next) => Date.now() > prev.expiry,
  },

  resolveDispute: (history) => history.findLast(s => s.type === 'open'),
});

// Use with channel — send() becomes fully typed and transition-validated
const channel = await NitroGuard.open({ ...config, protocol: TradeProtocol });
await channel.send({ type: 'exercise', strikePrice: 50000n, ... });
```

### 6.7 React Integration — `nitroguard/react`

```typescript
import { NitroGuardProvider, useChannel, useChannelBalance } from 'nitroguard/react';

function App() {
  return (
    <NitroGuardProvider
      clearnode="wss://clearnet.yellow.com/ws"
      signer={signer}
      chain={mainnet}
      rpcUrl="https://eth.llamarpc.com"
    >
      <PaymentUI />
    </NitroGuardProvider>
  );
}

function PaymentUI() {
  const { channel, open, close, send, status, isLoading, error } = useChannel();
  const { myBalance, theirBalance } = useChannelBalance();

  return (
    <div>
      <p>Status: {status}</p>
      <p>Balance: {myBalance.toString()} USDC</p>
      {status === 'VOID' && (
        <button onClick={() => open({ assets: [{ token: USDC, amount: 100n }] })}>
          Open Channel
        </button>
      )}
      {status === 'ACTIVE' && (
        <>
          <button onClick={() => send({ type: 'payment', to: bob, amount: 10n })}>
            Pay 10 USDC
          </button>
          <button onClick={close}>Close</button>
        </>
      )}
      {status === 'DISPUTE' && (
        <p>⚠️ Channel in dispute — funds protected automatically</p>
      )}
    </div>
  );
}
```

---

## 7. Architecture & Package Structure

### 7.1 Stack Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     Your Application                              │
├──────────────────────────────────────────────────────────────────┤
│               nitroguard/react  (optional layer)                  │
│         NitroGuardProvider, useChannel, useChannelBalance        │
├──────────────────────────────────────────────────────────────────┤
│                        nitroguard                                 │
│                                                                   │
│  ┌─────────────┐  ┌────────────────┐  ┌──────────────────────┐  │
│  │   Channel   │  │ DisputeWatcher │  │  PersistenceAdapters │  │
│  │  (FSM core) │  │ (chain monitor)│  │  IDB / LevelDB / PG  │  │
│  └──────┬──────┘  └───────┬────────┘  └──────────────────────┘  │
│         │                 │                                       │
│  ┌──────┴──────────────────┴──────────────────┐                  │
│  │              ChannelFactory                 │                  │
│  │       open() / restore() / restoreAll()     │                  │
│  └──────┬─────────────────────────────────────┘                  │
│         │                                                         │
│  ┌──────┴────────┐    ┌──────────────────────────────────────┐   │
│  │ Protocol Layer│    │          Error Hierarchy              │   │
│  │ defineProtocol│    │  InvalidTransition, CoSigTimeout etc  │   │
│  └───────────────┘    └──────────────────────────────────────┘   │
│                                                                   │
├──────────────────────┬────────────────────────────────────────────┤
│      yellow-ts       │              viem                          │
│  (WS + reconnect)    │   (deposit, challenge, respond, reclaim)   │
├──────────────────────┴────────────────────────────────────────────┤
│                    @erc7824/nitrolite                              │
│         (sign, encode, RPC message construction)                  │
├──────────────────────────────────────────────────────────────────┤
│  ClearNode WebSocket              Custody Contract (EVM)          │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 Repository File Structure

```
nitroguard/
│
├── src/
│   ├── index.ts
│   ├── channel/
│   │   ├── Channel.ts
│   │   ├── ChannelFactory.ts
│   │   ├── ChannelFSM.ts
│   │   ├── VersionManager.ts
│   │   ├── SessionManager.ts
│   │   └── types.ts
│   ├── dispute/
│   │   ├── DisputeWatcher.ts
│   │   ├── ChallengeManager.ts
│   │   ├── ClearNodeMonitor.ts
│   │   └── types.ts
│   ├── persistence/
│   │   ├── PersistenceAdapter.ts
│   │   ├── IndexedDBAdapter.ts
│   │   ├── LevelDBAdapter.ts
│   │   ├── MemoryAdapter.ts
│   │   ├── PostgresAdapter.ts
│   │   ├── SQLiteAdapter.ts
│   │   └── index.ts
│   ├── protocol/
│   │   ├── defineProtocol.ts
│   │   ├── validators.ts
│   │   └── types.ts
│   ├── signing/
│   │   ├── EIP712Signer.ts
│   │   ├── adapters/
│   │   │   ├── EthersSigner.ts
│   │   │   ├── ViemSigner.ts
│   │   │   └── RawSigner.ts
│   │   └── types.ts
│   ├── contracts/
│   │   ├── CustodyABI.ts
│   │   ├── CustodyClient.ts
│   │   ├── addresses.ts
│   │   └── events.ts
│   ├── errors/
│   │   └── index.ts
│   └── react/
│       ├── NitroGuardProvider.tsx
│       ├── useChannel.ts
│       ├── useChannelStatus.ts
│       ├── useChannelBalance.ts
│       ├── useAllChannels.ts
│       └── index.ts
│
├── test/
│   ├── unit/
│   │   ├── channel/
│   │   │   ├── ChannelFSM.test.ts
│   │   │   ├── VersionManager.test.ts
│   │   │   └── SessionManager.test.ts
│   │   ├── dispute/
│   │   │   ├── DisputeWatcher.test.ts
│   │   │   └── ChallengeManager.test.ts
│   │   ├── persistence/
│   │   │   ├── MemoryAdapter.test.ts
│   │   │   ├── IndexedDBAdapter.test.ts
│   │   │   └── LevelDBAdapter.test.ts
│   │   └── protocol/
│   │       └── defineProtocol.test.ts
│   ├── integration/
│   │   ├── helpers/
│   │   │   ├── MockClearNode.ts
│   │   │   ├── AnvilFork.ts
│   │   │   └── TestWallets.ts
│   │   ├── channel-lifecycle.test.ts
│   │   ├── reconnect.test.ts
│   │   ├── dispute-honest.test.ts
│   │   ├── dispute-malicious.test.ts
│   │   └── checkpoint.test.ts
│   └── e2e/
│       └── sandbox.test.ts
│
├── examples/
│   ├── simple-payment/
│   ├── payment-with-react/
│   └── options-protocol/
│
├── docs/
│   ├── quick-start.md
│   ├── state-machine.md
│   ├── dispute-guide.md
│   ├── persistence-guide.md
│   └── protocol-schemas.md
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 8. Dependency Map

### 8.1 Runtime Dependencies

| Package | Role | Why |
|---|---|---|
| `@erc7824/nitrolite` | Protocol primitives | Signing, message encoding, RPC builders |
| `yellow-ts` | WebSocket transport | Reconnect + backoff already solved here |
| `viem` | On-chain calls | Typed contract interactions, event watching |
| `zod` | Schema validation | Protocol schema definition + runtime validation |

### 8.2 Optional Peer Dependencies

| Package | Role | Required For |
|---|---|---|
| `level` | LevelDB | `LevelDBAdapter` (Node default) |
| `pg` | PostgreSQL | `PostgresAdapter` |
| `better-sqlite3` | SQLite | `SQLiteAdapter` |
| `react` | React | `nitroguard/react` |

### 8.3 Dev Dependencies

| Package | Role |
|---|---|
| `vitest` | Test runner |
| `@viem/anvil` | Local EVM fork for integration tests |
| `ws` | MockClearNode WebSocket server in tests |
| `fake-indexeddb` | IndexedDB testing in Node |
| `typescript` | Build |
| `tsup` | Bundler (ESM + CJS output) |

---

## 9. Phase 1 — Core Lifecycle Engine

**Timeline:** 2 weeks
**Goal:** Working `Channel` with open → send → close happy path against the Yellow sandbox.
**Milestone:** A developer can replace the nitrolite quick start guide with 10 lines of
NitroGuard code and get the same result.

### 9.1 What to Build

#### 9.1.1 `ChannelFSM` — State Machine Core

```typescript
const VALID_TRANSITIONS: Record<ChannelStatus, ChannelStatus[]> = {
  VOID:    ['INITIAL'],
  INITIAL: ['ACTIVE'],
  ACTIVE:  ['FINAL', 'DISPUTE', 'ACTIVE'],  // ACTIVE→ACTIVE = checkpoint
  DISPUTE: ['ACTIVE', 'FINAL'],
  FINAL:   ['VOID'],
};

class ChannelFSM {
  private status: ChannelStatus = 'VOID';

  transition(to: ChannelStatus, trigger: string): void {
    if (!VALID_TRANSITIONS[this.status]?.includes(to)) {
      throw new InvalidTransitionError(this.status, trigger);
    }
    const prev = this.status;
    this.status = to;
    this.emit(to, prev);
  }
}
```

#### 9.1.2 `VersionManager` — Version Counter

```typescript
class VersionManager {
  private version = 0;
  private inFlight = new Set<number>();

  next(): number {
    const v = ++this.version;
    this.inFlight.add(v);
    return v;
  }
  confirm(v: number): void { this.inFlight.delete(v); }
  rollback(v: number): void {
    if (this.inFlight.has(v)) {
      this.version = v - 1;
      this.inFlight.delete(v);
    }
  }
  get current() { return this.version; }
  get hasPending() { return this.inFlight.size > 0; }
}
```

#### 9.1.3 `ChannelFactory.open()` Flow

1. Validate config (signer, assets, chainId)
2. Connect to ClearNode via `yellow-ts`
3. Discover counterparty address from ClearNode config endpoint
4. Construct `Channel` struct: `{ participants, adjudicator, challenge, nonce }`
5. Compute `channelId = keccak256(abi.encode(channel))`
6. Call `deposit()` on Custody contract for each asset
7. Construct + sign initial `State` with `intent = CHANOPEN`, `version = 0`
8. Send to ClearNode, await co-signature
9. Transition FSM: `VOID → INITIAL → ACTIVE`
10. Start `MemoryAdapter` persistence (Phase 1 default)
11. Return `Channel` instance

#### 9.1.4 `Channel.send()` Flow

1. Check FSM: must be ACTIVE — throw `InvalidTransitionError` otherwise
2. `VersionManager.next()` — get new version
3. Construct `State`: `{ intent: APP, version, data: encode(payload), allocations }`
4. Sign with EIP-712 via `EIP712Signer`
5. Send via `yellow-ts`, await co-sig (timeout configurable, default 5000ms)
6. On co-sig received: `VersionManager.confirm(v)`, save to persistence
7. On timeout: `VersionManager.rollback(v)`, throw `CoSignatureTimeoutError`

#### 9.1.5 `Channel.close()` Flow

1. Check FSM: must be ACTIVE
2. Construct final `State` with `intent = CHANFINAL`
3. Sign + send to ClearNode
4. Await co-signature (timeout 10000ms default)
5. Submit mutual close tx to Custody contract via viem
6. Transition FSM: `ACTIVE → FINAL`
7. If co-sig timeout: auto-call `forceClose()` (disable via `options.noAutoForce`)

#### 9.1.6 `MemoryAdapter` — Phase 1 Persistence

Stores states in-memory. Safe for sandbox testing. Not production-safe (data lost on restart).
Replaced by real adapters in Phase 2.

### 9.2 Phase 1 Unit Tests

**`ChannelFSM.test.ts`**
```
✓ starts in VOID state
✓ VOID → INITIAL is valid
✓ INITIAL → ACTIVE is valid
✓ ACTIVE → FINAL is valid (close)
✓ ACTIVE → DISPUTE is valid (forceClose)
✓ DISPUTE → ACTIVE is valid (challenge responded)
✓ DISPUTE → FINAL is valid (window expired)
✓ FINAL → VOID is valid (reclaimed)
✓ VOID → ACTIVE throws InvalidTransitionError (must go through INITIAL)
✓ FINAL → ACTIVE throws InvalidTransitionError
✓ VOID → DISPUTE throws InvalidTransitionError
✓ VOID → FINAL throws InvalidTransitionError
✓ onStatusChange callback fires on every valid transition
✓ onStatusChange receives both (to, from) values
✓ callback is NOT fired on invalid transition attempt
```

**`VersionManager.test.ts`**
```
✓ starts at version 0
✓ next() returns 1 on first call
✓ next() returns 2, 3, 4 on subsequent calls
✓ hasPending is true while in-flight versions exist
✓ hasPending is false when all confirmed
✓ confirm() removes version from in-flight set
✓ rollback() decrements version to v-1
✓ rollback() sets hasPending false for that version
✓ rollback() is no-op for version not in in-flight
✓ 100 sequential next() calls return unique values
```

**`MemoryAdapter.test.ts`**
```
✓ save() then loadLatest() returns saved state
✓ loadLatest() returns highest version, not most recent save
✓ loadAll() returns states sorted by version ascending
✓ clear() removes all states for channelId
✓ listChannels() returns all known channelIds
✓ listChannels() returns empty array initially
✓ load(channelId, version) returns null for unknown version
✓ loadLatest() returns null for unknown channelId
```

### 9.3 Phase 1 Integration Tests

**Setup helpers:**
- `MockClearNode` — local WS server mimicking ClearNode RPC protocol
- `AnvilFork` — local Anvil EVM with Custody contract pre-deployed
- `TestWallets` — two wallets pre-funded with USDC

**`channel-lifecycle.test.ts`**
```
Setup: Start Anvil. Deploy Custody. Start MockClearNode.
       Create Alice and Bob funded test wallets.

Test 1: Basic open → send → close
  ✓ NitroGuard.open() completes without error
  ✓ channel.status === 'ACTIVE' after open()
  ✓ channel.version === 0 after open()
  ✓ Custody contract shows ACTIVE status for channelId
  ✓ USDC deposit is confirmed on Anvil
  ✓ channel.send({ type: 'payment', amount: 10n }) succeeds
  ✓ channel.version === 1 after first send
  ✓ channel.close() completes without error
  ✓ channel.status === 'FINAL' after close()
  ✓ Custody contract shows FINAL status

Test 2: Sequential sends — version integrity
  ✓ 10 sequential sends all return unique versions 1..10
  ✓ No version conflicts
  ✓ MemoryAdapter has 10 persisted states
  ✓ All states have correct channelId

Test 3: Concurrent send handling
  ✓ 5 concurrent send() calls queue correctly
  ✓ All 5 complete with unique versions
  ✓ No VersionDesyncError thrown

Test 4: Channel metadata
  ✓ channel.id matches keccak256(abi.encode(channelParams))
  ✓ channel.participants[0] === alice.address
  ✓ channel.participants[1] === clearnode.address
  ✓ channel.assets reflects initial deposit amounts
```

**`reconnect.test.ts`**
```
Test 1: WS reconnect mid-session
  ✓ MockClearNode restarts (simulates network blip)
  ✓ yellow-ts reconnects automatically
  ✓ Channel re-authenticates with ClearNode
  ✓ channel.version is consistent after reconnect
  ✓ send() works immediately after reconnect

Test 2: In-flight send during reconnect
  ✓ send() is retried after WS reconnect
  ✓ Version is not double-incremented on retry
  ✓ No duplicate state versions
```

### 9.4 Phase 1 Acceptance Criteria

- [ ] All unit tests pass (100% coverage on `ChannelFSM`, `VersionManager`, `MemoryAdapter`)
- [ ] All integration tests pass against MockClearNode + Anvil
- [ ] `examples/simple-payment` runs end-to-end against Yellow sandbox (Sepolia)
- [ ] Public API has zero `any` types
- [ ] Bundle size under 50KB gzipped (excluding peer deps)
- [ ] `open()` → `send()` → `close()` replaces the nitrolite quick start in ≤ 15 lines

---

## 10. Phase 2 — Safety Layer (Persistence + Dispute)

**Timeline:** 1.5 weeks
**Goal:** User funds cannot be lost due to ClearNode failure. Dispute detection and response
is fully automated.
**Milestone:** `forceClose()` completes the full on-chain dispute flow without developer
intervention.

### 10.1 What to Build

#### 10.1.1 `IndexedDBAdapter` — Browser Persistence

```
Database:     nitroguard_v1
Object Store: signed_states
  Key:        `${channelId}:${version.toString().padStart(10, '0')}`
  Value:      { channelId, version, intent, data, allocations,
                sigClient, sigClearNode, savedAt }
Index:        channel_idx on channelId (for range queries)
```

Must handle: quota errors (graceful degradation), concurrent writes, corrupt entry detection.

#### 10.1.2 `LevelDBAdapter` — Node Persistence

Same schema as IndexedDB. Every `save()` is synchronous-to-disk before resolving. Requires
`level` as optional peer dependency.

#### 10.1.3 `DisputeWatcher` — On-Chain Event Monitor

```typescript
// Subscribes to Custody contract events via viem
custodyClient.watchContractEvent({
  eventName: 'ChallengeRegistered',
  onLogs: async (logs) => {
    for (const { args } of logs) {
      const { channelId, challengeVersion } = args;
      if (!this.watching.has(channelId)) continue;
      await this.handleChallenge(channelId, challengeVersion);
    }
  }
});

// handleChallenge() flow:
// 1. Load latest persisted state for channelId
// 2. If ourVersion > challengeVersion → respond() with our state
// 3. If ourVersion ≤ challengeVersion → emit 'challenge_lost' (should never happen)
// 4. Emit 'responded' with tx hash
```

#### 10.1.4 `ClearNodeMonitor` — Heartbeat / Silence Detection

Tracks last received message timestamp. If no messages for `silenceTimeout` ms, emits `silence`
event. When `autoDispute: true`, this triggers `channel.forceClose()` automatically.

#### 10.1.5 `Channel.forceClose()` — Full Implementation

```
1. Check FSM: must be ACTIVE
2. Load latest persisted state (throw NoPersistenceError if none found)
3. Call challenge() on Custody contract with latest state + signatures
4. Transition FSM: ACTIVE → DISPUTE
5. Emit onChallengeDetected callback
6. Begin polling for ChannelFinalized event
7. (Anvil: fast-forward time; Testnet: wait up to challengePeriod + buffer)
8. Call withdraw() on Custody contract
9. Transition FSM: DISPUTE → FINAL → VOID
10. Resolve promise with reclaimedAmounts
```

#### 10.1.6 `Channel.checkpoint()`

Calls `checkpoint()` on Custody contract with the current latest persisted co-signed state.
Any future challenge must use a version > this checkpoint version.

### 10.2 Phase 2 Unit Tests

**`DisputeWatcher.test.ts`**
```
✓ starts watching all channels in watchlist
✓ handleChallenge() called when ChallengeRegistered emitted
✓ loads latest persisted state when challenge detected
✓ calls respond() when ourVersion > challengeVersion
✓ emits 'challenge_lost' when ourVersion ≤ challengeVersion
✓ does not double-respond to same challenge
✓ ignores ChallengeRegistered for unwatched channelId
✓ handleFinalized() called when ChannelFinalized emitted
✓ stops watching correctly on stop()
```

**`ClearNodeMonitor.test.ts`**
```
✓ emits 'silence' after configured timeout with no messages
✓ resets timer on every heartbeat() call
✓ does not emit 'silence' if heartbeats arrive within timeout
✓ emits 'silence' with correct lastSeen timestamp
✓ can be restarted after silence event
```

**`IndexedDBAdapter.test.ts`** (using `fake-indexeddb`)
```
✓ save() persists state
✓ loadLatest() returns highest-version state (not most recent save)
✓ loadAll() returns states in version-ascending order
✓ clear() removes all states for channelId
✓ listChannels() returns channelIds of all stored channels
✓ concurrent save() calls do not corrupt state
✓ handles QuotaExceededError gracefully (emits warning, does not throw)
✓ DB re-open after close still returns saved states
```

**`LevelDBAdapter.test.ts`**
```
✓ save() persists state to disk
✓ loadLatest() returns correct state after process-restart simulation
✓ loadAll() returns all 1000 states in correct order
✓ concurrent writes do not corrupt database
✓ handles missing LevelDB dependency with clear error message
```

### 10.3 Phase 2 Integration Tests

**`dispute-honest.test.ts`** — ClearNode goes offline

```
Setup: Anvil + MockClearNode + funded wallets.
       Alice opens channel, sends 5 state updates.

Step 1: Verify healthy state
  ✓ channel.status === 'ACTIVE'
  ✓ 5 states persisted in LevelDBAdapter

Step 2: Simulate ClearNode going offline
  ✓ MockClearNode.disconnect()
  ✓ ClearNodeMonitor detects silence after timeout
  ✓ forceClose() is triggered automatically (autoDispute: true)

Step 3: Challenge submitted
  ✓ challenge() tx submitted to Anvil with version 5 state
  ✓ channel.status transitions to 'DISPUTE'
  ✓ onChallengeDetected callback fires

Step 4: Window expires
  ✓ Anvil: evm_increaseTime(challengePeriod + 1)
  ✓ ChannelFinalized event detected by DisputeWatcher

Step 5: Funds reclaimed
  ✓ withdraw() tx submitted automatically
  ✓ channel.status transitions to 'FINAL' → 'VOID'
  ✓ Alice's USDC balance restored minus payments made
  ✓ forceClose() promise resolves with correct reclaimedAmounts
  ✓ onFundsReclaimed callback fires with amounts
```

**`dispute-malicious.test.ts`** — ClearNode submits stale state

```
Setup: Same, Alice sends 10 state updates.

Step 1: MockClearNode goes malicious — submits version 3 challenge
  ✓ MockClearNode.submitChallenge(channelId, version: 3)
  ✓ DisputeWatcher detects ChallengeRegistered(version: 3)

Step 2: NitroGuard responds automatically
  ✓ ChallengeManager loads persisted version 10 state
  ✓ respond() tx submitted with version 10 state
  ✓ Challenge is invalidated on-chain (version 10 > 3)
  ✓ channel.status returns to 'ACTIVE'
  ✓ onChallengeResponded callback fires with tx hash

Step 3: Channel continues normally after defeat
  ✓ send() works after successful challenge response
  ✓ All 10+ states still correctly persisted
```

**`checkpoint.test.ts`**
```
✓ checkpoint() submits correct version to Custody contract
✓ On-chain checkpoint version matches channel.version at time of call
✓ After checkpoint at version 5, challenge with version 4 is rejected on-chain
✓ After checkpoint at version 5, challenge with version 6 would succeed (higher)
✓ Multiple checkpoints at versions 5, 10, 15 all recorded correctly
```

**`restore.test.ts`**
```
✓ NitroGuard.restore(channelId, config) returns channel with status ACTIVE
✓ Restored channel.version matches latest persisted state version
✓ send() works immediately after restore
✓ DisputeWatcher restarts on restored channel
✓ Throws ChannelNotFoundError when channelId has no persisted states
✓ Throws OnChainStatusError when channel is not ACTIVE on-chain
```

### 10.4 Phase 2 Manual Verification

- [ ] Open channel, send 10 updates, kill Node process. Restart, call `restore()`. Verify
  version is 10 and send works. (LevelDB survival test)
- [ ] Open channel in browser, send 5 updates, close tab. Reopen tab, call `restore()`.
  Verify version is 5. (IndexedDB survival test)
- [ ] Verify `forceClose()` works on live Sepolia testnet (requires waiting real challenge
  period — do this once, document the tx hash)

### 10.5 Phase 2 Acceptance Criteria

- [ ] All Phase 1 criteria still passing
- [ ] `dispute-honest.test.ts` passes completely
- [ ] `dispute-malicious.test.ts` passes completely
- [ ] `IndexedDBAdapter` survives tab refresh (manual test in browser)
- [ ] `LevelDBAdapter` survives `process.exit()` + restart (scripted test)
- [ ] `forceClose()` resolves with correct amounts in all dispute scenarios
- [ ] Zero fund loss in any scenario where channel has at least one persisted state

---

## 11. Phase 3 — DX Layer (Protocol Schemas + React)

**Timeline:** 1 week
**Goal:** Developer experience polish. Typed protocols and React hooks.
**Milestone:** `examples/options-protocol` fully typed and working.

### 11.1 What to Build

#### 11.1.1 `defineProtocol()` — See API spec 6.6

Key implementation points:
- Zod schema thread through TypeScript generics so `Channel<OptionsState>` and
  `channel.send(payload: OptionsState)` are fully typed
- Transition validators run synchronously before the state is signed
- `resolveDispute` hook determines which state to submit on `forceClose()`
- Protocol name + version embedded in `state.data` for on-chain readability

#### 11.1.2 `NitroGuard.restore()` — Full Version Sync

Complete the restore path with:
- Re-authentication handshake with ClearNode using stored session keys
- Version sync check: compare our latest persisted version to ClearNode's latest known version
- If ClearNode has a higher version: request missing co-signed states from ClearNode
- If versions match: emit `onStatusChange('ACTIVE')` and resume
- Re-attach `DisputeWatcher` to the restored channel

#### 11.1.3 React Hooks

All hooks must:
- Use React 18 concurrent-safe state updates
- Clean up all subscriptions / timers on component unmount
- Not access browser APIs (IndexedDB, WebSocket) during SSR render
- Work in Next.js App Router without hydration errors

`useChannel()` — wraps full channel lifecycle in React state  
`useChannelStatus()` — lightweight subscribe to status only  
`useChannelBalance()` — reactive balance display, updates on every `send()`  
`useAllChannels()` — list all channels from persistence, manage multiple  

### 11.2 Phase 3 Tests

**`defineProtocol.test.ts`**
```
✓ schema rejects state with wrong shape (Zod validation)
✓ schema accepts valid state shape
✓ transitions.exercise rejects when prev.type !== 'open'
✓ transitions.exercise rejects when Date.now() > expiry
✓ transitions.exercise accepts valid preconditions
✓ resolveDispute() returns correct state from history
✓ Protocol name embedded in encoded state.data
✓ TypeScript: send() argument type inferred from protocol schema
```

**`useChannel.test.tsx`** (React Testing Library)
```
✓ status is VOID initially
✓ open() transitions to ACTIVE and triggers re-render
✓ send() increments version and triggers re-render
✓ close() transitions to FINAL and triggers re-render
✓ error state populated on CoSignatureTimeoutError
✓ isLoading is true during open(), false after
✓ Component unmount: WS disconnected, watcher stopped (no leak)
✓ Works correctly inside React.StrictMode (no double-open)
✓ Works inside Suspense boundary
```

**`useChannelBalance.test.tsx`**
```
✓ Shows correct initial balances after open()
✓ Updates after send() with allocation change
✓ Shows correct values for multi-asset (USDC + ETH) channels
✓ Shows zero balance in VOID state
```

### 11.3 Phase 3 Manual Testing

- [ ] `examples/payment-with-react` in Chrome + MetaMask: open, pay, close works
- [ ] `examples/payment-with-react` in Firefox + MetaMask: same
- [ ] Next.js App Router: page with `useChannel()` does not cause hydration error
- [ ] `defineProtocol()` TypeScript error appears when `send()` called with wrong type
- [ ] MetaMask prompts exactly once during `open()` (session key delegation works)
- [ ] Status badge VOID → ACTIVE → FINAL updates in real-time in React demo

### 11.4 Phase 3 Acceptance Criteria

- [ ] All Phase 1 + 2 criteria still passing
- [ ] `defineProtocol()` catches type errors at TypeScript compile time
- [ ] React hooks work in Next.js App Router without hydration errors
- [ ] Zero memory leaks on component unmount (verified with React DevTools)
- [ ] `examples/options-protocol` demonstrates typed protocol transitions end-to-end
- [ ] No `any` in public-facing types

---

## 12. Phase 4 — Hardening + Publication

**Timeline:** 3–5 days
**Goal:** Publish `nitroguard` to npm. Documentation, examples, Yellow ecosystem submission.

### 12.1 What to Build

#### E2E Test Suite Against Yellow Sandbox (Sepolia)

```typescript
// test/e2e/sandbox.test.ts
// Runs only when YELLOW_E2E=1

describe('Yellow Sandbox E2E', () => {
  it('full lifecycle: open → 20 sends → close', async () => { ... });
  it('restore after simulated disconnect', async () => { ... });
  it('checkpoint submits to Sepolia', async () => { ... });
  it('forceClose on sandbox (long test, skipped in fast CI)', async () => { ... });
});
```

#### Documentation Structure

```
README.md              Quick start, 3-minute example, badge links
docs/
  quick-start.md       Step-by-step: zero to open channel
  state-machine.md     FSM diagram + all transitions explained
  dispute-guide.md     How protection works, configuration options
  persistence-guide.md Adapter selection, writing custom adapters
  protocol-schemas.md  defineProtocol() guide with financial example
  react-guide.md       Hooks reference + Next.js setup
  migration.md         Moving from raw nitrolite to NitroGuard
```

#### npm Package Configuration

```json
{
  "name": "nitroguard",
  "version": "0.1.0",
  "description": "Production-grade state channel lifecycle SDK for Yellow Network / ERC-7824",
  "keywords": [
    "yellow-network", "state-channels", "erc7824",
    "nitrolite", "clearnode", "defi", "ethereum"
  ],
  "exports": {
    ".":        { "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./react":  { "import": "./dist/react/index.js" }
  },
  "peerDependencies": {
    "@erc7824/nitrolite": ">=0.4.0",
    "viem": ">=2.0.0",
    "yellow-ts": ">=0.0.10",
    "zod": ">=3.0.0"
  },
  "peerDependenciesMeta": {
    "zod":   { "optional": true },
    "react": { "optional": true }
  }
}
```

### 12.2 Phase 4 Security Review Checklist

Before publishing v0.1.0, verify:

- [ ] No private keys are logged, serialized, or transmitted anywhere
- [ ] Signed state data is never stored unencrypted in a way accessible to third parties
- [ ] All ClearNode message inputs validated before processing (prevent injection)
- [ ] No eval() or dynamic code execution
- [ ] `npm audit` returns zero high or critical vulnerabilities
- [ ] Re-entrancy safe: `send()` queue prevents concurrent version increments
- [ ] `forceClose()` cannot be called twice simultaneously (mutex lock)
- [ ] Secrets (RPC URLs, private keys) never end up in persisted state storage

### 12.3 Phase 4 Performance Benchmarks

Run and document before publish:

| Operation | Target | How Measured |
|---|---|---|
| `channel.send()` round trip (sandbox) | < 100ms p50 | 1000 sends, median |
| `channel.open()` (Sepolia) | < 30s p90 | 20 opens, 90th percentile |
| `channel.checkpoint()` (Sepolia) | < 15s p90 | 20 checkpoints |
| `DisputeWatcher` event detection | < 30s p90 | 20 challenge events on Anvil |
| `IndexedDBAdapter.save()` | < 5ms p99 | 10000 saves, 99th percentile |
| `LevelDBAdapter.save()` | < 2ms p99 | 10000 saves, 99th percentile |

### 12.4 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml

on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test -- --project unit

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx anvil --fork-url ${{ secrets.SEPOLIA_RPC }} &
      - run: sleep 3
      - run: npm test -- --project integration

  e2e:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    env:
      YELLOW_E2E: "1"
      YELLOW_WS_URL: "wss://clearnet-sandbox.yellow.com/ws"
      SEPOLIA_RPC_URL: ${{ secrets.SEPOLIA_RPC_URL }}
      TEST_PRIVATE_KEY: ${{ secrets.TEST_PRIVATE_KEY }}
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test -- --project e2e

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx tsc --noEmit

  publish:
    needs: [unit, integration, typecheck]
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 12.5 Ecosystem Submission Checklist

- [ ] Published as `nitroguard` on npm
- [ ] GitHub repo public with clear README
- [ ] TypeDoc API reference hosted on GitHub Pages
- [ ] Submitted to Yellow ecosystem Discord `#builders` channel
- [ ] PR opened to Yellow official docs repo adding NitroGuard to ecosystem tools list
- [ ] Applied to Yellow grants program (if applicable)
- [ ] ETHGlobal Prague ERC-7824 prize submission prepared

### 12.6 Phase 4 Acceptance Criteria

- [ ] `npm install nitroguard` works cleanly in fresh CRA, Vite, and Next.js projects
- [ ] E2E sandbox tests pass on Sepolia
- [ ] README quick start completable in under 10 minutes by a new developer
- [ ] Zero `npm audit` high/critical vulnerabilities
- [ ] Performance benchmarks documented in README
- [ ] TypeDoc API reference live at `[repo].github.io/nitroguard`

---

## 13. Testing Strategy Overview

### 13.1 Test Pyramid

```
                    ┌────────────────────────┐
                    │  E2E (Sepolia Sandbox)  │  ~5 tests
                    │  Against live network   │  Slow / real testnet
                    ├────────────────────────┤
                    │   Integration Tests     │  ~25 tests
                    │  MockClearNode + Anvil  │  Medium speed, local
                    ├────────────────────────┤
                    │     Unit Tests          │  ~80 tests
                    │  Pure TypeScript logic  │  Fast, deterministic
                    └────────────────────────┘
```

### 13.2 Test Infrastructure Details

**`MockClearNode`** (`test/integration/helpers/MockClearNode.ts`)

A local WebSocket server that implements the ClearNode RPC protocol. Supports modes:
- `normal` — signs every state update and returns co-signature
- `silent` — stops responding (simulates offline ClearNode)
- `malicious` — submits stale challenge on-chain (requires Anvil access)
- `slow` — delays co-signatures by configurable ms (for timeout testing)
- `partialSign` — signs only some updates (for version sync testing)

**`AnvilFork`** (`test/integration/helpers/AnvilFork.ts`)

Manages a local Anvil EVM instance with:
- Yellow Custody contract pre-deployed (from their deployment directory)
- Pre-funded test accounts (100,000 USDC each)
- `increaseTime(seconds)` utility for challenge period simulation
- Reset between test suites for isolation
- Port randomization to allow parallel test runs

**`TestWallets`** (`test/integration/helpers/TestWallets.ts`)

Pre-funded test wallets using known private keys (never used on mainnet). Includes helper
functions for checking USDC balances before/after operations.

### 13.3 Coverage Targets Per Module

| Module | Line Coverage Target | Rationale |
|---|---|---|
| `channel/ChannelFSM` | 100% | Core safety logic — every branch matters |
| `channel/VersionManager` | 100% | Every version conflict case must be tested |
| `dispute/ChallengeManager` | 95% | Funds at stake — near-full coverage needed |
| `dispute/DisputeWatcher` | 90% | Event handling paths tested |
| `dispute/ClearNodeMonitor` | 90% | Timer logic tested |
| `persistence/MemoryAdapter` | 100% | Reference implementation |
| `persistence/IndexedDBAdapter` | 95% | Browser storage paths |
| `persistence/LevelDBAdapter` | 95% | Node storage paths |
| `protocol/defineProtocol` | 90% | Schema + transition coverage |
| `react/*` | 85% | Hooks behavior coverage |

---

## 14. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Nitrolite API changes (v0.5.0 migration recently published) | High | High | Pin to `0.4.x` for v0.1.0. Build adapter layer for v0.5.x upgrade path in v0.2.0. |
| Custody contract ABI changes post-mainnet | Low | Critical | Fetch ABI directly from chain. Version-pin `addresses.ts`. Alert on ABI mismatch. |
| Challenge period (1hr min) blocking CI integration tests | Certain | Medium | Always use Anvil `evm_increaseTime`. Never wait real time in tests. |
| Yellow team ships their own lifecycle SDK | Low | High | Move fast. Publish Phase 1 preview within 2 weeks. Engage Yellow team Discord early. |
| ClearNode protocol not fully documented | Medium | Medium | Reverse-engineer from Nitrolite SDK source + GitHub issues. Join Yellow Discord for questions. |
| IndexedDB unavailable in some contexts (private browsing) | Medium | Low | Graceful fallback to `MemoryAdapter` with `console.warn`. Never throw on unavailability. |
| viem breaking changes | Low | Low | Pin viem to `^2.0.0` with tested compatibility range. |
| React 19 compatibility | Low | Low | Test against both React 18 and 19 in CI matrix. |
| ClearNode goes down during E2E tests | Medium | Low | Retry logic in E2E tests. Mark E2E failures as warnings not blockers. |

---

## 15. Success Metrics

### Immediate (2 weeks post-publish)

| Metric | Target |
|---|---|
| npm weekly downloads | 100+ |
| GitHub stars | 50+ |
| Yellow Discord `#builders` mention / reaction | ✅ |
| Zero critical bugs reported | ✅ |

### 30 Days Post-Publish

| Metric | Target |
|---|---|
| npm weekly downloads | 500+ |
| Yellow apps using NitroGuard | 5+ confirmed |
| GitHub issues opened (signal of real adoption) | 10+ |
| Yellow team PR merged to their docs | ✅ |

### 90 Days Post-Publish

| Metric | Target |
|---|---|
| npm weekly downloads | 2000+ |
| Yellow apps using NitroGuard | 25+ |
| GitHub stars | 200+ |
| ETHGlobal Prague ERC-7824 prize ($10k) applied | ✅ |
| Yellow ecosystem grant applied | ✅ |
| Referenced in at least one Yellow ecosystem tutorial | ✅ |

---

## 16. Yellow Team Pitch Framing

### The One-Line Pitch

> "NitroGuard handles the full ERC-7824 state channel lifecycle — from open to dispute recovery
> — so your 500 builders can ship real apps without reinventing dispute resolution or risking
> user funds."

### What It Signals

**Protocol depth.** You've read the Custody contract. You know CHANOPEN, version tracking,
EIP-712 struct encoding, and the challenge-respond-reclaim flow. This is not a surface read.

**Firsthand pain.** You built OptiChannel on Yellow at HackMoney 2026. You know what was
missing because you hit the wall personally.

**Infrastructure, not a demo.** 500 builders are currently stuck. NitroGuard narrows the gap
between raw SDK and production app. It's an ecosystem activation tool.

**Proven pattern.** Starknet MCP server, Faucet Terminal CLI (1,200+ downloads in 3 weeks),
starknet.go contributions, Juno docs. The same pattern — identify tooling gap, build the
missing piece, watch the ecosystem use it.

### Conversation Opener (Discord DM to Yellow team)

> "hey — built OptiChannel on Yellow at HackMoney last month and hit the lifecycle gap hard:
> no persistence layer, no dispute watcher, had to wire everything from scratch.
>
> building NitroGuard — a lifecycle SDK wrapping ERC-7824 with a full state machine, automatic
> fund protection on ClearNode failure, and a clean API that gets a Yellow integration down from
> ~200 lines to ~15.
>
> phase 1 (open/send/close) is 2 weeks out. flagging early — happy to align with anything
> you're building on the SDK side so we don't duplicate work."

Three things this does: proves prior context, names the specific problem (not "cool tool"),
and opens collaboration rather than positioning as competition.

---

## Appendix A — Full Timeline

```
Week 1–2:   Phase 1 — Core Lifecycle Engine
            ChannelFSM, VersionManager, ChannelFactory
            open() / send() / close() / MemoryAdapter
            Unit tests + integration tests (MockClearNode + Anvil)

Week 3–4:   Phase 2 — Safety Layer
            IndexedDBAdapter, LevelDBAdapter
            DisputeWatcher, ClearNodeMonitor, ChallengeManager
            forceClose() + checkpoint() full implementation
            All dispute integration tests passing

Week 5:     Phase 3 — DX Layer
            defineProtocol() typed schema system
            NitroGuard.restore() full reconnect
            React hooks (nitroguard/react)
            TypeScript types review

Week 5–6:   Phase 4 — Hardening + Publication
            E2E tests on Sepolia sandbox
            Security review + performance benchmarks
            Full documentation
            npm publish as nitroguard@0.1.0
            Yellow ecosystem submission
```

---

## Appendix B — Prior Art Summary

| Project | Language | Protocol | Status | Relevance to NitroGuard |
|---|---|---|---|---|
| statechannels.org (L4/Counterfactual) | TypeScript | Custom | Dead | Proved lifecycle SDK is correct abstraction level |
| go-perun | Go | Perun | Active (alpha) | Best reference for persistence + dispute architecture patterns |
| yellow-ts | TypeScript | ERC-7824 | Active | WS transport only. NitroGuard builds on top of it. |
| @erc7824/nitrolite | TypeScript | ERC-7824 | Active | Primitive layer. NitroGuard wraps this. |
| Connext / Vector | TypeScript | Custom | Pivoted | Abandoned state channels for bridge/intent model |
| Lightning Network (lnd, LDK) | Go/Rust | Bitcoin | Production | Watchtower pattern directly informs DisputeWatcher design |

---

*NitroGuard — because production state channels shouldn't require a PhD in dispute resolution.*
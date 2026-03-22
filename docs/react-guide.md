# React Guide

NitroGuard ships React hooks out of the box. Import from `nitroguard/react`.

## Installation

```bash
npm install nitroguard viem @erc7824/nitrolite react react-dom
```

## Provider Setup

Wrap your app with `NitroGuardProvider`:

```tsx
import { NitroGuardProvider } from 'nitroguard/react';
import { mainnet } from 'viem/chains';

function App() {
  return (
    <NitroGuardProvider
      config={{
        clearnode: 'wss://clearnet.yellow.com/ws',
        signer,        // EIP712Signer
        chain: mainnet,
        rpcUrl: 'https://eth.llamarpc.com',
      }}
      createTransport={() => new MyTransport()}
      createPersistence={() => new IndexedDBAdapter('my-app')}
    >
      <YourApp />
    </NitroGuardProvider>
  );
}
```

### Props

| Prop | Type | Description |
|---|---|---|
| `config` | `OpenConfig` | Base channel config (clearnode URL, signer, chain, rpcUrl) |
| `createTransport` | `() => ClearNodeTransport` | Factory for the WebSocket transport — called lazily on first `open()` |
| `createPersistence` | `() => PersistenceAdapter` | (optional) Factory for the persistence adapter |

The factory pattern (`createTransport`, `createPersistence`) is **SSR-safe** — these functions are only called inside `useEffect`, never during server-side render.

---

## `useChannel()`

Full lifecycle hook. Returns everything you need to open, use, and close a channel.

```tsx
import { useChannel } from 'nitroguard/react';

function PaymentUI() {
  const { channel, status, version, isLoading, error, open, send, close } = useChannel();

  return (
    <div>
      <p>Status: {status}</p>
      <p>Version: {version}</p>

      {status === 'VOID' && (
        <button
          disabled={isLoading}
          onClick={() => open([{ token: USDC, amount: 100n * 10n ** 6n }])}
        >
          {isLoading ? 'Opening...' : 'Open Channel'}
        </button>
      )}

      {status === 'ACTIVE' && (
        <>
          <button
            disabled={isLoading}
            onClick={() => send({ type: 'payment', amount: 10n * 10n ** 6n })}
          >
            Pay 10 USDC
          </button>
          <button onClick={close}>Close Channel</button>
        </>
      )}

      {error && <p style={{ color: 'red' }}>{error.message}</p>}
    </div>
  );
}
```

### Returns

| Field | Type | Description |
|---|---|---|
| `channel` | `Channel \| null` | The channel instance (null before open) |
| `status` | `ChannelStatus` | Current FSM state: `'VOID' \| 'INITIAL' \| 'ACTIVE' \| 'DISPUTE' \| 'FINAL'` |
| `version` | `number` | Current state version (0 before first send) |
| `isLoading` | `boolean` | True during async operations (open, send, close) |
| `error` | `Error \| null` | Last error, if any |
| `open(assets)` | `(assets: Asset[]) => Promise<void>` | Open the channel with the given assets |
| `send(payload)` | `(payload: unknown) => Promise<void>` | Send an off-chain state update |
| `close()` | `() => Promise<void>` | Cooperatively close the channel |

---

## `useChannelBalance(channel)`

Reactive balance hook. Updates on every `stateUpdate` event.

```tsx
import { useChannel, useChannelBalance } from 'nitroguard/react';

function BalanceDisplay() {
  const { channel } = useChannel();
  const { myBalance, clearNodeBalance } = useChannelBalance(channel);

  return (
    <div>
      <p>My balance: {(myBalance / 10n ** 6n).toString()} USDC</p>
      <p>ClearNode: {(clearNodeBalance / 10n ** 6n).toString()} USDC</p>
    </div>
  );
}
```

### Returns

| Field | Type | Description |
|---|---|---|
| `myBalance` | `bigint` | Your allocation in the channel |
| `clearNodeBalance` | `bigint` | ClearNode's allocation |

Returns `{ myBalance: 0n, clearNodeBalance: 0n }` when `channel` is null.

---

## `useChannelStatus(channel)`

Lightweight alternative to `useChannel` — only subscribes to `statusChange` events. Use when you only need the status and want to avoid re-renders from version changes.

```tsx
import { useChannelStatus } from 'nitroguard/react';

function StatusBadge({ channel }) {
  const status = useChannelStatus(channel);

  const colors = {
    VOID: 'gray',
    INITIAL: 'yellow',
    ACTIVE: 'green',
    DISPUTE: 'red',
    FINAL: 'blue',
  };

  return <span style={{ color: colors[status] }}>{status}</span>;
}
```

### Returns

`ChannelStatus` — `'VOID' | 'INITIAL' | 'ACTIVE' | 'DISPUTE' | 'FINAL'`

---

## `useAllChannels()`

Lists all channel IDs from persistence. Useful for building a channel picker.

```tsx
import { useAllChannels } from 'nitroguard/react';

function ChannelList() {
  const channelIds = useAllChannels();

  if (channelIds.length === 0) {
    return <p>No saved channels.</p>;
  }

  return (
    <ul>
      {channelIds.map(id => (
        <li key={id}>
          <code>{id.slice(0, 10)}...</code>
        </li>
      ))}
    </ul>
  );
}
```

Requires `createPersistence` to be set on the provider.

---

## Typed Protocols with React

Pass a protocol to the provider config, and `send()` from `useChannel()` will be typed:

```tsx
import { NitroGuardProvider } from 'nitroguard/react';
import { defineProtocol } from 'nitroguard';
import { z } from 'zod';

const PaymentProtocol = defineProtocol({
  name: 'payment',
  version: 1,
  schema: z.object({
    to: z.string(),
    amount: z.bigint(),
  }),
});

function App() {
  return (
    <NitroGuardProvider
      config={{ ..., protocol: PaymentProtocol }}
      createTransport={() => new MyTransport()}
    >
      <PaymentUI />
    </NitroGuardProvider>
  );
}

function PaymentUI() {
  const { send } = useChannel();

  // TypeScript knows send() takes { to: string; amount: bigint }
  return <button onClick={() => send({ to: '0xBob...', amount: 10n })}>Pay</button>;
}
```

---

## Next.js Setup

NitroGuard's React hooks are client-only (they use `useEffect`, event listeners, and browser APIs). In Next.js App Router, mark any component using NitroGuard hooks with `'use client'`:

```tsx
'use client';

import { useChannel } from 'nitroguard/react';

export function PaymentButton() {
  const { send, status } = useChannel();
  // ...
}
```

For the provider, create a client component wrapper:

```tsx
// app/providers.tsx
'use client';

import { NitroGuardProvider } from 'nitroguard/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NitroGuardProvider
      config={{ clearnode: process.env.NEXT_PUBLIC_CLEARNODE_URL!, ... }}
      createTransport={() => new MyTransport()}
    >
      {children}
    </NitroGuardProvider>
  );
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

The provider itself is SSR-safe because `createTransport` and `createPersistence` are factories called only inside `useEffect`.

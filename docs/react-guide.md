<p>
  <img src="https://img.shields.io/badge/NitroGuard-React%20Guide-F5C518?style=flat-square&labelColor=000000" />
</p>

# React Guide

NitroGuard ships React hooks in the `nitroguard/react` subpath. Import from there to keep your bundle clean — hooks and the core SDK tree-shake independently.

```bash
npm install nitroguard viem react react-dom
```

---

## Provider setup

Wrap your app with `NitroGuardProvider`. The provider is SSR-safe — `createTransport` and `createPersistence` are factory functions called lazily inside `useEffect`, never during server-side render.

```tsx
import { NitroGuardProvider } from 'nitroguard/react';
import { mainnet } from 'viem/chains';

function App() {
  return (
    <NitroGuardProvider
      config={{
        clearnode: 'wss://clearnet.yellow.com/ws',
        signer,
        chain:  mainnet,
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

**Props:**

| Prop | Type | |
|---|---|---|
| `config` | `OpenConfig` | Base config — `assets` and `persistence` are overridden per call |
| `createTransport` | `() => ClearNodeTransport` | Factory — called once on first `open()` |
| `createPersistence` | `() => PersistenceAdapter` | Optional factory |

---

## `useChannel()`

Full lifecycle hook.

```tsx
import { useChannel } from 'nitroguard/react';

function PaymentUI() {
  const { channel, status, version, isLoading, error, open, send, close } = useChannel();

  return (
    <>
      <p>Status: {status}  |  Version: {version}</p>

      {status === 'VOID' && (
        <button disabled={isLoading} onClick={() => open([{ token: USDC, amount: 100n * 10n ** 6n }])}>
          {isLoading ? 'Opening…' : 'Open channel'}
        </button>
      )}

      {status === 'ACTIVE' && (
        <>
          <button onClick={() => send({ amount: 10n * 10n ** 6n })}>Pay 10 USDC</button>
          <button onClick={close}>Close</button>
        </>
      )}

      {error && <p style={{ color: 'red' }}>{error.message}</p>}
    </>
  );
}
```

**Returns:**

| | Type | |
|---|---|---|
| `channel` | `Channel \| null` | `null` before `open()` |
| `status` | `ChannelStatus` | `'VOID' \| 'INITIAL' \| 'ACTIVE' \| 'DISPUTE' \| 'FINAL'` |
| `version` | `number` | Current version (0 before first send) |
| `isLoading` | `boolean` | `true` during `open`, `send`, `close` |
| `error` | `Error \| null` | Last error |
| `open(assets)` | `fn` | Open with given assets |
| `send(payload)` | `fn` | Off-chain state update |
| `close()` | `fn` | Cooperative close |

---

## `useChannelBalance(channel)`

Subscribes to `stateUpdate` and returns reactive balances.

```tsx
import { useChannel, useChannelBalance } from 'nitroguard/react';

function Balance() {
  const { channel } = useChannel();
  const { myBalance, clearNodeBalance } = useChannelBalance(channel);

  return (
    <p>
      My balance: {(myBalance / 10n ** 6n).toString()} USDC
    </p>
  );
}
```

Returns `{ myBalance: 0n, clearNodeBalance: 0n }` when `channel` is `null`.

---

## `useChannelStatus(channel)`

Lightweight — only subscribes to `statusChange` events. Use this when you only need the status and want to avoid re-renders triggered by version increments.

```tsx
import { useChannelStatus } from 'nitroguard/react';

function StatusBadge({ channel }) {
  const status = useChannelStatus(channel);
  return <span data-status={status}>{status}</span>;
}
```

---

## `useAllChannels()`

Lists all `channelId`s from persistence. Useful for building a channel picker.

```tsx
import { useAllChannels } from 'nitroguard/react';

function ChannelList() {
  const channelIds = useAllChannels();
  return <ul>{channelIds.map(id => <li key={id}>{id.slice(0, 12)}…</li>)}</ul>;
}
```

Requires `createPersistence` to be set on the provider.

---

## Typed protocols in React

Pass a protocol in the provider config and `send()` from `useChannel()` will be typed:

```tsx
import { NitroGuardProvider } from 'nitroguard/react';
import { defineProtocol } from 'nitroguard';
import { z } from 'zod';

const PaymentProtocol = defineProtocol({
  name: 'payment', version: 1,
  schema: z.object({ to: z.string(), amount: z.bigint() }),
});

<NitroGuardProvider config={{ ...config, protocol: PaymentProtocol }} createTransport={...}>
  <App />
</NitroGuardProvider>
```

---

## Next.js App Router

Hooks use `useEffect`, event listeners, and browser APIs — mark any component using NitroGuard hooks as a client component:

```tsx
// components/PaymentUI.tsx
'use client';

import { useChannel } from 'nitroguard/react';

export function PaymentUI() { ... }
```

Create a client component wrapper for the provider:

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

export default function Layout({ children }) {
  return <html><body><Providers>{children}</Providers></body></html>;
}
```

The provider is SSR-safe — the transport factory is called only client-side, so no hydration errors.

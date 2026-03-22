/**
 * Minimal ABI for the Yellow Network Custody contract.
 *
 * Only includes the functions and events NitroGuard needs to call directly.
 * Full ABI available from the nitrolite package or on-chain.
 *
 * Based on ERC-7824 specification.
 */
export const CUSTODY_ABI = [
  // ─── State Reads ──────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'getChannelStatus',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [{ name: 'status', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getChannel',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [
      {
        name: 'channel',
        type: 'tuple',
        components: [
          { name: 'participants', type: 'address[]' },
          { name: 'adjudicator', type: 'address' },
          { name: 'challenge', type: 'uint64' },
          { name: 'nonce', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  // ─── Lifecycle Functions ──────────────────────────────────────────────────
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'create',
    inputs: [
      {
        name: 'channel',
        type: 'tuple',
        components: [
          { name: 'participants', type: 'address[]' },
          { name: 'adjudicator', type: 'address' },
          { name: 'challenge', type: 'uint64' },
          { name: 'nonce', type: 'uint64' },
        ],
      },
      {
        name: 'initialState',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          { name: 'allocations', type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'clientBalance', type: 'uint256' },
              { name: 'clearNodeBalance', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'close',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'finalState',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          { name: 'allocations', type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'clientBalance', type: 'uint256' },
              { name: 'clearNodeBalance', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'challenge',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          { name: 'allocations', type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'clientBalance', type: 'uint256' },
              { name: 'clearNodeBalance', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'respond',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          { name: 'allocations', type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'clientBalance', type: 'uint256' },
              { name: 'clearNodeBalance', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'checkpoint',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          { name: 'allocations', type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'clientBalance', type: 'uint256' },
              { name: 'clearNodeBalance', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ─── Events ───────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'ChannelCreated',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'participants', type: 'address[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ChallengeRegistered',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'challengeVersion', type: 'uint64', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ChallengeCleared',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ChannelFinalized',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'finalVersion', type: 'uint64', indexed: false },
    ],
  },
] as const;

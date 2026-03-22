import type { SignedState } from './types.js';

/**
 * Abstract transport interface for ClearNode communication.
 *
 * NitroGuard communicates with ClearNode over WebSocket using a JSON-RPC 2.0
 * protocol. This interface abstracts that transport so:
 *  1. Unit tests can use a no-op stub
 *  2. Integration tests can use MockClearNode
 *  3. Production uses yellow-ts + @erc7824/nitrolite message builders
 */
export interface ClearNodeTransport {
  /**
   * Connect to the ClearNode WebSocket endpoint.
   * Resolves when the connection is established and authenticated.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the ClearNode.
   */
  disconnect(): Promise<void>;

  /**
   * Whether the transport is currently connected.
   */
  readonly isConnected: boolean;

  /**
   * The ClearNode's Ethereum address (discovered during connection handshake).
   */
  readonly clearNodeAddress: `0x${string}`;

  /**
   * Send a proposed state to ClearNode and await its co-signature.
   *
   * @param channelId - The channel to update
   * @param state - Partially signed state (client-signed, awaiting ClearNode sig)
   * @param timeoutMs - How long to wait for the co-signature
   * @returns The fully co-signed state
   */
  proposeState(
    channelId: string,
    state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` },
    timeoutMs: number,
  ): Promise<SignedState>;

  /**
   * Send the initial CHANOPEN state and await ClearNode's co-signature
   * to activate the channel.
   */
  openChannel(
    channelId: string,
    state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` },
    timeoutMs?: number,
  ): Promise<SignedState>;

  /**
   * Send a CHANFINAL state and await ClearNode's co-signature to
   * initiate cooperative close.
   */
  closeChannel(
    channelId: string,
    state: Omit<SignedState, 'sigClearNode'> & { sigClearNode?: `0x${string}` },
    timeoutMs?: number,
  ): Promise<SignedState>;

  /**
   * Register a listener for unsolicited messages from ClearNode
   * (e.g. heartbeats, push updates).
   */
  onMessage(handler: (message: unknown) => void): () => void;
}

// ─── EIP-712 Signer Interface ────────────────────────────────────────────────
//
// NitroGuard is signer-agnostic. Any wallet (viem, ethers, raw private key)
// that implements this interface can be used.

export interface EIP712Signer {
  /** The signer's Ethereum address */
  readonly address: `0x${string}`;

  /**
   * Sign an EIP-712 typed data message.
   * Returns the hex-encoded signature.
   */
  signTypedData(params: EIP712SignParams): Promise<`0x${string}`>;

  /**
   * Sign a raw message hash (keccak256).
   * Used for session key signing.
   */
  signMessage(message: string | Uint8Array): Promise<`0x${string}`>;
}

export interface EIP712SignParams {
  domain: EIP712Domain;
  types: Record<string, EIP712TypeEntry[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface EIP712Domain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: `0x${string}`;
}

export interface EIP712TypeEntry {
  name: string;
  type: string;
}

import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import type { EIP712Signer, EIP712SignParams } from '../types.js';

/**
 * EIP712Signer adapter for a raw private key hex string.
 *
 * Suitable for server-side / test use. Do NOT use with user-facing private
 * keys in a browser — use ViemSigner with MetaMask instead.
 *
 * Usage:
 * ```ts
 * const signer = new RawSigner('0xdeadbeef...', 1, 'https://eth.llamarpc.com');
 * ```
 */
export class RawSigner implements EIP712Signer {
  private readonly _inner: import('../types.js').EIP712Signer;

  constructor(privateKey: `0x${string}`, chainId: number, rpcUrl: string) {
    const account = privateKeyToAccount(privateKey);
    const client = createWalletClient({
      account,
      transport: http(rpcUrl),
    });
    // Lazy import to avoid circular — inline the implementation
    this._inner = {
      address: account.address,
      signTypedData: (params: EIP712SignParams) =>
        client.signTypedData({
          account,
          domain: params.domain,
          types: params.types as Parameters<typeof client.signTypedData>[0]['types'],
          primaryType: params.primaryType,
          message: params.message,
        }),
      signMessage: (message: string | Uint8Array) =>
        client.signMessage({
          account,
          message: typeof message === 'string' ? message : { raw: message },
        }),
    };
  }

  get address(): `0x${string}` {
    return this._inner.address;
  }

  signTypedData(params: EIP712SignParams): Promise<`0x${string}`> {
    return this._inner.signTypedData(params);
  }

  signMessage(message: string | Uint8Array): Promise<`0x${string}`> {
    return this._inner.signMessage(message);
  }
}

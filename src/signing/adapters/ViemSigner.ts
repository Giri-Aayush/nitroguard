import type { WalletClient, Account } from 'viem';
import type { EIP712Signer, EIP712SignParams } from '../types.js';

/**
 * EIP712Signer adapter for viem WalletClient.
 *
 * Usage:
 * ```ts
 * import { createWalletClient, http } from 'viem';
 * import { privateKeyToAccount } from 'viem/accounts';
 *
 * const account = privateKeyToAccount('0x...');
 * const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
 * const signer = new ViemSigner(walletClient);
 * ```
 */
export class ViemSigner implements EIP712Signer {
  private readonly _client: WalletClient;
  private readonly _account: Account;

  constructor(client: WalletClient, account?: Account) {
    this._client = client;
    const acct = account ?? client.account;
    if (!acct) {
      throw new Error('ViemSigner: WalletClient must have an account or one must be provided');
    }
    this._account = acct;
  }

  get address(): `0x${string}` {
    return this._account.address;
  }

  async signTypedData(params: EIP712SignParams): Promise<`0x${string}`> {
    return this._client.signTypedData({
      account: this._account,
      domain: params.domain,
      types: params.types as Parameters<WalletClient['signTypedData']>[0]['types'],
      primaryType: params.primaryType,
      message: params.message,
    });
  }

  async signMessage(message: string | Uint8Array): Promise<`0x${string}`> {
    return this._client.signMessage({
      account: this._account,
      message: typeof message === 'string' ? message : { raw: message },
    });
  }
}

/**
 * Known Custody contract addresses by chain ID.
 *
 * Updated as Yellow Network deploys to new chains.
 * Source: https://github.com/erc7824/nitrolite
 */
export const CUSTODY_ADDRESSES: Readonly<Record<number, `0x${string}`>> = {
  // Ethereum Mainnet
  1: '0x0000000000000000000000000000000000000000', // TODO: fill post-mainnet-deploy
  // Sepolia Testnet
  11155111: '0x0000000000000000000000000000000000000000', // TODO: fill with actual testnet address
  // Local Anvil (default)
  31337: '0x0000000000000000000000000000000000000000',
};

export function getCustodyAddress(chainId: number): `0x${string}` | undefined {
  return CUSTODY_ADDRESSES[chainId];
}

/**
 * Wallet address validation and detection
 */

export type WalletType = 'evm' | 'solana' | 'unknown';

// EVM: 0x + 40 hex characters
const EVM_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Solana: Base58, 32-44 characters (no 0, O, I, l)
const SOLANA_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Detect wallet type from address
 */
export function detectWalletType(address: string): WalletType {
  if (EVM_REGEX.test(address)) {
    return 'evm';
  }
  if (SOLANA_REGEX.test(address)) {
    return 'solana';
  }
  return 'unknown';
}

/**
 * Validate wallet address
 */
export function isValidWallet(address: string): boolean {
  return detectWalletType(address) !== 'unknown';
}

/**
 * Get supported chains for wallet type
 */
export function getChainsForWalletType(type: WalletType): string[] {
  switch (type) {
    case 'evm':
      return ['base', 'polygon', 'bnb', 'base_sepolia', 'polygon_amoy', 'bnb_testnet'];
    case 'solana':
      return ['solana', 'solana_devnet'];
    default:
      return [];
  }
}

/**
 * Get wallet type needed for a chain
 */
export function getWalletTypeForChain(chain: string): WalletType {
  if (chain.startsWith('solana')) {
    return 'solana';
  }
  return 'evm';
}

/**
 * Format wallet type for display
 */
export function formatWalletType(type: WalletType): string {
  switch (type) {
    case 'evm':
      return 'EVM (Base, Polygon, BNB)';
    case 'solana':
      return 'Solana';
    default:
      return 'Unknown';
  }
}

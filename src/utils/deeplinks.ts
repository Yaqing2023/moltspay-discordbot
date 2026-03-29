/**
 * Wallet deep link generators
 */

// USDC contract addresses per chain
const USDC_ADDRESSES: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  bnb: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint
};

// Chain IDs for EVM chains
const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  polygon: 137,
  bnb: 56,
};

// Convert USDC amount to smallest unit (6 decimals)
function toUSDCUnits(amount: number): string {
  return Math.floor(amount * 1_000_000).toString();
}

export interface WalletLink {
  name: string;
  emoji: string;
  mobileUrl: string;
  webUrl?: string;  // Optional - some wallets are mobile-only
}

/**
 * Generate wallet deep links for EVM chains
 */
export function getEVMWalletLinks(
  chain: string,
  recipientAddress: string,
  amountUSDC: number
): WalletLink[] {
  const chainId = CHAIN_IDS[chain];
  const usdcAddress = USDC_ADDRESSES[chain];
  const amountUnits = toUSDCUnits(amountUSDC);
  
  if (!chainId || !usdcAddress) {
    return [];
  }
  
  // Standard EIP-681 URI (works as fallback)
  const eip681 = `ethereum:${usdcAddress}@${chainId}/transfer?address=${recipientAddress}&uint256=${amountUnits}`;
  
  return [
    {
      name: 'MetaMask',
      emoji: '🦊',
      mobileUrl: `https://metamask.app.link/send/${usdcAddress}@${chainId}/transfer?address=${recipientAddress}&uint256=${amountUnits}`,
      webUrl: `https://portfolio.metamask.io/transfer?chain=${chainId}&token=${usdcAddress}&to=${recipientAddress}&amount=${amountUSDC}`,
    },
    {
      name: 'Coinbase',
      emoji: '📘',
      mobileUrl: `https://go.cb-w.com/send?address=${recipientAddress}&amount=${amountUSDC}&asset=USDC&chain=${chain}`,
      webUrl: `https://wallet.coinbase.com/send?address=${recipientAddress}&amount=${amountUSDC}&asset=USDC&chainId=${chainId}`,
    },
    {
      name: 'Trust',
      emoji: '🛡️',
      mobileUrl: `https://link.trustwallet.com/send?coin=20000714&address=${recipientAddress}&amount=${amountUSDC}&token_id=${usdcAddress}`,
    },
  ];
}

/**
 * Generate wallet deep links for Solana
 */
export function getSolanaWalletLinks(
  recipientAddress: string,
  amountUSDC: number
): WalletLink[] {
  const usdcMint = USDC_ADDRESSES['solana'];
  
  return [
    {
      name: 'Phantom',
      emoji: '👻',
      mobileUrl: `https://phantom.app/ul/v1/transfer?recipient=${recipientAddress}&amount=${amountUSDC}&splToken=${usdcMint}`,
      webUrl: `https://phantom.app/ul/v1/transfer?recipient=${recipientAddress}&amount=${amountUSDC}&splToken=${usdcMint}`,
    },
    {
      name: 'Solflare',
      emoji: '🔆',
      mobileUrl: `https://solflare.com/ul/v1/transfer?recipient=${recipientAddress}&amount=${amountUSDC}&splToken=${usdcMint}`,
      webUrl: `https://solflare.com/ul/v1/transfer?recipient=${recipientAddress}&amount=${amountUSDC}&splToken=${usdcMint}`,
    },
  ];
}

/**
 * Get wallet links based on chain type
 */
export function getWalletLinks(
  chain: string,
  recipientAddress: string,
  amountUSDC: number
): WalletLink[] {
  if (chain === 'solana') {
    return getSolanaWalletLinks(recipientAddress, amountUSDC);
  }
  return getEVMWalletLinks(chain, recipientAddress, amountUSDC);
}

/**
 * Coinbase Onramp URL Builder
 * 
 * Requires COINBASE_ONRAMP_APP_ID from CDP Portal:
 * https://portal.cdp.coinbase.com → Create Project → Enable Onramp
 */

// Chain to Coinbase network mapping
const CHAIN_TO_NETWORK: Record<string, string> = {
  base: 'base',
  polygon: 'polygon',
  // Note: Coinbase Onramp may not support all chains
};

/**
 * Build Coinbase Onramp URL for fiat-to-USDC purchase
 */
export function buildOnrampUrl(
  destinationWallet: string,
  fiatAmount: number,
  chain: string,
  paymentId: string
): string {
  const appId = process.env.COINBASE_ONRAMP_APP_ID;
  if (!appId) {
    console.warn('⚠️ COINBASE_ONRAMP_APP_ID not set - onramp may not work');
  }
  
  const network = CHAIN_TO_NETWORK[chain] || 'base';
  
  const destinationWallets = [{
    address: destinationWallet,
    assets: ['USDC'],
    supportedNetworks: [network]
  }];
  
  const params = new URLSearchParams({
    // Pre-fill amount
    presetFiatAmount: fiatAmount.toFixed(2),
    fiatCurrency: 'USD',
    // Default to USDC
    defaultAsset: 'USDC',
    defaultNetwork: network,
    // Reference for tracking (will show in transaction)
    partnerUserId: paymentId
  });
  
  // Add appId if configured
  if (appId) {
    params.set('appId', appId);
  }
  
  // Add destination wallets
  params.set('destinationWallets', JSON.stringify(destinationWallets));
  
  return `https://pay.coinbase.com/buy/select-asset?${params.toString()}`;
}

/**
 * Calculate fiat price with markup
 */
export function calculateFiatPrice(basePrice: number, markupPercent: number): number {
  return basePrice * (1 + markupPercent);
}

/**
 * Check if chain supports Coinbase Onramp
 */
export function isOnrampSupported(chain: string): boolean {
  return chain in CHAIN_TO_NETWORK;
}

/**
 * Filter chains to only those that support onramp
 */
export function getOnrampChains(chains: string[]): string[] {
  return chains.filter(chain => isOnrampSupported(chain));
}

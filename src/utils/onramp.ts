/**
 * Coinbase Onramp Integration
 * 
 * Uses MoltsPay server API to generate onramp URLs
 * (server handles CDP authentication and session tokens)
 */

const ONRAMP_API = process.env.MOLTSPAY_ONRAMP_API || 'https://moltspay.com/api/v1/onramp';

// Chains that support Coinbase Onramp
const ONRAMP_CHAINS = ['base', 'polygon'];

/**
 * Build Coinbase Onramp URL via MoltsPay API
 */
export async function buildOnrampUrl(
  destinationWallet: string,
  fiatAmount: number,
  chain: string,
  paymentId: string
): Promise<string> {
  if (!ONRAMP_CHAINS.includes(chain)) {
    throw new Error(`Chain ${chain} does not support Coinbase Onramp`);
  }

  const response = await fetch(`${ONRAMP_API}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: destinationWallet,
      amount: fiatAmount,
      chain,
      reference: paymentId,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Server error' })) as { error?: string };
    throw new Error(errorData.error || `Onramp API returned ${response.status}`);
  }

  const result = await response.json() as { url: string };
  return result.url;
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
  return ONRAMP_CHAINS.includes(chain);
}

/**
 * Filter chains to only those that support onramp
 */
export function getOnrampChains(chains: string[]): string[] {
  return chains.filter(chain => isOnrampSupported(chain));
}

/**
 * Check if onramp is available (API is always available)
 */
export function hasOnrampCredentials(): boolean {
  return true; // Server handles credentials
}

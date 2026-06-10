/**
 * Payment Poller - checks blockchain for incoming USDC transfers
 *
 * Fixes (2026-06-04):
 * - Reuse JsonRpcProvider per chain (was creating new ones → memory leak)
 * - Hard time limit (20min) regardless of poll count
 * - Force stop on repeated errors
 * - stopAllPollers() for graceful shutdown
 */

import { ethers } from 'ethers';
import { getPayment, updatePayment, getProduct, isTxHashUsed } from './database';
import { PaymentSession } from '../types';

// RPC endpoints (same as MoltsPay)
const RPC_URLS: Record<string, string> = {
  base: 'https://mainnet.base.org',
  polygon: 'https://polygon.llamarpc.com',
  bnb: 'https://bsc-dataseed.binance.org',
};

// USDC contract addresses
const USDC_ADDRESSES: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  bnb: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

// ERC20 Transfer event signature
const TRANSFER_EVENT = 'event Transfer(address indexed from, address indexed to, uint256 value)';

// Polling config
const POLL_INTERVAL_MS = 10_000; // 10 seconds
const MAX_POLLS = 90; // 15 minutes total (90 × 10s = 900s)
const MAX_POLL_AGE_MS = 20 * 60 * 1000; // 20 minutes hard limit

// Active polling sessions
const activePollers: Map<string, NodeJS.Timeout> = new Map();

// Cached JsonRpcProvider per chain (reuse instead of creating new ones each time)
const providerCache: Map<string, ethers.JsonRpcProvider> = new Map();

function getProvider(chain: string, rpcUrl: string): ethers.JsonRpcProvider {
  let provider = providerCache.get(chain);
  if (!provider) {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    providerCache.set(chain, provider);
    console.log(`[Poller] Created cached provider for ${chain}`);
  }
  return provider;
}

// Callbacks for payment events
type PaymentCallback = (paymentId: string, txHash: string) => void;
let onPaymentConfirmed: PaymentCallback | null = null;
let onPaymentExpired: ((paymentId: string) => void) | null = null;

export function setPaymentCallbacks(
  onConfirmed: PaymentCallback,
  onExpired: (paymentId: string) => void
) {
  onPaymentConfirmed = onConfirmed;
  onPaymentExpired = onExpired;
}

/**
 * Start polling for a payment
 */
export async function startPolling(
  paymentId: string,
  chain: string,
  walletAddress: string,
  expectedAmount: number
): Promise<void> {
  // Don't start if already polling
  if (activePollers.has(paymentId)) {
    return;
  }

  const rpcUrl = RPC_URLS[chain];
  const usdcAddress = USDC_ADDRESSES[chain];
  
  if (!rpcUrl || !usdcAddress) {
    console.error(`Polling not supported for chain: ${chain}`);
    return;
  }

  const provider = getProvider(chain, rpcUrl);
  const startBlock = await provider.getBlockNumber();
  let pollCount = 0;
  const startTime = Date.now();

  console.log(`[Poller] Starting for payment ${paymentId} on ${chain}, block ${startBlock}`);

  const poll = async () => {
    pollCount++;

    // Hard time limit - stop no matter what after MAX_POLL_AGE_MS
    if (Date.now() - startTime > MAX_POLL_AGE_MS) {
      console.log(`[Poller] ${paymentId}: hard time limit reached (${Math.round((Date.now() - startTime) / 1000)}s), stopping`);
      stopPolling(paymentId);
      const payment = getPayment(paymentId);
      if (payment && payment.status === 'pending') {
        updatePayment(paymentId, { status: 'expired' });
        if (onPaymentExpired) onPaymentExpired(paymentId);
      }
      return;
    }

    console.log(`[Poller] ${paymentId}: poll ${pollCount}/${MAX_POLLS}`);

    try {
      // Check if payment still pending
      const payment = getPayment(paymentId);
      if (!payment || payment.status !== 'pending') {
        console.log(`[Poller] ${paymentId}: payment no longer pending, stopping`);
        stopPolling(paymentId);
        return;
      }

      // Query for Transfer events to our wallet
      const found = await checkForTransfer(
        provider,
        usdcAddress,
        walletAddress,
        expectedAmount,
        startBlock,
        chain
      );

      if (found) {
        // Check if this txHash was already used for another payment
        if (isTxHashUsed(found.txHash)) {
          console.log(`[Poller] ${paymentId}: found tx=${found.txHash} but already used, skipping`);
          // Continue polling - this tx was for someone else
        } else {
          console.log(`[Poller] ${paymentId}: payment found! tx=${found.txHash}`);
          stopPolling(paymentId);
          
          // Update payment status
          updatePayment(paymentId, {
            status: 'paid',
            txHash: found.txHash,
            paidAt: new Date()
          });

          // Trigger callback
          if (onPaymentConfirmed) {
            onPaymentConfirmed(paymentId, found.txHash);
          }
          return;
        }
      }

      // Check if max polls reached
      if (pollCount >= MAX_POLLS) {
        console.log(`[Poller] ${paymentId}: max polls reached, expiring`);
        stopPolling(paymentId);
        
        updatePayment(paymentId, { status: 'expired' });
        
        if (onPaymentExpired) {
          onPaymentExpired(paymentId);
        }
        return;
      }

    } catch (error) {
      console.error(`[Poller] ${paymentId}: error`, error);
      // Force stop if way too many errors to prevent infinite loops
      if (pollCount > MAX_POLLS + 10) {
        console.error(`[Poller] ${paymentId}: too many errors, force stopping`);
        stopPolling(paymentId);
      }
    }
  };

  // Start polling
  poll(); // First poll immediately
  const interval = setInterval(poll, POLL_INTERVAL_MS);
  activePollers.set(paymentId, interval);
}

/**
 * Stop polling for a payment
 */
export function stopPolling(paymentId: string): void {
  const interval = activePollers.get(paymentId);
  if (interval) {
    clearInterval(interval);
    activePollers.delete(paymentId);
    console.log(`[Poller] Stopped polling for ${paymentId}`);
  }
}

/**
 * Check for USDC transfer to wallet
 */
async function checkForTransfer(
  provider: ethers.JsonRpcProvider,
  usdcAddress: string,
  walletAddress: string,
  expectedAmount: number,
  fromBlock: number,
  chain: string
): Promise<{ txHash: string; amount: number } | null> {
  const contract = new ethers.Contract(
    usdcAddress,
    [TRANSFER_EVENT],
    provider
  );

  const currentBlock = await provider.getBlockNumber();
  
  // Query Transfer events to our wallet
  const filter = contract.filters.Transfer(null, walletAddress);
  const events = await contract.queryFilter(filter, fromBlock, currentBlock);

  // USDC has 6 decimals
  const expectedAmountWei = BigInt(Math.floor(expectedAmount * 1_000_000));

  for (const event of events) {
    const log = event as ethers.EventLog;
    const value = log.args[2] as bigint;
    
    // Check if amount matches (allow slight overpayment)
    if (value >= expectedAmountWei) {
      return {
        txHash: log.transactionHash,
        amount: Number(value) / 1_000_000
      };
    }
  }

  return null;
}

/**
 * Get active polling count
 */
export function getActivePollingCount(): number {
  return activePollers.size;
}

/**
 * Stop all active pollers (for graceful shutdown)
 */
export function stopAllPollers(): void {
  for (const [paymentId, interval] of activePollers) {
    clearInterval(interval);
    console.log(`[Poller] Stopped polling for ${paymentId} (shutdown)`);
  }
  activePollers.clear();
}

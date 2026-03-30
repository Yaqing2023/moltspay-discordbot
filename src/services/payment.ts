/**
 * Payment Service - handles payment creation and verification
 */

import { createPayment, getPayment, updatePayment, getProduct } from './database';
import { generateId } from '../utils/crypto';
import { PaymentSession, Product } from '../types';

const PAYMENT_EXPIRY_MINUTES = 15;

export interface CreatePaymentResult {
  paymentId: string;
  paymentUrl: string;
  expiresAt: Date;
  amount: number;  // Unique amount with random sub-cents
}

/**
 * Generate unique payment amount by adding random sub-cents
 * This prevents duplicate detection when multiple users pay same price
 */
function generateUniqueAmount(basePrice: number): number {
  // Add random 0.001 to 0.009 to make each payment unique
  const randomCents = Math.floor(Math.random() * 9 + 1) / 1000;
  return Math.round((basePrice + randomCents) * 1000000) / 1000000; // USDC has 6 decimals
}

/**
 * Create a new payment session
 * @param chain - Selected chain for payment (user picks from product.chains)
 */
export function createPaymentSession(
  userId: string,
  serverId: string,
  product: Product,
  chain?: string
): CreatePaymentResult {
  const paymentId = generateId();
  const expiresAt = new Date(Date.now() + PAYMENT_EXPIRY_MINUTES * 60 * 1000);
  
  // Use provided chain or default to first available chain
  const selectedChain = chain || product.chains[0];
  
  // Generate unique amount to prevent duplicate detection
  const uniqueAmount = generateUniqueAmount(product.price);
  
  createPayment({
    paymentId,
    discordUserId: userId,
    discordServerId: serverId,
    productId: product.id,
    amount: uniqueAmount,
    currency: product.currency,
    chain: selectedChain,
    status: 'pending',
    createdAt: new Date(),
    expiresAt
  });
  
  // For now, generate a simple payment URL
  // TODO: Integrate with MoltsPay API to create actual payment request
  const paymentUrl = `https://moltspay.com/pay/${paymentId}`;
  
  return {
    paymentId,
    paymentUrl,
    expiresAt,
    amount: uniqueAmount
  };
}

/**
 * Mark payment as paid (called by webhook or test command)
 */
export function markPaymentPaid(paymentId: string, txHash?: string): PaymentSession | null {
  const payment = getPayment(paymentId);
  if (!payment) return null;
  
  if (payment.status !== 'pending') {
    return payment; // Already processed
  }
  
  updatePayment(paymentId, {
    status: 'paid',
    txHash: txHash || 'TEST_' + Date.now(),
    paidAt: new Date()
  });
  
  return getPayment(paymentId);
}

/**
 * Mark payment as fulfilled
 */
export function markPaymentFulfilled(paymentId: string): void {
  updatePayment(paymentId, {
    status: 'fulfilled',
    fulfilledAt: new Date(),
    webhookProcessed: true
  });
}

/**
 * Get pending payment for a user and product
 */
export function getPendingPayment(userId: string, productId: string): PaymentSession | null {
  // This would need a database query - for now return null
  // TODO: Add query to database.ts
  return null;
}

/**
 * Expire old payments (run periodically)
 */
export function expireOldPayments(): number {
  // TODO: Implement - update all pending payments past expiresAt to 'expired'
  return 0;
}

/**
 * MoltsPay Discord Bot - Type Definitions
 */

// Server configuration
export interface ServerConfig {
  serverId: string;
  evmWallet: string | null;
  solanaWallet: string | null;
  defaultChain: string;
  createdAt: Date;
}

// Product types
export type ProductType = 'role' | 'channel' | 'service' | 'digital' | 'custom';
export type BillingType = 'one_time' | 'subscription';
export type BillingPeriod = 'monthly' | 'yearly';

export interface Product {
  id: string;
  serverId: string;
  name: string;
  type: ProductType;
  price: number;
  currency: string;
  chains: string[];  // Multiple chains supported
  
  // Type-specific fields
  discordRoleId?: string;
  serviceEndpoint?: string;
  fileUrl?: string;
  webhookUrl?: string;
  
  // Billing
  billingType: BillingType;
  billingPeriod?: BillingPeriod;
  
  active: boolean;
  createdAt: Date;
}

// Subscription status
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

// Subscription
export interface Subscription {
  id: string;
  userId: string;
  productId: string;
  serverId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  lastPaymentId?: string;
  reminderSent: boolean;
  createdAt: Date;
  cancelledAt?: Date;
}

// Payment status
export type PaymentStatus = 'pending' | 'paid' | 'fulfilled' | 'expired' | 'failed';

// Payment session
export interface PaymentSession {
  paymentId: string;
  discordUserId: string;
  discordServerId: string;
  productId: string;
  
  amount: number;
  currency: string;
  chain: string;
  
  status: PaymentStatus;
  txHash?: string;
  
  createdAt: Date;
  expiresAt: Date;
  paidAt?: Date;
  fulfilledAt?: Date;
  
  webhookProcessed: boolean;
  fulfillmentAttempts: number;
}

// User wallet (for bot-managed wallets)
export interface UserWallet {
  discordId: string;
  encryptedPrivateKey: string;
  address: string;
  chain: string;
  
  // Settings
  defaultChain: string;
  maxPerTx: number;
  maxPerDay: number;
  notificationsEnabled: boolean;
  
  // Tracking
  spentToday: number;
  lastResetDate: string;
  createdAt: Date;
}

// Transaction record
export interface Transaction {
  id: string;
  discordId: string;
  service: string;
  provider: string;
  amount: number;
  chain: string;
  txHash: string;
  status: 'pending' | 'success' | 'failed';
  timestamp: Date;
  result?: any;
}

// Webhook payload from MoltsPay
export interface WebhookPayload {
  paymentId: string;
  status: 'paid' | 'failed' | 'expired';
  txHash?: string;
  amount: number;
  currency: string;
  chain: string;
  timestamp: string;
}

// Command interaction context
export interface CommandContext {
  userId: string;
  serverId: string;
  channelId: string;
  isAdmin: boolean;
}

/**
 * Database Service - SQLite operations
 */

import Database from 'better-sqlite3';
import path from 'path';
import { ServerConfig, Product, PaymentSession, UserWallet, Subscription } from '../types';

let db: Database.Database;

export function initDatabase(dbPath?: string): void {
  const resolvedPath = dbPath || process.env.DATABASE_PATH || './data/bot.db';
  
  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  require('fs').mkdirSync(dir, { recursive: true });
  
  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  
  runMigrations();
}

function runMigrations(): void {
  // Migration: Add missing columns to existing tables
  try {
    // Check if evm_wallet column exists, if not add it
    const serverCols = db.prepare("PRAGMA table_info(servers)").all() as any[];
    const hasEvmWallet = serverCols.some(c => c.name === 'evm_wallet');
    
    if (!hasEvmWallet && serverCols.length > 0) {
      // Table exists but missing new columns - migrate
      db.exec(`
        ALTER TABLE servers ADD COLUMN evm_wallet TEXT;
        ALTER TABLE servers ADD COLUMN solana_wallet TEXT;
      `);
      // Copy wallet_address to evm_wallet if it exists
      const hasWalletAddress = serverCols.some(c => c.name === 'wallet_address');
      if (hasWalletAddress) {
        db.exec(`UPDATE servers SET evm_wallet = wallet_address WHERE wallet_address IS NOT NULL`);
      }
    }
    
    // Check if chains column exists in products
    const productCols = db.prepare("PRAGMA table_info(products)").all() as any[];
    const hasChains = productCols.some(c => c.name === 'chains');
    if (!hasChains && productCols.length > 0) {
      db.exec(`ALTER TABLE products ADD COLUMN chains TEXT`);
    }
    
    // Migration: Add billing columns to products
    const hasBillingType = productCols.some(c => c.name === 'billing_type');
    if (!hasBillingType && productCols.length > 0) {
      db.exec(`
        ALTER TABLE products ADD COLUMN billing_type TEXT DEFAULT 'one_time';
        ALTER TABLE products ADD COLUMN billing_period TEXT;
      `);
    }
    
    // Migration: Add fiat_markup to servers
    const hasFiatMarkup = serverCols.some(c => c.name === 'fiat_markup');
    if (!hasFiatMarkup && serverCols.length > 0) {
      db.exec(`ALTER TABLE servers ADD COLUMN fiat_markup REAL DEFAULT 0.05`);
    }
    
    // Migration: Add payment_method to payments
    const paymentCols = db.prepare("PRAGMA table_info(payments)").all() as any[];
    const hasPaymentMethod = paymentCols.some(c => c.name === 'payment_method');
    if (!hasPaymentMethod && paymentCols.length > 0) {
      db.exec(`ALTER TABLE payments ADD COLUMN payment_method TEXT DEFAULT 'usdc'`);
    }
  } catch (e) {
    // Tables don't exist yet, will be created below
  }

  // Create tables
  db.exec(`
    -- Server configurations
    CREATE TABLE IF NOT EXISTS servers (
      server_id TEXT PRIMARY KEY,
      evm_wallet TEXT,
      solana_wallet TEXT,
      default_chain TEXT DEFAULT 'base',
      fiat_markup REAL DEFAULT 0.05,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Products
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'USDC',
      chain TEXT DEFAULT 'base',
      chains TEXT,
      discord_role_id TEXT,
      service_endpoint TEXT,
      file_url TEXT,
      webhook_url TEXT,
      billing_type TEXT DEFAULT 'one_time',
      billing_period TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(server_id)
    );

    -- Subscriptions
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      current_period_start TEXT NOT NULL,
      current_period_end TEXT NOT NULL,
      last_payment_id TEXT,
      reminder_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      cancelled_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (last_payment_id) REFERENCES payments(payment_id)
    );

    -- Payment sessions
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      discord_server_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      chain TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      tx_hash TEXT,
      payment_method TEXT DEFAULT 'usdc',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      paid_at TEXT,
      fulfilled_at TEXT,
      webhook_processed INTEGER DEFAULT 0,
      fulfillment_attempts INTEGER DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    -- User wallets (for bot-managed wallets - Phase 4)
    CREATE TABLE IF NOT EXISTS wallets (
      discord_id TEXT PRIMARY KEY,
      encrypted_private_key TEXT NOT NULL,
      address TEXT NOT NULL,
      chain TEXT DEFAULT 'base',
      default_chain TEXT DEFAULT 'base',
      max_per_tx REAL DEFAULT 10,
      max_per_day REAL DEFAULT 100,
      notifications_enabled INTEGER DEFAULT 1,
      spent_today REAL DEFAULT 0,
      last_reset_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(discord_user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_server ON payments(discord_server_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_products_server ON products(server_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_server ON subscriptions(server_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_end ON subscriptions(current_period_end);
  `);
}

// === Server Operations ===

export function getServer(serverId: string): ServerConfig | null {
  const row = db.prepare('SELECT * FROM servers WHERE server_id = ?').get(serverId) as any;
  if (!row) return null;
  return {
    serverId: row.server_id,
    evmWallet: row.evm_wallet,
    solanaWallet: row.solana_wallet,
    defaultChain: row.default_chain,
    fiatMarkup: row.fiat_markup ?? 0.05,
    createdAt: new Date(row.created_at)
  };
}

export function setServerFiatMarkup(serverId: string, markup: number): void {
  db.prepare('UPDATE servers SET fiat_markup = ? WHERE server_id = ?').run(markup, serverId);
}

export function upsertServerWallet(serverId: string, walletType: 'evm' | 'solana', walletAddress: string): void {
  const column = walletType === 'evm' ? 'evm_wallet' : 'solana_wallet';
  
  // Check if server exists
  const existing = db.prepare('SELECT server_id FROM servers WHERE server_id = ?').get(serverId);
  
  if (existing) {
    db.prepare(`UPDATE servers SET ${column} = ? WHERE server_id = ?`).run(walletAddress, serverId);
  } else {
    if (walletType === 'evm') {
      db.prepare('INSERT INTO servers (server_id, evm_wallet) VALUES (?, ?)').run(serverId, walletAddress);
    } else {
      db.prepare('INSERT INTO servers (server_id, solana_wallet) VALUES (?, ?)').run(serverId, walletAddress);
    }
  }
}

export function setServerDefaultChain(serverId: string, chain: string): void {
  db.prepare('UPDATE servers SET default_chain = ? WHERE server_id = ?').run(chain, serverId);
}

// Helper to get wallet for a specific chain
export function getServerWalletForChain(serverId: string, chain: string): string | null {
  const server = getServer(serverId);
  if (!server) return null;
  
  if (chain === 'solana' || chain === 'solana_devnet') {
    return server.solanaWallet;
  }
  // All other chains are EVM
  return server.evmWallet;
}

// Get available chains from a list (only those with configured wallets)
export function getAvailableChainsForServer(serverId: string, requestedChains: string[]): string[] {
  const server = getServer(serverId);
  if (!server) return [];
  
  return requestedChains.filter(chain => {
    if (chain === 'solana' || chain === 'solana_devnet') {
      return !!server.solanaWallet;
    }
    // All EVM chains share the same wallet
    return !!server.evmWallet;
  });
}

// === Product Operations ===

export function createProduct(product: Omit<Product, 'createdAt'>): void {
  const chainsJson = JSON.stringify(product.chains);
  db.prepare(`
    INSERT INTO products (id, server_id, name, type, price, currency, chains, discord_role_id, service_endpoint, file_url, webhook_url, billing_type, billing_period, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.id,
    product.serverId,
    product.name,
    product.type,
    product.price,
    product.currency,
    chainsJson,
    product.discordRoleId || null,
    product.serviceEndpoint || null,
    product.fileUrl || null,
    product.webhookUrl || null,
    product.billingType || 'one_time',
    product.billingPeriod || null,
    product.active ? 1 : 0
  );
}

export function getProduct(productId: string): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
  if (!row) return null;
  return mapProduct(row);
}

export function getProductByName(serverId: string, name: string): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE server_id = ? AND LOWER(name) = LOWER(?)').get(serverId, name) as any;
  if (!row) return null;
  return mapProduct(row);
}

export function getServerProducts(serverId: string, activeOnly = true): Product[] {
  const query = activeOnly
    ? 'SELECT * FROM products WHERE server_id = ? AND active = 1'
    : 'SELECT * FROM products WHERE server_id = ?';
  const rows = db.prepare(query).all(serverId) as any[];
  return rows.map(mapProduct);
}

export function updateProduct(productId: string, updates: Partial<Product>): void {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.price !== undefined) { fields.push('price = ?'); values.push(updates.price); }
  if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }
  if (updates.discordRoleId !== undefined) { fields.push('discord_role_id = ?'); values.push(updates.discordRoleId); }
  if (updates.chains !== undefined) { fields.push('chains = ?'); values.push(JSON.stringify(updates.chains)); }
  if (updates.billingType !== undefined) { fields.push('billing_type = ?'); values.push(updates.billingType); }
  if (updates.billingPeriod !== undefined) { fields.push('billing_period = ?'); values.push(updates.billingPeriod); }
  
  if (fields.length === 0) return;
  
  values.push(productId);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteProduct(productId: string): void {
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
}

function mapProduct(row: any): Product {
  // Parse chains JSON, fallback to legacy chain field for old products
  let chains: string[];
  if (row.chains) {
    chains = JSON.parse(row.chains);
  } else if (row.chain) {
    chains = [row.chain];
  } else {
    chains = ['base'];
  }
  
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    type: row.type,
    price: row.price,
    currency: row.currency,
    chains,
    discordRoleId: row.discord_role_id,
    serviceEndpoint: row.service_endpoint,
    fileUrl: row.file_url,
    webhookUrl: row.webhook_url,
    billingType: row.billing_type || 'one_time',
    billingPeriod: row.billing_period || undefined,
    active: row.active === 1,
    createdAt: new Date(row.created_at)
  };
}

// === Payment Operations ===

export function createPayment(payment: Omit<PaymentSession, 'webhookProcessed' | 'fulfillmentAttempts'>): void {
  db.prepare(`
    INSERT INTO payments (payment_id, discord_user_id, discord_server_id, product_id, amount, currency, chain, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payment.paymentId,
    payment.discordUserId,
    payment.discordServerId,
    payment.productId,
    payment.amount,
    payment.currency,
    payment.chain,
    payment.status,
    payment.expiresAt.toISOString()
  );
}

export function getPayment(paymentId: string): PaymentSession | null {
  const row = db.prepare('SELECT * FROM payments WHERE payment_id = ?').get(paymentId) as any;
  if (!row) return null;
  return mapPayment(row);
}

export function updatePayment(paymentId: string, updates: Partial<PaymentSession>): void {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.txHash !== undefined) { fields.push('tx_hash = ?'); values.push(updates.txHash); }
  if (updates.paidAt !== undefined) { fields.push('paid_at = ?'); values.push(updates.paidAt.toISOString()); }
  if (updates.fulfilledAt !== undefined) { fields.push('fulfilled_at = ?'); values.push(updates.fulfilledAt.toISOString()); }
  if (updates.webhookProcessed !== undefined) { fields.push('webhook_processed = ?'); values.push(updates.webhookProcessed ? 1 : 0); }
  if (updates.fulfillmentAttempts !== undefined) { fields.push('fulfillment_attempts = ?'); values.push(updates.fulfillmentAttempts); }
  
  if (fields.length === 0) return;
  
  values.push(paymentId);
  db.prepare(`UPDATE payments SET ${fields.join(', ')} WHERE payment_id = ?`).run(...values);
}

export function getServerSales(serverId: string, limit = 10): PaymentSession[] {
  const rows = db.prepare(`
    SELECT * FROM payments 
    WHERE discord_server_id = ? AND status IN ('paid', 'fulfilled')
    ORDER BY created_at DESC
    LIMIT ?
  `).all(serverId, limit) as any[];
  return rows.map(mapPayment);
}

function mapPayment(row: any): PaymentSession {
  return {
    paymentId: row.payment_id,
    discordUserId: row.discord_user_id,
    discordServerId: row.discord_server_id,
    productId: row.product_id,
    amount: row.amount,
    currency: row.currency,
    chain: row.chain,
    status: row.status,
    txHash: row.tx_hash,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    paidAt: row.paid_at ? new Date(row.paid_at) : undefined,
    fulfilledAt: row.fulfilled_at ? new Date(row.fulfilled_at) : undefined,
    webhookProcessed: row.webhook_processed === 1,
    fulfillmentAttempts: row.fulfillment_attempts
  };
}

// === Wallet Operations (Phase 4) ===

export function createWallet(wallet: Omit<UserWallet, 'spentToday' | 'lastResetDate' | 'createdAt'>): void {
  db.prepare(`
    INSERT INTO wallets (discord_id, encrypted_private_key, address, chain, default_chain, max_per_tx, max_per_day, notifications_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wallet.discordId,
    wallet.encryptedPrivateKey,
    wallet.address,
    wallet.chain,
    wallet.defaultChain,
    wallet.maxPerTx,
    wallet.maxPerDay,
    wallet.notificationsEnabled ? 1 : 0
  );
}

export function getWallet(discordId: string): UserWallet | null {
  const row = db.prepare('SELECT * FROM wallets WHERE discord_id = ?').get(discordId) as any;
  if (!row) return null;
  return {
    discordId: row.discord_id,
    encryptedPrivateKey: row.encrypted_private_key,
    address: row.address,
    chain: row.chain,
    defaultChain: row.default_chain,
    maxPerTx: row.max_per_tx,
    maxPerDay: row.max_per_day,
    notificationsEnabled: row.notifications_enabled === 1,
    spentToday: row.spent_today,
    lastResetDate: row.last_reset_date,
    createdAt: new Date(row.created_at)
  };
}

// === Subscription Operations ===

export function createSubscription(subscription: Omit<Subscription, 'createdAt'>): void {
  db.prepare(`
    INSERT INTO subscriptions (id, user_id, product_id, server_id, status, current_period_start, current_period_end, last_payment_id, reminder_sent, cancelled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    subscription.id,
    subscription.userId,
    subscription.productId,
    subscription.serverId,
    subscription.status,
    subscription.currentPeriodStart.toISOString(),
    subscription.currentPeriodEnd.toISOString(),
    subscription.lastPaymentId || null,
    subscription.reminderSent ? 1 : 0,
    subscription.cancelledAt?.toISOString() || null
  );
}

export function getSubscription(subscriptionId: string): Subscription | null {
  const row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as any;
  if (!row) return null;
  return mapSubscription(row);
}

export function getUserSubscription(userId: string, productId: string): Subscription | null {
  const row = db.prepare(`
    SELECT * FROM subscriptions 
    WHERE user_id = ? AND product_id = ? 
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, productId) as any;
  if (!row) return null;
  return mapSubscription(row);
}

export function getUserSubscriptions(userId: string, serverId?: string): Subscription[] {
  let query = 'SELECT * FROM subscriptions WHERE user_id = ?';
  const params: any[] = [userId];
  
  if (serverId) {
    query += ' AND server_id = ?';
    params.push(serverId);
  }
  
  query += ' ORDER BY created_at DESC';
  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(mapSubscription);
}

export function getServerSubscriptions(serverId: string, status?: string): Subscription[] {
  let query = 'SELECT * FROM subscriptions WHERE server_id = ?';
  const params: any[] = [serverId];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY current_period_end ASC';
  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(mapSubscription);
}

export function getExpiringSubscriptions(withinDays: number): Subscription[] {
  const now = new Date();
  const futureDate = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  
  const rows = db.prepare(`
    SELECT * FROM subscriptions 
    WHERE status = 'active' 
      AND current_period_end <= ?
      AND current_period_end > ?
    ORDER BY current_period_end ASC
  `).all(futureDate.toISOString(), now.toISOString()) as any[];
  return rows.map(mapSubscription);
}

export function getExpiredSubscriptions(): Subscription[] {
  const now = new Date();
  
  const rows = db.prepare(`
    SELECT * FROM subscriptions 
    WHERE status = 'active' 
      AND current_period_end < ?
    ORDER BY current_period_end ASC
  `).all(now.toISOString()) as any[];
  return rows.map(mapSubscription);
}

export function updateSubscription(subscriptionId: string, updates: Partial<Subscription>): void {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.currentPeriodStart !== undefined) { fields.push('current_period_start = ?'); values.push(updates.currentPeriodStart.toISOString()); }
  if (updates.currentPeriodEnd !== undefined) { fields.push('current_period_end = ?'); values.push(updates.currentPeriodEnd.toISOString()); }
  if (updates.lastPaymentId !== undefined) { fields.push('last_payment_id = ?'); values.push(updates.lastPaymentId); }
  if (updates.reminderSent !== undefined) { fields.push('reminder_sent = ?'); values.push(updates.reminderSent ? 1 : 0); }
  if (updates.cancelledAt !== undefined) { fields.push('cancelled_at = ?'); values.push(updates.cancelledAt.toISOString()); }
  
  if (fields.length === 0) return;
  
  values.push(subscriptionId);
  db.prepare(`UPDATE subscriptions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getSubscriptionsNeedingReminder(daysBeforeExpiry: number): Subscription[] {
  const now = new Date();
  const futureDate = new Date(now.getTime() + daysBeforeExpiry * 24 * 60 * 60 * 1000);
  
  const rows = db.prepare(`
    SELECT * FROM subscriptions 
    WHERE status = 'active' 
      AND current_period_end <= ?
      AND current_period_end > ?
      AND reminder_sent = 0
    ORDER BY current_period_end ASC
  `).all(futureDate.toISOString(), now.toISOString()) as any[];
  return rows.map(mapSubscription);
}

function mapSubscription(row: any): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    serverId: row.server_id,
    status: row.status,
    currentPeriodStart: new Date(row.current_period_start),
    currentPeriodEnd: new Date(row.current_period_end),
    lastPaymentId: row.last_payment_id,
    reminderSent: row.reminder_sent === 1,
    createdAt: new Date(row.created_at),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined
  };
}

export function getDb(): Database.Database {
  return db;
}

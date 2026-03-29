/**
 * Subscription Service - Business logic for subscriptions
 */

import { Client, GuildMember, TextChannel } from 'discord.js';
import { 
  getProduct,
  createSubscription,
  getSubscription,
  getUserSubscription,
  updateSubscription,
  getExpiredSubscriptions,
  getSubscriptionsNeedingReminder,
  getExpiringSubscriptions
} from './database';
import { Subscription, Product } from '../types';
import { generateId } from '../utils/crypto';

// Grace period in days before role is removed after expiration
const GRACE_PERIOD_DAYS = 3;
// Days before expiry to send reminder
const REMINDER_DAYS = 3;

/**
 * Create or renew a subscription after payment
 */
export function handleSubscriptionPayment(
  userId: string,
  productId: string,
  serverId: string,
  paymentId: string
): Subscription {
  const product = getProduct(productId);
  if (!product || product.billingType !== 'subscription') {
    throw new Error('Product is not a subscription');
  }
  
  const existingSub = getUserSubscription(userId, productId);
  const now = new Date();
  
  // Calculate period duration
  const periodMs = product.billingPeriod === 'yearly' 
    ? 365 * 24 * 60 * 60 * 1000 
    : 30 * 24 * 60 * 60 * 1000;
  
  if (existingSub && (existingSub.status === 'active' || existingSub.status === 'cancelled')) {
    // Renewal - extend from current end date (time stacking)
    const startDate = existingSub.currentPeriodEnd > now 
      ? existingSub.currentPeriodEnd 
      : now;
    const endDate = new Date(startDate.getTime() + periodMs);
    
    updateSubscription(existingSub.id, {
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: endDate,
      lastPaymentId: paymentId,
      reminderSent: false
    });
    
    return { ...existingSub, status: 'active', currentPeriodEnd: endDate };
  } else {
    // New subscription
    const endDate = new Date(now.getTime() + periodMs);
    const subscription: Omit<Subscription, 'createdAt'> = {
      id: generateId(),
      userId,
      productId,
      serverId,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: endDate,
      lastPaymentId: paymentId,
      reminderSent: false
    };
    
    createSubscription(subscription);
    return { ...subscription, createdAt: now };
  }
}

/**
 * Cancel a subscription (will expire at period end)
 */
export function cancelSubscription(subscriptionId: string): void {
  updateSubscription(subscriptionId, {
    status: 'cancelled',
    cancelledAt: new Date()
  });
}

/**
 * Extend a subscription by N days (admin action)
 */
export function extendSubscription(subscriptionId: string, days: number): Date {
  const sub = getSubscription(subscriptionId);
  if (!sub) throw new Error('Subscription not found');
  
  const now = new Date();
  const currentEnd = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);
  
  updateSubscription(subscriptionId, {
    currentPeriodEnd: newEnd,
    status: 'active',
    reminderSent: false
  });
  
  return newEnd;
}

/**
 * Process expired subscriptions - remove roles
 * Returns array of processed subscriptions with user info
 */
export async function processExpiredSubscriptions(client: Client): Promise<{
  expired: Array<{ subscription: Subscription; product: Product; removed: boolean; error?: string }>;
  reminders: Array<{ subscription: Subscription; product: Product; sent: boolean; error?: string }>;
}> {
  const results = {
    expired: [] as Array<{ subscription: Subscription; product: Product; removed: boolean; error?: string }>,
    reminders: [] as Array<{ subscription: Subscription; product: Product; sent: boolean; error?: string }>
  };
  
  // Process expired subscriptions (past grace period)
  const expiredSubs = getExpiredSubscriptions();
  
  for (const sub of expiredSubs) {
    const product = getProduct(sub.productId);
    if (!product) continue;
    
    try {
      const guild = await client.guilds.fetch(sub.serverId);
      const member = await guild.members.fetch(sub.userId).catch(() => null);
      
      if (member && product.discordRoleId) {
        await member.roles.remove(product.discordRoleId);
        
        // Send DM
        try {
          await member.send({
            content: `⏰ Your **${product.name}** subscription in **${guild.name}** has expired.\n\nTo renew, go back to the server and use \`/renew ${product.name}\``
          });
        } catch (e) {
          // DM might be disabled
        }
      }
      
      // Mark as expired
      updateSubscription(sub.id, { status: 'expired' });
      results.expired.push({ subscription: sub, product, removed: true });
    } catch (error: any) {
      results.expired.push({ subscription: sub, product, removed: false, error: error.message });
    }
  }
  
  // Send reminders for soon-to-expire subscriptions
  const needReminder = getSubscriptionsNeedingReminder(REMINDER_DAYS);
  
  for (const sub of needReminder) {
    const product = getProduct(sub.productId);
    if (!product) continue;
    
    try {
      const guild = await client.guilds.fetch(sub.serverId);
      const member = await guild.members.fetch(sub.userId).catch(() => null);
      
      if (member) {
        const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        
        try {
          await member.send({
            content: `⚠️ Your **${product.name}** subscription in **${guild.name}** expires in **${daysLeft} day${daysLeft > 1 ? 's' : ''}**.\n\nTo continue access, use \`/renew ${product.name}\` in the server.`
          });
          
          updateSubscription(sub.id, { reminderSent: true });
          results.reminders.push({ subscription: sub, product, sent: true });
        } catch (e) {
          // DM disabled
          updateSubscription(sub.id, { reminderSent: true }); // Mark anyway to avoid spam
          results.reminders.push({ subscription: sub, product, sent: false, error: 'DM disabled' });
        }
      }
    } catch (error: any) {
      results.reminders.push({ subscription: sub, product, sent: false, error: error.message });
    }
  }
  
  return results;
}

/**
 * Format subscription for display
 */
export function formatSubscription(sub: Subscription, product: Product): string {
  const now = new Date();
  const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  
  const statusIcon = sub.status === 'active' ? '✅' : sub.status === 'cancelled' ? '⚠️' : '❌';
  const statusText = sub.status === 'active' 
    ? (daysLeft > 0 ? `expires in ${daysLeft} days` : 'expired')
    : sub.status === 'cancelled' 
      ? `cancelled, expires in ${daysLeft} days` 
      : 'expired';
  
  return `${statusIcon} **${product.name}** - ${statusText}`;
}

/**
 * Calculate period duration in milliseconds
 */
export function getPeriodMs(billingPeriod: 'monthly' | 'yearly'): number {
  return billingPeriod === 'yearly' 
    ? 365 * 24 * 60 * 60 * 1000 
    : 30 * 24 * 60 * 60 * 1000;
}

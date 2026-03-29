/**
 * Fulfillment service - handles order completion after payment
 */

import { Client, Guild, GuildMember } from 'discord.js';
import { Product, PaymentSession } from '../types';
import { updatePayment, getProduct } from './database';
import { handleSubscriptionPayment } from './subscription';

export interface FulfillmentResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Main fulfillment router - dispatches to type-specific handlers
 */
export async function fulfill(
  client: Client,
  payment: PaymentSession,
  product: Product
): Promise<FulfillmentResult> {
  try {
    switch (product.type) {
      case 'role':
      case 'channel':
        return await fulfillRole(client, payment, product);
      
      case 'digital':
        return await fulfillDigital(client, payment, product);
      
      case 'custom':
        return await fulfillCustomWebhook(payment, product);
      
      case 'service':
        return await fulfillService(payment, product);
      
      default:
        return { success: false, message: `Unknown product type: ${product.type}` };
    }
  } catch (error: any) {
    console.error(`Fulfillment error for payment ${payment.paymentId}:`, error);
    
    // Increment attempt counter
    updatePayment(payment.paymentId, {
      fulfillmentAttempts: payment.fulfillmentAttempts + 1
    });
    
    return { 
      success: false, 
      message: 'Fulfillment failed',
      error: error.message 
    };
  }
}

/**
 * Assign Discord role to user
 */
async function fulfillRole(
  client: Client,
  payment: PaymentSession,
  product: Product
): Promise<FulfillmentResult> {
  if (!product.discordRoleId) {
    return { success: false, message: 'Product has no role configured' };
  }
  
  // Fetch guild
  const guild = await client.guilds.fetch(payment.discordServerId);
  if (!guild) {
    return { success: false, message: 'Server not found' };
  }
  
  // Fetch member
  let member: GuildMember;
  try {
    member = await guild.members.fetch(payment.discordUserId);
  } catch (error) {
    return { success: false, message: 'User not found in server' };
  }
  
  // Handle subscription if applicable
  if (product.billingType === 'subscription') {
    try {
      const subscription = handleSubscriptionPayment(
        payment.discordUserId,
        product.id,
        payment.discordServerId,
        payment.paymentId
      );
      
      // Assign role (even if they already have it, subscription is renewed)
      if (!member.roles.cache.has(product.discordRoleId)) {
        try {
          await member.roles.add(product.discordRoleId, `MoltsPay subscription: ${product.name}`);
        } catch (error: any) {
          if (error.code === 50013) {
            return { success: false, message: 'Bot lacks permission to assign this role' };
          }
          throw error;
        }
      }
      
      // Mark fulfilled
      updatePayment(payment.paymentId, {
        status: 'fulfilled',
        fulfilledAt: new Date()
      });
      
      const periodLabel = product.billingPeriod === 'yearly' ? 'year' : 'month';
      return { 
        success: true, 
        message: `Subscription activated: ${product.name} (expires <t:${Math.floor(subscription.currentPeriodEnd.getTime() / 1000)}:R>)` 
      };
    } catch (error: any) {
      return { success: false, message: `Subscription error: ${error.message}` };
    }
  }
  
  // One-time purchase - check if already has role
  if (member.roles.cache.has(product.discordRoleId)) {
    return { success: true, message: 'User already has role' };
  }
  
  // Assign role
  try {
    await member.roles.add(product.discordRoleId, `MoltsPay purchase: ${product.name}`);
  } catch (error: any) {
    if (error.code === 50013) {
      return { success: false, message: 'Bot lacks permission to assign this role' };
    }
    throw error;
  }
  
  // Mark fulfilled
  updatePayment(payment.paymentId, {
    status: 'fulfilled',
    fulfilledAt: new Date()
  });
  
  return { success: true, message: `Assigned role: ${product.name}` };
}

/**
 * Send digital product via DM
 */
async function fulfillDigital(
  client: Client,
  payment: PaymentSession,
  product: Product
): Promise<FulfillmentResult> {
  if (!product.fileUrl) {
    return { success: false, message: 'Product has no file configured' };
  }
  
  // Fetch user
  const user = await client.users.fetch(payment.discordUserId);
  if (!user) {
    return { success: false, message: 'User not found' };
  }
  
  // Send DM
  try {
    await user.send({
      content: `🎁 **Your purchase: ${product.name}**\n\nHere's your digital product:`,
      files: [product.fileUrl]
    });
  } catch (error: any) {
    if (error.code === 50007) {
      return { success: false, message: 'Cannot DM user - they may have DMs disabled' };
    }
    throw error;
  }
  
  // Mark fulfilled
  updatePayment(payment.paymentId, {
    status: 'fulfilled',
    fulfilledAt: new Date()
  });
  
  return { success: true, message: 'Digital product delivered via DM' };
}

/**
 * Call custom webhook for external fulfillment
 */
async function fulfillCustomWebhook(
  payment: PaymentSession,
  product: Product
): Promise<FulfillmentResult> {
  if (!product.webhookUrl) {
    return { success: false, message: 'Product has no webhook configured' };
  }
  
  const response = await fetch(product.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_id: payment.paymentId,
      user_id: payment.discordUserId,
      server_id: payment.discordServerId,
      product_id: product.id,
      product_name: product.name,
      amount: payment.amount,
      currency: payment.currency,
      chain: payment.chain,
      tx_hash: payment.txHash
    })
  });
  
  if (!response.ok) {
    return { 
      success: false, 
      message: `Webhook returned ${response.status}`,
      error: await response.text()
    };
  }
  
  // Mark fulfilled
  updatePayment(payment.paymentId, {
    status: 'fulfilled',
    fulfilledAt: new Date()
  });
  
  return { success: true, message: 'Webhook delivered successfully' };
}

/**
 * Execute service API call
 */
async function fulfillService(
  payment: PaymentSession,
  product: Product
): Promise<FulfillmentResult> {
  if (!product.serviceEndpoint) {
    return { success: false, message: 'Product has no service endpoint configured' };
  }
  
  // TODO: Implement service execution
  // This would call an external API and return the result
  
  return { 
    success: false, 
    message: 'Service fulfillment not yet implemented' 
  };
}

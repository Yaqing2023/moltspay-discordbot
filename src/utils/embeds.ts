/**
 * Discord embed builders
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type APIEmbed } from 'discord.js';
import { Product, PaymentSession } from '../types';

export const COLORS = {
  PRIMARY: 0x5865F2,   // Discord blurple
  SUCCESS: 0x57F287,   // Green
  WARNING: 0xFEE75C,   // Yellow
  ERROR: 0xED4245,     // Red
  INFO: 0x3498DB,      // Blue
};

export function productEmbed(product: Product): EmbedBuilder {
  const chainsDisplay = product.chains.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ');
  return new EmbedBuilder()
    .setTitle(`🛒 ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .addFields(
      { name: 'Price', value: `$${product.price.toFixed(2)} ${product.currency}`, inline: true },
      { name: 'Chains', value: chainsDisplay, inline: true },
      { name: 'Type', value: product.type.charAt(0).toUpperCase() + product.type.slice(1), inline: true }
    )
    .setFooter({ text: 'MoltsPay • Secure crypto payments' });
}

export function buyButtons(productId: string, userBalance?: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  
  if (userBalance !== undefined) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`buy_bot_${productId}`)
        .setLabel(`💳 Bot Wallet ($${userBalance.toFixed(2)})`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`buy_external_${productId}`)
      .setLabel('🦊 External Wallet')
      .setStyle(ButtonStyle.Secondary)
  );
  
  return row;
}

export function paymentPendingEmbed(product: Product, paymentUrl: string, selectedChain?: string): EmbedBuilder {
  const chainDisplay = selectedChain || product.chains[0];
  return new EmbedBuilder()
    .setTitle('⏳ Payment Pending')
    .setColor(COLORS.WARNING)
    .setDescription(`Complete your payment to receive **${product.name}**`)
    .addFields(
      { name: 'Amount', value: `$${product.price.toFixed(2)} ${product.currency}`, inline: true },
      { name: 'Chain', value: chainDisplay.charAt(0).toUpperCase() + chainDisplay.slice(1), inline: true },
      { name: 'Expires', value: '15 minutes', inline: true }
    )
    .addFields({ name: 'Payment Link', value: paymentUrl })
    .setFooter({ text: 'Payment will be verified automatically' });
}

export function paymentSuccessEmbed(product: Product, txHash?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('✅ Purchase Complete!')
    .setColor(COLORS.SUCCESS)
    .setDescription(`You now have **${product.name}**!`)
    .addFields(
      { name: 'Amount Paid', value: `$${product.price.toFixed(2)} ${product.currency}`, inline: true }
    );
  
  if (txHash) {
    embed.addFields({ name: 'Transaction', value: `\`${txHash.slice(0, 10)}...${txHash.slice(-8)}\``, inline: true });
  }
  
  return embed;
}

export function paymentFailedEmbed(reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('❌ Payment Failed')
    .setColor(COLORS.ERROR)
    .setDescription(reason)
    .setFooter({ text: 'Please try again or contact support' });
}

export function insufficientBalanceEmbed(required: number, available: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('❌ Insufficient Balance')
    .setColor(COLORS.ERROR)
    .addFields(
      { name: 'Required', value: `$${required.toFixed(2)}`, inline: true },
      { name: 'Available', value: `$${available.toFixed(2)}`, inline: true }
    )
    .setFooter({ text: 'Use /fund to add more USDC' });
}

export function walletEmbed(address: string, balance: number, chain: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('💰 Your Wallet')
    .setColor(COLORS.INFO)
    .addFields(
      { name: 'Address', value: `\`${address}\``, inline: false },
      { name: 'Balance', value: `$${balance.toFixed(2)} USDC`, inline: true },
      { name: 'Chain', value: chain, inline: true }
    )
    .setFooter({ text: 'MoltsPay Wallet' });
}

export function productListEmbed(products: Product[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🛍️ Available Products')
    .setColor(COLORS.PRIMARY);
  
  if (products.length === 0) {
    embed.setDescription('No products available in this server.\nAdmins can create products with `/product create`');
  } else {
    const description = products.map((p, i) => {
      const chainsDisplay = p.chains.map(c => c.toUpperCase()).join('/');
      return `**${i + 1}. ${p.name}** - $${p.price.toFixed(2)} ${p.currency}\n   Type: ${p.type} | Chains: ${chainsDisplay}`;
    }).join('\n\n');
    embed.setDescription(description);
    embed.setFooter({ text: 'Use /buy <product> to purchase' });
  }
  
  return embed;
}

export function salesSummaryEmbed(
  serverName: string,
  todayTotal: number,
  weekTotal: number,
  monthTotal: number,
  recentSales: PaymentSession[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📊 Sales Summary - ${serverName}`)
    .setColor(COLORS.INFO)
    .addFields(
      { name: 'Today', value: `$${todayTotal.toFixed(2)}`, inline: true },
      { name: 'This Week', value: `$${weekTotal.toFixed(2)}`, inline: true },
      { name: 'This Month', value: `$${monthTotal.toFixed(2)}`, inline: true }
    );
  
  if (recentSales.length > 0) {
    const recentText = recentSales.slice(0, 5).map(s => 
      `• $${s.amount.toFixed(2)} - ${new Date(s.createdAt).toLocaleDateString()}`
    ).join('\n');
    embed.addFields({ name: 'Recent Sales', value: recentText });
  }
  
  return embed;
}

export function confirmButtons(confirmId: string, cancelId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel('✅ Confirm')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Danger)
    );
}

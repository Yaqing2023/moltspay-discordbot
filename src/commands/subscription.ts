/**
 * Subscription commands for users
 * /subscriptions - View your subscriptions
 * /renew - Renew a subscription
 * /cancel - Cancel a subscription
 */

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { 
  getUserSubscriptions,
  getUserSubscription,
  getProduct,
  getProductByName,
  getServerProducts
} from '../services/database';
import { cancelSubscription, formatSubscription } from '../services/subscription';
import { COLORS } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('subscriptions')
  .setDescription('View and manage your subscriptions');

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const subscriptions = getUserSubscriptions(userId, serverId);
  
  if (subscriptions.length === 0) {
    await interaction.reply({ 
      content: '📋 You have no subscriptions in this server.\n\nUse `/buy` to see available products.', 
      ephemeral: true 
    });
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle('📋 Your Subscriptions')
    .setColor(COLORS.PRIMARY)
    .setFooter({ text: 'MoltsPay • Server Monetization' });
  
  const descriptions: string[] = [];
  
  for (const sub of subscriptions) {
    const product = getProduct(sub.productId);
    if (!product) continue;
    
    const now = new Date();
    const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    
    let statusLine = '';
    if (sub.status === 'active') {
      if (daysLeft > 0) {
        statusLine = `✅ **${product.name}**\n   Status: Active\n   Expires: <t:${Math.floor(sub.currentPeriodEnd.getTime() / 1000)}:R>\n   Price: $${product.price.toFixed(2)}/${product.billingPeriod === 'yearly' ? 'year' : 'month'}`;
      } else {
        statusLine = `⚠️ **${product.name}**\n   Status: Expired (grace period)\n   Use \`/renew ${product.name}\` to continue`;
      }
    } else if (sub.status === 'cancelled') {
      statusLine = `⚠️ **${product.name}**\n   Status: Cancelled\n   Access until: <t:${Math.floor(sub.currentPeriodEnd.getTime() / 1000)}:R>\n   Use \`/renew ${product.name}\` to resubscribe`;
    } else {
      statusLine = `❌ **${product.name}**\n   Status: Expired\n   Use \`/renew ${product.name}\` to resubscribe`;
    }
    
    descriptions.push(statusLine);
  }
  
  embed.setDescription(descriptions.join('\n\n'));
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * /cancel - Cancel a subscription
 */

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { 
  getUserSubscription,
  getProduct,
  getProductByName
} from '../services/database';
import { cancelSubscription } from '../services/subscription';
import { COLORS } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('cancel')
  .setDescription('Cancel a subscription (you keep access until period end)')
  .addStringOption(option =>
    option
      .setName('product')
      .setDescription('Product name to cancel')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const productName = interaction.options.getString('product', true);
  
  // Find product
  const product = getProductByName(serverId, productName);
  if (!product) {
    await interaction.reply({ content: `❌ Product not found: **${productName}**`, ephemeral: true });
    return;
  }
  
  // Check existing subscription
  const existingSub = getUserSubscription(userId, product.id);
  if (!existingSub) {
    await interaction.reply({ 
      content: `❌ You don't have an active subscription to **${product.name}**.`, 
      ephemeral: true 
    });
    return;
  }
  
  if (existingSub.status === 'cancelled') {
    await interaction.reply({ 
      content: `⚠️ Your **${product.name}** subscription is already cancelled.\n\nYou'll keep access until <t:${Math.floor(existingSub.currentPeriodEnd.getTime() / 1000)}:F>.`, 
      ephemeral: true 
    });
    return;
  }
  
  if (existingSub.status === 'expired') {
    await interaction.reply({ 
      content: `❌ Your **${product.name}** subscription has already expired.\n\nUse \`/renew ${product.name}\` to resubscribe.`, 
      ephemeral: true 
    });
    return;
  }
  
  // Cancel the subscription
  cancelSubscription(existingSub.id);
  
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Subscription Cancelled')
    .setColor(COLORS.WARNING)
    .setDescription(`Your **${product.name}** subscription has been cancelled.`)
    .addFields(
      { name: 'Access Until', value: `<t:${Math.floor(existingSub.currentPeriodEnd.getTime() / 1000)}:F>`, inline: true },
      { name: 'Status', value: 'Cancelled', inline: true }
    )
    .addFields({
      name: 'Changed your mind?',
      value: `Use \`/renew ${product.name}\` anytime to resubscribe.`
    })
    .setFooter({ text: 'MoltsPay • Server Monetization' });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

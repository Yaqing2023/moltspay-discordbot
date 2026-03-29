/**
 * /renew - Renew a subscription
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
  getUserSubscription,
  getProduct,
  getProductByName,
  getServer,
  getServerWalletForChain,
  createPayment
} from '../services/database';
import { COLORS } from '../utils/embeds';
import { generateId } from '../utils/crypto';

export const data = new SlashCommandBuilder()
  .setName('renew')
  .setDescription('Renew a subscription')
  .addStringOption(option =>
    option
      .setName('product')
      .setDescription('Product name to renew')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('chain')
      .setDescription('Blockchain to pay on')
      .setRequired(false)
      .addChoices(
        { name: 'Base', value: 'base' },
        { name: 'Polygon', value: 'polygon' },
        { name: 'BNB Chain', value: 'bnb' },
        { name: 'Solana', value: 'solana' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const productName = interaction.options.getString('product', true);
  const chainChoice = interaction.options.getString('chain');
  
  // Find product
  const product = getProductByName(serverId, productName);
  if (!product) {
    await interaction.reply({ content: `❌ Product not found: **${productName}**`, ephemeral: true });
    return;
  }
  
  if (product.billingType !== 'subscription') {
    await interaction.reply({ content: `❌ **${product.name}** is not a subscription product.`, ephemeral: true });
    return;
  }
  
  // Check existing subscription
  const existingSub = getUserSubscription(userId, product.id);
  const isRenewal = !!existingSub;
  
  // Get server config
  const server = getServer(serverId);
  if (!server) {
    await interaction.reply({ content: '❌ Server not configured. Contact an admin.', ephemeral: true });
    return;
  }
  
  // Determine chain
  const chain = chainChoice || product.chains[0] || 'base';
  if (!product.chains.includes(chain)) {
    await interaction.reply({ 
      content: `❌ Chain **${chain}** is not available for this product.\n\nAvailable: ${product.chains.join(', ')}`, 
      ephemeral: true 
    });
    return;
  }
  
  // Get wallet for chain
  const wallet = getServerWalletForChain(serverId, chain);
  if (!wallet) {
    await interaction.reply({ 
      content: `❌ No wallet configured for **${chain}**. Contact an admin.`, 
      ephemeral: true 
    });
    return;
  }
  
  // Create payment session
  const paymentId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  
  createPayment({
    paymentId,
    discordUserId: userId,
    discordServerId: serverId,
    productId: product.id,
    amount: product.price,
    currency: product.currency,
    chain,
    status: 'pending',
    createdAt: new Date(),
    expiresAt
  });
  
  // Build payment embed
  const periodLabel = product.billingPeriod === 'yearly' ? 'year' : 'month';
  const actionLabel = isRenewal ? 'Renew' : 'Subscribe to';
  
  let timeInfo = '';
  if (existingSub && existingSub.currentPeriodEnd > new Date()) {
    const daysLeft = Math.ceil((existingSub.currentPeriodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    timeInfo = `\n\n📅 Your current period has **${daysLeft} days** remaining. Renewing will add another ${product.billingPeriod === 'yearly' ? '365' : '30'} days to your subscription.`;
  }
  
  const embed = new EmbedBuilder()
    .setTitle(`${isRenewal ? '🔄 Renew' : '🛒 Subscribe to'} ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .setDescription(`**$${product.price.toFixed(2)} USDC / ${periodLabel}**${timeInfo}`)
    .addFields(
      { name: 'Payment ID', value: `\`${paymentId}\``, inline: true },
      { name: 'Chain', value: chain.toUpperCase(), inline: true },
      { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true }
    )
    .addFields({
      name: '💳 Pay To',
      value: `\`${wallet}\`\n\nSend exactly **$${product.price.toFixed(2)} USDC** on **${chain.toUpperCase()}**`
    })
    .setFooter({ text: 'MoltsPay • Payment will be verified automatically' });
  
  // Payment link button
  const paymentUrl = `https://moltspay.com/pay?to=${wallet}&amount=${product.price}&chain=${chain}&ref=${paymentId}`;
  
  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setLabel('Pay with Wallet')
        .setURL(paymentUrl)
        .setStyle(ButtonStyle.Link)
    );
  
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

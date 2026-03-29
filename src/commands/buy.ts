/**
 * /buy - Purchase a product
 */

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import { 
  getServerProducts, 
  getProductByName,
  getServer,
  getServerWalletForChain
} from '../services/database';
import { createPaymentSession } from '../services/payment';
import { startPolling } from '../services/poller';
import { COLORS, productListEmbed } from '../utils/embeds';
import { getWalletLinks } from '../utils/deeplinks';
import type { Product } from '../types';

// Chain display names
const CHAIN_NAMES: Record<string, string> = {
  base: 'Base',
  polygon: 'Polygon',
  bnb: 'BNB Chain',
  solana: 'Solana'
};

// Chain emojis for buttons
const CHAIN_EMOJI: Record<string, string> = {
  base: '🔵',
  polygon: '🟣',
  bnb: '🟡',
  solana: '🟢'
};

export const data = new SlashCommandBuilder()
  .setName('buy')
  .setDescription('Purchase a product')
  .addStringOption(option =>
    option
      .setName('product')
      .setDescription('Product name to purchase')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const productName = interaction.options.getString('product');
  
  // If no product specified, list available products
  if (!productName) {
    const products = getServerProducts(serverId);
    const embed = productListEmbed(products);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  
  // Find the product
  const product = getProductByName(serverId, productName);
  if (!product) {
    const products = getServerProducts(serverId);
    const suggestions = products.map(p => p.name).join(', ') || 'None available';
    await interaction.reply({ 
      content: `❌ Product not found: **${productName}**\n\nAvailable products: ${suggestions}`, 
      ephemeral: true 
    });
    return;
  }
  
  // Check server is set up
  const server = getServer(serverId);
  if (!server) {
    await interaction.reply({ 
      content: '❌ This server has not set up payments yet.', 
      ephemeral: true 
    });
    return;
  }
  
  // Check if user already has the role (for role products)
  if (product.type === 'role' && product.discordRoleId) {
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    if (member?.roles.cache.has(product.discordRoleId)) {
      await interaction.reply({ 
        content: `✅ You already have the **${product.name}**!`, 
        ephemeral: true 
      });
      return;
    }
  }
  
  // If product has multiple chains, show chain selection first
  if (product.chains.length > 1) {
    await showChainSelection(interaction, product, serverId);
  } else {
    // Single chain - proceed directly to payment
    await showPaymentDetails(interaction, product, product.chains[0], serverId);
  }
}

async function showChainSelection(
  interaction: ChatInputCommandInteraction, 
  product: Product, 
  serverId: string
) {
  const embed = new EmbedBuilder()
    .setTitle(`🛒 ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .setDescription('Select which blockchain you want to pay on:')
    .addFields(
      { name: 'Price', value: `$${product.price.toFixed(2)} ${product.currency}`, inline: true }
    );
  
  if (product.type === 'role' && product.discordRoleId) {
    embed.addFields({ name: 'You will receive', value: `<@&${product.discordRoleId}>`, inline: true });
  }
  
  embed.setFooter({ text: 'Choose your preferred payment chain' });
  
  // Build chain selection buttons
  const row = new ActionRowBuilder<ButtonBuilder>();
  
  for (const chain of product.chains) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`chain_${chain}_${product.id}`)
        .setLabel(`${CHAIN_EMOJI[chain] || '⛓️'} ${CHAIN_NAMES[chain] || chain.toUpperCase()}`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  const response = await interaction.reply({ 
    embeds: [embed], 
    components: [row], 
    ephemeral: true 
  });
  
  // Wait for chain selection
  try {
    const buttonInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 120_000 // 2 minutes to select chain
    });
    
    const [_, selectedChain, productId] = buttonInteraction.customId.split('_');
    
    // Show payment details for selected chain
    await showPaymentDetailsFromButton(buttonInteraction, product, selectedChain, serverId);
    
  } catch (error) {
    // Timeout
    await interaction.editReply({
      content: '⏰ Chain selection timed out. Run `/buy` again to try.',
      embeds: [],
      components: []
    });
  }
}

async function showPaymentDetails(
  interaction: ChatInputCommandInteraction,
  product: Product,
  chain: string,
  serverId: string
) {
  const walletAddress = getServerWalletForChain(serverId, chain);
  if (!walletAddress) {
    await interaction.reply({ 
      content: `❌ No wallet configured for ${chain}. Please contact server admin.`, 
      ephemeral: true 
    });
    return;
  }
  
  // Create payment session
  const { paymentId, expiresAt } = createPaymentSession(
    interaction.user.id,
    serverId,
    product,
    chain
  );
  
  const embed = buildPaymentEmbed(product, chain, paymentId, expiresAt);
  const rows = buildWalletButtons(chain, walletAddress, product.price, paymentId);
  
  const response = await interaction.reply({ 
    embeds: [embed], 
    components: rows, 
    ephemeral: true 
  });
  
  // Start polling for payment (EVM chains only for now)
  if (['base', 'polygon', 'bnb'].includes(chain)) {
    startPolling(paymentId, chain, walletAddress, product.price);
  }
}

async function showPaymentDetailsFromButton(
  interaction: ButtonInteraction,
  product: Product,
  chain: string,
  serverId: string
) {
  const walletAddress = getServerWalletForChain(serverId, chain);
  if (!walletAddress) {
    await interaction.update({ 
      content: `❌ No wallet configured for ${chain}. Please contact server admin.`,
      embeds: [],
      components: []
    });
    return;
  }
  
  // Create payment session
  const { paymentId, expiresAt } = createPaymentSession(
    interaction.user.id,
    serverId,
    product,
    chain
  );
  
  const embed = buildPaymentEmbed(product, chain, paymentId, expiresAt);
  const rows = buildWalletButtons(chain, walletAddress, product.price, paymentId);
  
  await interaction.update({ 
    embeds: [embed], 
    components: rows
  });
  
  // Start polling for payment (EVM chains only for now)
  if (['base', 'polygon', 'bnb'].includes(chain)) {
    startPolling(paymentId, chain, walletAddress, product.price);
  }
}

function buildPaymentEmbed(
  product: Product,
  chain: string,
  paymentId: string,
  expiresAt: Date
): EmbedBuilder {
  const isEVM = ['base', 'polygon', 'bnb'].includes(chain);
  const description = isEVM
    ? '👆 Tap your wallet to pay. We\'ll detect your payment automatically!'
    : 'Tap your wallet to pay. Amount and address are pre-filled!';
  
  const embed = new EmbedBuilder()
    .setTitle(`🛒 ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .setDescription(description)
    .addFields(
      { name: 'Price', value: `$${product.price.toFixed(2)} ${product.currency}`, inline: true },
      { name: 'Chain', value: CHAIN_NAMES[chain] || chain.toUpperCase(), inline: true },
      { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true }
    );
  
  if (product.type === 'role' && product.discordRoleId) {
    embed.addFields({ name: 'You\'ll receive', value: `<@&${product.discordRoleId}>`, inline: false });
  }
  
  if (isEVM) {
    embed.addFields({ name: '⏳ Status', value: 'Waiting for payment...', inline: false });
  }
  
  embed.addFields({ 
    name: '💡 Tip', 
    value: `Mobile: amount auto-fills. Desktop: enter **$${product.price.toFixed(2)}** manually.`, 
    inline: false 
  });
  
  embed.setFooter({ text: `Payment ID: ${paymentId}` });
  
  return embed;
}

function buildWalletButtons(
  chain: string,
  walletAddress: string,
  amountUSDC: number,
  paymentId: string
): ActionRowBuilder<ButtonBuilder>[] {
  const walletLinks = getWalletLinks(chain, walletAddress, amountUSDC);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  
  // Mobile wallet buttons row
  const mobileRow = new ActionRowBuilder<ButtonBuilder>();
  for (const wallet of walletLinks) {
    mobileRow.addComponents(
      new ButtonBuilder()
        .setLabel(`📱 ${wallet.name}`)
        .setStyle(ButtonStyle.Link)
        .setURL(wallet.mobileUrl)
    );
  }
  rows.push(mobileRow);
  
  // Web wallet buttons row (only for wallets with web URLs)
  const walletsWithWeb = walletLinks.filter(w => w.webUrl);
  if (walletsWithWeb.length > 0) {
    const webRow = new ActionRowBuilder<ButtonBuilder>();
    for (const wallet of walletsWithWeb) {
      webRow.addComponents(
        new ButtonBuilder()
          .setLabel(`🌐 ${wallet.name}`)
          .setStyle(ButtonStyle.Link)
          .setURL(wallet.webUrl!)
      );
    }
    rows.push(webRow);
  }
  
  return rows;
}

// All buttons are Link buttons - no interaction handling needed

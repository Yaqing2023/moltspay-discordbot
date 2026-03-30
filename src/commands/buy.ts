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
import { buildOnrampUrl, calculateFiatPrice, isOnrampSupported } from '../utils/onramp';
import type { Product, ServerConfig } from '../types';

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
  const server = getServer(serverId);
  const walletAddress = getServerWalletForChain(serverId, chain);
  if (!walletAddress) {
    await interaction.reply({ 
      content: `❌ No wallet configured for ${chain}. Please contact server admin.`, 
      ephemeral: true 
    });
    return;
  }
  
  // Show payment method selection if onramp is supported
  if (server && isOnrampSupported(chain)) {
    await showPaymentMethodSelection(interaction, product, chain, serverId, server);
  } else {
    // Direct to USDC payment
    await showUsdcPayment(interaction, product, chain, serverId, walletAddress);
  }
}

async function showPaymentMethodSelection(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  product: Product,
  chain: string,
  serverId: string,
  server: ServerConfig
) {
  const fiatPrice = calculateFiatPrice(product.price, server.fiatMarkup);
  const markupPercent = Math.round(server.fiatMarkup * 100);
  
  const embed = new EmbedBuilder()
    .setTitle(`🛒 ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .setDescription('Choose your payment method:')
    .addFields(
      { name: 'Chain', value: CHAIN_NAMES[chain] || chain.toUpperCase(), inline: true }
    );
  
  if (product.type === 'role' && product.discordRoleId) {
    embed.addFields({ name: 'You\'ll receive', value: `<@&${product.discordRoleId}>`, inline: true });
  }
  
  embed.setFooter({ text: `Card payments include a ${markupPercent}% processing fee` });
  
  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`pay_usdc_${product.id}_${chain}`)
        .setLabel(`💎 Pay with USDC - $${product.price.toFixed(2)}`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`pay_fiat_${product.id}_${chain}`)
        .setLabel(`💳 Pay with Card - $${fiatPrice.toFixed(2)}`)
        .setStyle(ButtonStyle.Secondary)
    );
  
  const replyOptions = { embeds: [embed], components: [row], ephemeral: true };
  
  if ('replied' in interaction && interaction.replied) {
    await interaction.editReply(replyOptions);
  } else if ('update' in interaction) {
    await (interaction as ButtonInteraction).update(replyOptions);
  } else {
    const response = await (interaction as ChatInputCommandInteraction).reply(replyOptions);
    
    // Wait for payment method selection
    try {
      const buttonInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 120_000
      });
      
      await handlePaymentMethodSelection(buttonInteraction, product, chain, serverId, server);
    } catch (error) {
      await interaction.editReply({
        content: '⏰ Selection timed out. Run `/buy` again to try.',
        embeds: [],
        components: []
      });
    }
  }
}

async function handlePaymentMethodSelection(
  interaction: ButtonInteraction,
  product: Product,
  chain: string,
  serverId: string,
  server: ServerConfig
) {
  const walletAddress = getServerWalletForChain(serverId, chain);
  if (!walletAddress) {
    await interaction.update({ 
      content: `❌ No wallet configured for ${chain}.`,
      embeds: [],
      components: []
    });
    return;
  }
  
  const [_, method, productId, selectedChain] = interaction.customId.split('_');
  
  if (method === 'usdc') {
    await showUsdcPaymentFromButton(interaction, product, chain, serverId, walletAddress);
  } else if (method === 'fiat') {
    await showFiatPayment(interaction, product, chain, serverId, walletAddress, server);
  }
}

async function showUsdcPayment(
  interaction: ChatInputCommandInteraction,
  product: Product,
  chain: string,
  serverId: string,
  walletAddress: string
) {
  // Create payment session
  const { paymentId, expiresAt } = createPaymentSession(
    interaction.user.id,
    serverId,
    product,
    chain
  );
  
  const embed = buildPaymentEmbed(product, chain, paymentId, expiresAt);
  const rows = buildWalletButtons(chain, walletAddress, product.price, paymentId);
  
  await interaction.reply({ 
    embeds: [embed], 
    components: rows, 
    ephemeral: true 
  });
  
  // Start polling for payment (EVM chains only for now)
  if (['base', 'polygon', 'bnb'].includes(chain)) {
    startPolling(paymentId, chain, walletAddress, product.price);
  }
}

async function showUsdcPaymentFromButton(
  interaction: ButtonInteraction,
  product: Product,
  chain: string,
  serverId: string,
  walletAddress: string
) {
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

async function showFiatPayment(
  interaction: ButtonInteraction,
  product: Product,
  chain: string,
  serverId: string,
  walletAddress: string,
  server: ServerConfig
) {
  // Create payment session
  const { paymentId, expiresAt } = createPaymentSession(
    interaction.user.id,
    serverId,
    product,
    chain
  );
  
  const fiatPrice = calculateFiatPrice(product.price, server.fiatMarkup);
  const onrampUrl = buildOnrampUrl(walletAddress, fiatPrice, chain, paymentId);
  
  const embed = new EmbedBuilder()
    .setTitle(`💳 Pay with Card`)
    .setColor(COLORS.PRIMARY)
    .setDescription(`Complete your payment on Coinbase:\n\n**Amount:** $${fiatPrice.toFixed(2)} USD\n**You'll receive:** ${product.name}`)
    .addFields(
      { name: 'Chain', value: CHAIN_NAMES[chain] || chain.toUpperCase(), inline: true },
      { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true }
    )
    .addFields({
      name: '📝 Instructions',
      value: '1. Click the button below\n2. Complete payment on Coinbase\n3. Return here - we\'ll detect your payment automatically!'
    })
    .setFooter({ text: `Payment ID: ${paymentId}` });
  
  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setLabel('Complete Payment on Coinbase')
        .setEmoji('💳')
        .setStyle(ButtonStyle.Link)
        .setURL(onrampUrl)
    );
  
  await interaction.update({ 
    embeds: [embed], 
    components: [row]
  });
  
  // Start polling for payment
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
  const server = getServer(serverId);
  const walletAddress = getServerWalletForChain(serverId, chain);
  if (!walletAddress) {
    await interaction.update({ 
      content: `❌ No wallet configured for ${chain}. Please contact server admin.`,
      embeds: [],
      components: []
    });
    return;
  }
  
  // Show payment method selection if onramp is supported
  if (server && isOnrampSupported(chain)) {
    const fiatPrice = calculateFiatPrice(product.price, server.fiatMarkup);
    const markupPercent = Math.round(server.fiatMarkup * 100);
    
    const embed = new EmbedBuilder()
      .setTitle(`🛒 ${product.name}`)
      .setColor(COLORS.PRIMARY)
      .setDescription('Choose your payment method:')
      .addFields(
        { name: 'Chain', value: CHAIN_NAMES[chain] || chain.toUpperCase(), inline: true }
      );
    
    if (product.type === 'role' && product.discordRoleId) {
      embed.addFields({ name: 'You\'ll receive', value: `<@&${product.discordRoleId}>`, inline: true });
    }
    
    embed.setFooter({ text: `Card payments include a ${markupPercent}% processing fee` });
    
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`pay_usdc_${product.id}_${chain}`)
          .setLabel(`💎 Pay with USDC - $${product.price.toFixed(2)}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`pay_fiat_${product.id}_${chain}`)
          .setLabel(`💳 Pay with Card - $${fiatPrice.toFixed(2)}`)
          .setStyle(ButtonStyle.Secondary)
      );
    
    const response = await interaction.update({ embeds: [embed], components: [row] });
    
    // Wait for payment method selection
    try {
      const buttonInteraction = await interaction.message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 120_000
      });
      
      await handlePaymentMethodSelection(buttonInteraction as ButtonInteraction, product, chain, serverId, server);
    } catch (error) {
      await interaction.editReply({
        content: '⏰ Selection timed out. Run `/buy` again to try.',
        embeds: [],
        components: []
      });
    }
  } else {
    // Direct to USDC payment
    await showUsdcPaymentFromButton(interaction, product, chain, serverId, walletAddress);
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

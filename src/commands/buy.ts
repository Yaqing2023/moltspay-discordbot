/**
 * /buy - Purchase a product
 * 
 * Flow: Payment Method First
 * 1. /buy → Payment Method (USDC/Card)
 * 2. Card → Auto-select Base → Coinbase Onramp
 * 3. USDC → Chain selection → Wallet deep links
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
import { buildOnrampUrl, calculateFiatPrice, isOnrampSupported, getOnrampChains } from '../utils/onramp';
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
  
  // NEW FLOW: Payment method selection first
  await showPaymentMethodSelection(interaction, product, serverId, server);
}

/**
 * Step 1: Show payment method selection (USDC or Card)
 */
async function showPaymentMethodSelection(
  interaction: ChatInputCommandInteraction,
  product: Product,
  serverId: string,
  server: ServerConfig
) {
  // Check if card payments are available (any onramp-supported chain in product)
  const onrampChains = getOnrampChains(product.chains);
  const hasCardOption = onrampChains.length > 0 && server.fiatMarkup > 0;
  
  const fiatPrice = calculateFiatPrice(product.price, server.fiatMarkup);
  const markupPercent = Math.round(server.fiatMarkup * 100);
  
  const embed = new EmbedBuilder()
    .setTitle(`🛒 ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .setDescription('Choose your payment method:')
    .addFields(
      { name: 'Price', value: `$${product.price.toFixed(2)} USDC`, inline: true }
    );
  
  if (product.type === 'role' && product.discordRoleId) {
    embed.addFields({ name: 'You\'ll receive', value: `<@&${product.discordRoleId}>`, inline: true });
  }
  
  if (product.billingType === 'subscription') {
    embed.addFields({ name: 'Billing', value: `${product.billingPeriod}ly subscription`, inline: true });
  }
  
  const row = new ActionRowBuilder<ButtonBuilder>();
  
  // USDC button (always available)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`method_usdc_${product.id}`)
      .setLabel(`💎 Pay with USDC - $${product.price.toFixed(2)}`)
      .setStyle(ButtonStyle.Primary)
  );
  
  // Card button (only if onramp supported and markup > 0)
  if (hasCardOption) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`method_card_${product.id}`)
        .setLabel(`💳 Pay with Card - $${fiatPrice.toFixed(2)}`)
        .setStyle(ButtonStyle.Secondary)
    );
    embed.setFooter({ text: `Card payments include a ${markupPercent}% processing fee` });
  } else {
    embed.setFooter({ text: 'Pay with any crypto wallet' });
  }
  
  const response = await interaction.reply({ 
    embeds: [embed], 
    components: [row], 
    ephemeral: true 
  });
  
  // Wait for method selection
  try {
    const buttonInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 120_000
    });
    
    const [_, method, productId] = buttonInteraction.customId.split('_');
    
    if (method === 'usdc') {
      // USDC: Show chain selection
      await showChainSelection(buttonInteraction, product, serverId);
    } else if (method === 'card') {
      // Card: Auto-select best onramp chain and go to Coinbase
      await showCardPayment(buttonInteraction, product, serverId, server);
    }
    
  } catch (error) {
    await interaction.editReply({
      content: '⏰ Selection timed out. Run `/buy` again to try.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Step 2a (USDC path): Show chain selection
 */
async function showChainSelection(
  interaction: ButtonInteraction, 
  product: Product, 
  serverId: string
) {
  // If only one chain, skip selection
  if (product.chains.length === 1) {
    const chain = product.chains[0];
    const walletAddress = getServerWalletForChain(serverId, chain);
    if (!walletAddress) {
      await interaction.update({ 
        content: `❌ No wallet configured for ${chain}. Please contact server admin.`,
        embeds: [],
        components: []
      });
      return;
    }
    await showUsdcPayment(interaction, product, chain, serverId, walletAddress);
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle(`🛒 ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .setDescription('Select which blockchain you want to pay on:')
    .addFields(
      { name: 'Price', value: `$${product.price.toFixed(2)} USDC`, inline: true }
    );
  
  if (product.type === 'role' && product.discordRoleId) {
    embed.addFields({ name: 'You\'ll receive', value: `<@&${product.discordRoleId}>`, inline: true });
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
  
  await interaction.update({ 
    embeds: [embed], 
    components: [row]
  });
  
  // Wait for chain selection
  try {
    const buttonInteraction = await interaction.message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 120_000
    });
    
    const [_, selectedChain, productId] = buttonInteraction.customId.split('_');
    const walletAddress = getServerWalletForChain(serverId, selectedChain);
    
    if (!walletAddress) {
      await buttonInteraction.update({ 
        content: `❌ No wallet configured for ${selectedChain}. Please contact server admin.`,
        embeds: [],
        components: []
      });
      return;
    }
    
    await showUsdcPayment(buttonInteraction as ButtonInteraction, product, selectedChain, serverId, walletAddress);
    
  } catch (error) {
    await interaction.editReply({
      content: '⏰ Chain selection timed out. Run `/buy` again to try.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Step 2b (Card path): Show Coinbase Onramp
 */
async function showCardPayment(
  interaction: ButtonInteraction,
  product: Product,
  serverId: string,
  server: ServerConfig
) {
  // Auto-select best chain for onramp (prefer Base)
  const onrampChains = getOnrampChains(product.chains);
  const chain = onrampChains.includes('base') ? 'base' : onrampChains[0];
  
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

/**
 * Final step (USDC path): Show wallet deep links
 */
async function showUsdcPayment(
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

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
import { buildOnrampUrl, calculateFiatPrice, isOnrampSupported, getOnrampChains, hasOnrampCredentials } from '../utils/onramp';
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
  // Check if card payments are available
  // Requirements: onramp-supported chain + markup > 0 + minimum $5 (Coinbase requirement)
  const onrampChains = getOnrampChains(product.chains);
  const fiatPrice = calculateFiatPrice(product.price, server.fiatMarkup);
  const MINIMUM_FIAT_AMOUNT = 5;
  const hasCardOption = onrampChains.length > 0 && server.fiatMarkup > 0 && fiatPrice >= MINIMUM_FIAT_AMOUNT;
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
  
  await interaction.reply({ 
    embeds: [embed], 
    components: [row],
    ephemeral: true 
  });
  
  // Get the reply message for collector
  const message = await interaction.fetchReply();
  
  // Use collector for button handling
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120_000,
    max: 1
  });
  
  collector.on('collect', async (buttonInteraction) => {
    const [_, method] = buttonInteraction.customId.split('_');
    
    try {
      if (method === 'usdc') {
        await showChainSelection(buttonInteraction, product, serverId);
      } else if (method === 'card') {
        await showCardPayment(buttonInteraction, product, serverId, server);
      }
    } catch (error) {
      console.error('[Buy] Error handling button:', error);
    }
  });
  
  collector.on('end', async (collected, reason) => {
    if (reason === 'time' && collected.size === 0) {
      await interaction.editReply({
        content: '⏰ Selection timed out. Run `/buy` again to try.',
        embeds: [],
        components: []
      });
    }
  });
}

/**
 * Step 2a (USDC path): Show chain selection
 */
async function showChainSelection(
  interaction: ButtonInteraction, 
  product: Product, 
  serverId: string
) {
  // Acknowledge immediately to prevent Discord timeout
  await interaction.deferUpdate();
  
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
  
  const message = await interaction.editReply({ 
    embeds: [embed], 
    components: [row]
  });
  
  // Wait for chain selection
  try {
    const buttonInteraction = await message.awaitMessageComponent({
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
  // Defer immediately - CDP API call can take several seconds
  await interaction.deferUpdate();
  
  // Auto-select best chain for onramp (prefer Base)
  const onrampChains = getOnrampChains(product.chains);
  const chain = onrampChains.includes('base') ? 'base' : onrampChains[0];
  
  const walletAddress = getServerWalletForChain(serverId, chain);
  if (!walletAddress) {
    await interaction.editReply({ 
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
  
  // Get onramp URL (requires CDP API call - this is slow)
  let onrampUrl: string;
  try {
    onrampUrl = await buildOnrampUrl(walletAddress, fiatPrice, chain, paymentId);
  } catch (error) {
    console.error('Failed to generate onramp URL:', error);
    await interaction.editReply({
      content: `❌ Card payments are temporarily unavailable. Please use USDC instead.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
      embeds: [],
      components: []
    });
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle(`💳 Pay with Card`)
    .setColor(COLORS.PRIMARY)
    .setDescription(`Complete your payment on Coinbase using **Fiat** (credit/debit card):\n\n**Amount:** $${fiatPrice.toFixed(2)} USD\n**You'll receive:** ${product.name}`)
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
  
  await interaction.editReply({ 
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
  // Create payment session with unique amount
  const { paymentId, expiresAt, amount } = createPaymentSession(
    interaction.user.id,
    serverId,
    product,
    chain
  );
  
  const embed = buildPaymentEmbed(product, chain, paymentId, expiresAt, amount);
  const rows = buildWalletButtons(chain, walletAddress, amount, paymentId);
  
  await interaction.update({ 
    embeds: [embed], 
    components: rows
  });
  
  // Start polling for payment (EVM chains only for now)
  if (['base', 'polygon', 'bnb'].includes(chain)) {
    startPolling(paymentId, chain, walletAddress, amount);
  }
}

function buildPaymentEmbed(
  product: Product,
  chain: string,
  paymentId: string,
  expiresAt: Date,
  amount: number
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
      { name: 'Price', value: `$${amount.toFixed(6)} ${product.currency}`, inline: true },
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
    value: `Mobile: amount auto-fills. Desktop: enter **$${amount.toFixed(6)}** manually.`, 
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

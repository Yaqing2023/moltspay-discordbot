/**
 * /buy - Purchase a product
 * 
 * Flow: Payment Method First
 * 1. /buy → Payment Method (USDC/Card/Alipay)
 * 2. Card → Auto-select Base → Coinbase Onramp
 * 3. USDC → Chain selection → Wallet deep links
 * 4. Alipay → alipay-bot → Payment link → Poll status
 */

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  AttachmentBuilder
} from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import {
  getServerProducts,
  getProductByName,
  getServer,
  getServerWalletForChain,
  getPayment
} from '../services/database';
import { createPaymentSession } from '../services/payment';
import { createAlipayPayment, startAlipayPolling } from '../services/alipay';
import { fulfill } from '../services/fulfillment';
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
  
  // Payment method selection
  await showPaymentMethodSelection(interaction, product, serverId, server);
}

/**
 * Step 1: Show payment method selection (USDC / Card / Alipay)
 */
async function showPaymentMethodSelection(
  interaction: ChatInputCommandInteraction,
  product: Product,
  serverId: string,
  server: ServerConfig
) {
  // Check if card payments are available
  const onrampChains = getOnrampChains(product.chains);
  const fiatPrice = calculateFiatPrice(product.price, server.fiatMarkup);
  const MINIMUM_FIAT_AMOUNT = 5;
  const hasCardOption = onrampChains.length > 0 && server.fiatMarkup > 0 && fiatPrice >= MINIMUM_FIAT_AMOUNT;
  const hasAlipayOption = server.alipayEnabled && product.alipay;
  const markupPercent = Math.round(server.fiatMarkup * 100);
  
  const embed = new EmbedBuilder()
    .setTitle(`🛒 ${product.name}`)
    .setColor(COLORS.PRIMARY)
    .setDescription('Choose your payment method:')
    .addFields(
      { name: 'Price', value: `$${product.price.toFixed(2)} USDC${hasAlipayOption ? ` / ¥${product.alipay!.priceCny} CNY` : ''}`, inline: true }
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
      .setLabel(`💎 USDC - $${product.price.toFixed(2)}`)
      .setStyle(ButtonStyle.Primary)
  );
  
  // Card button (only if onramp supported and markup > 0)
  if (hasCardOption) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`method_card_${product.id}`)
        .setLabel(`💳 Card - $${fiatPrice.toFixed(2)}`)
        .setStyle(ButtonStyle.Secondary)
    );
  }

  // Alipay button (only if server has alipay enabled and product has alipay config)
  if (hasAlipayOption) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`method_alipay_${product.id}`)
        .setLabel(`🅰️ 支付宝 - ¥${product.alipay!.priceCny}`)
        .setStyle(ButtonStyle.Success)
    );
  }

  const footer = [];
  if (hasCardOption) footer.push(`Card: +${markupPercent}% fee`);
  if (hasAlipayOption) footer.push('Alipay: CNY via 支付宝AI收');
  embed.setFooter({ text: footer.join(' | ') || 'Pay with any crypto wallet' });
  
  await interaction.reply({ 
    embeds: [embed], 
    components: [row],
    ephemeral: true 
  });
  
  const message = await interaction.fetchReply();
  
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
      } else if (method === 'alipay') {
        await showAlipayPayment(buttonInteraction, product, serverId, server);
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
  await interaction.deferUpdate();
  
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
  await interaction.deferUpdate();
  
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
  
  const { paymentId, expiresAt } = createPaymentSession(
    interaction.user.id,
    serverId,
    product,
    chain
  );
  
  const fiatPrice = calculateFiatPrice(product.price, server.fiatMarkup);
  
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
  
  if (['base', 'polygon', 'bnb'].includes(chain)) {
    startPolling(paymentId, chain, walletAddress, product.price);
  }
}

/**
 * Step 2c (Alipay path): Generate payment link via alipay-bot
 */
async function showAlipayPayment(
  interaction: ButtonInteraction,
  product: Product,
  serverId: string,
  server: ServerConfig
) {
  await interaction.deferUpdate();

  if (!product.alipay || !server.alipayServiceEndpoint) {
    await interaction.editReply({
      content: '❌ Alipay payment is not configured for this product or server.',
      embeds: [],
      components: [],
    });
    return;
  }

  // Show "processing" message
  const processingEmbed = new EmbedBuilder()
    .setTitle(`🅰️ 支付宝支付`)
    .setColor(COLORS.PRIMARY)
    .setDescription('⏳ 正在生成支付链接，请稍候...')
    .setFooter({ text: 'Alipay AI 收' });

  await interaction.editReply({
    embeds: [processingEmbed],
    components: [],
  });

  try {
    const result = await createAlipayPayment(
      interaction.user.id,
      serverId,
      product,
      server.alipayServiceEndpoint,
      product.alipay.priceCny,
    );

    const embed = new EmbedBuilder()
      .setTitle(`🅰️ 支付宝支付 - ${product.name}`)
      .setColor(COLORS.PRIMARY)
      .setDescription(`请使用支付宝扫描下方二维码完成支付`)
      .addFields(
        { name: '金额', value: `¥${product.alipay.priceCny} CNY`, inline: true },
        { name: '商品', value: product.alipay.goodsName, inline: true },
        { name: '有效期', value: `<t:${Math.floor(result.expiresAt.getTime() / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: `Payment ID: ${result.paymentId} | TradeNo: ${result.tradeNo}` });

    // Attach qrcode image if available
    if (result.qrcodePath) {
      const qrAttachment = new AttachmentBuilder(result.qrcodePath, { name: 'qrcode.png' });
      embed.setImage('attachment://qrcode.png');
      embed.addFields({
        name: '📝 支付步骤',
        value: '1. 打开支付宝APP\n2. 扫描上方二维码\n3. 确认支付',
      });

      const replyOptions: any = {
        embeds: [embed],
        files: [qrAttachment],
        components: [],
      };

      // Add mobile button only if we have a valid payment URL
      if (result.shortenUrl || result.paymentUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setLabel('📱 手机打开支付宝')
              .setStyle(ButtonStyle.Link)
              .setURL(result.shortenUrl || result.paymentUrl!),
          );
        replyOptions.components = [row];
      }

      await interaction.editReply(replyOptions);
    } else {
      // No qrcode, fall back to link only
      embed.addFields({
        name: '📝 支付步骤',
        value: '1. 点击下方按钮打开支付页面\n2. 用支付宝扫码或确认支付\n3. 支付完成后自动检测',
      });

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setLabel('📱 手机打开支付宝')
            .setStyle(ButtonStyle.Link)
            .setURL(result.shortenUrl || result.paymentUrl!),
        );

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
    }

    // Start polling for alipay payment
    startAlipayPolling(
      result.paymentId,
      result.tradeNo,
      server.alipayServiceEndpoint,
      // onPaid callback
      async (paymentId: string, tradeNo: string) => {
        // Fulfill the order (assign role / deliver digital / webhook), same as
        // the EVM path. Without this an Alipay role purchase never grants the role.
        let fulfillMessage = '';
        try {
          const payment = getPayment(paymentId);
          if (payment) {
            const result = await fulfill(interaction.client, payment, product);
            console.log(`[Alipay] Fulfillment result for ${paymentId}:`, result);
            fulfillMessage = result.success
              ? ''
              : `\n⚠️ 履约失败：${result.message}。请联系管理员并提供 Payment ID: \`${paymentId}\``;
          }
        } catch (err) {
          console.error('[Alipay] Fulfillment failed:', err);
          fulfillMessage = `\n⚠️ 履约异常，请联系管理员并提供 Payment ID: \`${paymentId}\``;
        }

        try {
          const channel = interaction.channel;
          if (channel && channel.isSendable()) {
            await channel.send({
              content: `✅ <@${interaction.user.id}> 支付成功！交易号: \`${tradeNo}\`\n\n商品 **${product.name}** 已购买成功！${fulfillMessage}`,
            });
          }
        } catch (err) {
          console.error('[Alipay] Failed to send payment confirmation:', err);
        }
      },
      // onExpired callback
      async (paymentId: string) => {
        try {
          const channel = interaction.channel;
          if (channel && channel.isSendable()) {
            await channel.send({
              content: `⏰ <@${interaction.user.id}> 支付超时，支付已取消。请重新使用 \`/buy\` 发起支付。`,
            });
          }
        } catch (err) {
          console.error('[Alipay] Failed to send expiry notice:', err);
        }
      },
    );
  } catch (error) {
    console.error('[Alipay] Payment creation failed:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `❌ 支付宝支付创建失败：${errorMsg}`,
      embeds: [],
      components: [],
    });
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

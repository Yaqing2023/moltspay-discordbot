/**
 * /admin - Admin commands for testing and management
 */

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField
} from 'discord.js';
import { 
  getServer,
  getPayment,
  getServerProducts,
  getServerSales,
  getServerSubscriptions,
  getExpiringSubscriptions,
  getUserSubscriptions,
  getProduct,
  getSubscription,
  updateSubscription
} from '../services/database';
import { markPaymentPaid, markPaymentFulfilled } from '../services/payment';
import { fulfill } from '../services/fulfillment';
import { processExpiredSubscriptions, extendSubscription } from '../services/subscription';
import { COLORS } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin commands (Admin only)')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('confirm')
      .setDescription('Manually confirm a payment (for testing)')
      .addStringOption(option =>
        option
          .setName('payment_id')
          .setDescription('Payment ID to confirm')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('grant')
      .setDescription('Directly grant a product to a user (no payment)')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to grant product to')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('product')
          .setDescription('Product name to grant')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('sales')
      .setDescription('View sales summary')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('subs')
      .setDescription('List all active subscriptions')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('expirations')
      .setDescription('List subscriptions expiring soon')
      .addIntegerOption(option =>
        option
          .setName('days')
          .setDescription('Days to look ahead (default: 7)')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('sub')
      .setDescription('View a user\'s subscription status')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to check')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('extend')
      .setDescription('Extend a user\'s subscription')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to extend')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('product')
          .setDescription('Product name')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('days')
          .setDescription('Days to extend')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('expire-check')
      .setDescription('Manually run expiration check now')
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  
  switch (subcommand) {
    case 'confirm':
      await confirmPayment(interaction);
      break;
    case 'grant':
      await grantProduct(interaction);
      break;
    case 'sales':
      await showSales(interaction);
      break;
    case 'subs':
      await listSubscriptions(interaction);
      break;
    case 'expirations':
      await listExpirations(interaction);
      break;
    case 'sub':
      await showUserSub(interaction);
      break;
    case 'extend':
      await extendUserSub(interaction);
      break;
    case 'expire-check':
      await runExpireCheck(interaction);
      break;
  }
}

async function confirmPayment(interaction: ChatInputCommandInteraction) {
  const paymentId = interaction.options.getString('payment_id', true);
  
  // Get payment
  const payment = getPayment(paymentId);
  if (!payment) {
    await interaction.reply({ 
      content: `❌ Payment not found: \`${paymentId}\``, 
      ephemeral: true 
    });
    return;
  }
  
  if (payment.status === 'fulfilled') {
    await interaction.reply({ 
      content: `✅ Payment already fulfilled`, 
      ephemeral: true 
    });
    return;
  }
  
  // Mark as paid
  markPaymentPaid(paymentId, 'MANUAL_CONFIRM_' + Date.now());
  
  // Get product
  const product = getProduct(payment.productId);
  if (!product) {
    await interaction.reply({ 
      content: `❌ Product not found for payment`, 
      ephemeral: true 
    });
    return;
  }
  
  // Fulfill
  await interaction.deferReply({ ephemeral: true });
  
  const result = await fulfill(interaction.client, payment, product);
  
  if (result.success) {
    markPaymentFulfilled(paymentId);
    
    // Notify the user
    try {
      const user = await interaction.client.users.fetch(payment.discordUserId);
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Purchase Complete!')
            .setColor(COLORS.SUCCESS)
            .setDescription(`Your payment has been confirmed!\n\nYou now have **${product.name}**`)
            .addFields(
              { name: 'Amount', value: `$${payment.amount} ${payment.currency}`, inline: true }
            )
        ]
      });
    } catch (e) {
      // User may have DMs disabled
    }
    
    await interaction.editReply({
      content: `✅ Payment confirmed and fulfilled!\n\nUser: <@${payment.discordUserId}>\nProduct: ${product.name}`
    });
  } else {
    await interaction.editReply({
      content: `❌ Fulfillment failed: ${result.message}\n\nPayment marked as paid but not fulfilled. Please resolve manually.`
    });
  }
}

async function grantProduct(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('user', true);
  const productName = interaction.options.getString('product', true);
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ Server only command', ephemeral: true });
    return;
  }
  
  // Find product
  const products = getServerProducts(serverId);
  const product = products.find(p => 
    p.name.toLowerCase() === productName.toLowerCase() ||
    p.id === productName ||
    p.id.startsWith(productName)
  );
  
  if (!product) {
    await interaction.reply({ 
      content: `❌ Product not found: ${productName}`, 
      ephemeral: true 
    });
    return;
  }
  
  // Create a mock payment for tracking
  const mockPayment = {
    paymentId: 'GRANT_' + Date.now(),
    discordUserId: user.id,
    discordServerId: serverId,
    productId: product.id,
    amount: 0,
    currency: 'USDC',
    chain: 'base',
    status: 'paid' as const,
    createdAt: new Date(),
    expiresAt: new Date(),
    paidAt: new Date(),
    webhookProcessed: false,
    fulfillmentAttempts: 0
  };
  
  await interaction.deferReply({ ephemeral: true });
  
  const result = await fulfill(interaction.client, mockPayment, product);
  
  if (result.success) {
    await interaction.editReply({
      content: `✅ Granted **${product.name}** to ${user}\n\n${result.message}`
    });
  } else {
    await interaction.editReply({
      content: `❌ Failed to grant: ${result.message}`
    });
  }
}

async function showSales(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ Server only command', ephemeral: true });
    return;
  }
  
  const sales = getServerSales(serverId, 20);
  
  if (sales.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 Sales Summary')
          .setColor(COLORS.INFO)
          .setDescription('No sales yet!\n\nCreate products with `/product create` and share `/buy` with your community.')
      ],
      ephemeral: true
    });
    return;
  }
  
  // Calculate totals
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  let todayTotal = 0;
  let weekTotal = 0;
  let monthTotal = 0;
  
  for (const sale of sales) {
    const saleDate = new Date(sale.createdAt);
    if (saleDate >= todayStart) todayTotal += sale.amount;
    if (saleDate >= weekStart) weekTotal += sale.amount;
    if (saleDate >= monthStart) monthTotal += sale.amount;
  }
  
  const recentList = sales.slice(0, 10).map(s => {
    const date = new Date(s.createdAt).toLocaleDateString();
    const product = getProduct(s.productId);
    return `• $${s.amount.toFixed(2)} - ${product?.name || 'Unknown'} - ${date}`;
  }).join('\n');
  
  const embed = new EmbedBuilder()
    .setTitle('📊 Sales Summary')
    .setColor(COLORS.SUCCESS)
    .addFields(
      { name: 'Today', value: `$${todayTotal.toFixed(2)}`, inline: true },
      { name: 'This Week', value: `$${weekTotal.toFixed(2)}`, inline: true },
      { name: 'This Month', value: `$${monthTotal.toFixed(2)}`, inline: true }
    )
    .addFields({ name: 'Recent Sales', value: recentList || 'None' })
    .setFooter({ text: `Total transactions: ${sales.length}` });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// === Subscription Admin Commands ===

async function listSubscriptions(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ Server only command', ephemeral: true });
    return;
  }
  
  const subscriptions = getServerSubscriptions(serverId, 'active');
  
  if (subscriptions.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📋 Active Subscriptions')
          .setColor(COLORS.INFO)
          .setDescription('No active subscriptions in this server.')
      ],
      ephemeral: true
    });
    return;
  }
  
  const lines = subscriptions.slice(0, 20).map(sub => {
    const product = getProduct(sub.productId);
    const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return `<@${sub.userId}> - **${product?.name || 'Unknown'}** (expires in ${daysLeft}d)`;
  });
  
  const embed = new EmbedBuilder()
    .setTitle('📋 Active Subscriptions')
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Total: ${subscriptions.length} active subscription${subscriptions.length > 1 ? 's' : ''}` });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function listExpirations(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ Server only command', ephemeral: true });
    return;
  }
  
  const days = interaction.options.getInteger('days') || 7;
  const expiring = getExpiringSubscriptions(days);
  
  // Filter to this server
  const serverExpiring = expiring.filter(s => s.serverId === serverId);
  
  if (serverExpiring.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`⏰ Expiring Soon (next ${days} days)`)
          .setColor(COLORS.INFO)
          .setDescription('No subscriptions expiring soon.')
      ],
      ephemeral: true
    });
    return;
  }
  
  const lines = serverExpiring.map(sub => {
    const product = getProduct(sub.productId);
    const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return `<@${sub.userId}> - **${product?.name || 'Unknown'}** - expires in **${daysLeft} day${daysLeft > 1 ? 's' : ''}**`;
  });
  
  const embed = new EmbedBuilder()
    .setTitle(`⏰ Expiring Soon (next ${days} days)`)
    .setColor(COLORS.WARNING)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Total: ${serverExpiring.length} subscription${serverExpiring.length > 1 ? 's' : ''} expiring` });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showUserSub(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ Server only command', ephemeral: true });
    return;
  }
  
  const user = interaction.options.getUser('user', true);
  const subscriptions = getUserSubscriptions(user.id, serverId);
  
  if (subscriptions.length === 0) {
    await interaction.reply({
      content: `📋 <@${user.id}> has no subscriptions in this server.`,
      ephemeral: true
    });
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle(`👤 ${user.username}'s Subscriptions`)
    .setColor(COLORS.PRIMARY)
    .setThumbnail(user.displayAvatarURL());
  
  const descriptions: string[] = [];
  
  for (const sub of subscriptions) {
    const product = getProduct(sub.productId);
    if (!product) continue;
    
    const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    
    let statusLine = '';
    if (sub.status === 'active') {
      statusLine = `✅ **${product.name}**\n   Status: Active\n   Started: <t:${Math.floor(sub.currentPeriodStart.getTime() / 1000)}:D>\n   Expires: <t:${Math.floor(sub.currentPeriodEnd.getTime() / 1000)}:R>`;
    } else if (sub.status === 'cancelled') {
      statusLine = `⚠️ **${product.name}**\n   Status: Cancelled\n   Access until: <t:${Math.floor(sub.currentPeriodEnd.getTime() / 1000)}:R>`;
    } else {
      statusLine = `❌ **${product.name}**\n   Status: Expired\n   Expired: <t:${Math.floor(sub.currentPeriodEnd.getTime() / 1000)}:D>`;
    }
    
    descriptions.push(statusLine);
  }
  
  embed.setDescription(descriptions.join('\n\n'));
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function extendUserSub(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ Server only command', ephemeral: true });
    return;
  }
  
  const user = interaction.options.getUser('user', true);
  const productName = interaction.options.getString('product', true);
  const days = interaction.options.getInteger('days', true);
  
  // Find product
  const products = getServerProducts(serverId);
  const product = products.find(p => 
    p.name.toLowerCase() === productName.toLowerCase() ||
    p.id === productName
  );
  
  if (!product) {
    await interaction.reply({ content: `❌ Product not found: ${productName}`, ephemeral: true });
    return;
  }
  
  // Find subscription
  const subscriptions = getUserSubscriptions(user.id, serverId);
  const sub = subscriptions.find(s => s.productId === product.id);
  
  if (!sub) {
    await interaction.reply({ 
      content: `❌ <@${user.id}> doesn't have a subscription to **${product.name}**.`, 
      ephemeral: true 
    });
    return;
  }
  
  // Extend
  const newEnd = extendSubscription(sub.id, days);
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Subscription Extended')
    .setColor(COLORS.SUCCESS)
    .addFields(
      { name: 'User', value: `<@${user.id}>`, inline: true },
      { name: 'Product', value: product.name, inline: true },
      { name: 'Extended By', value: `${days} days`, inline: true },
      { name: 'New Expiration', value: `<t:${Math.floor(newEnd.getTime() / 1000)}:F>`, inline: false }
    );
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function runExpireCheck(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  
  const results = await processExpiredSubscriptions(interaction.client);
  
  const expiredCount = results.expired.length;
  const reminderCount = results.reminders.filter(r => r.sent).length;
  
  let description = '🔄 Expiration check complete.\n\n';
  
  if (expiredCount > 0) {
    description += `**Expired:** ${expiredCount} subscription${expiredCount > 1 ? 's' : ''}\n`;
    for (const { subscription, product, removed, error } of results.expired) {
      const status = removed ? '✅' : '❌';
      description += `${status} <@${subscription.userId}> - ${product.name}${error ? ` (${error})` : ''}\n`;
    }
  } else {
    description += '**Expired:** None\n';
  }
  
  description += '\n';
  
  if (results.reminders.length > 0) {
    description += `**Reminders sent:** ${reminderCount}\n`;
    for (const { subscription, product, sent, error } of results.reminders) {
      const status = sent ? '✅' : '⚠️';
      description += `${status} <@${subscription.userId}> - ${product.name}${error ? ` (${error})` : ''}\n`;
    }
  } else {
    description += '**Reminders sent:** None needed\n';
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🔄 Expiration Check Results')
    .setColor(expiredCount > 0 ? COLORS.WARNING : COLORS.SUCCESS)
    .setDescription(description);
  
  await interaction.editReply({ embeds: [embed] });
}

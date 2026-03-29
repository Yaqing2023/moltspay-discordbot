/**
 * /product - Product management commands (Admin only)
 */

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  Role,
  PermissionsBitField
} from 'discord.js';
import { 
  createProduct, 
  getServerProducts, 
  getProduct,
  getProductByName,
  updateProduct, 
  deleteProduct,
  getServer,
  getServerWalletForChain,
  getAvailableChainsForServer
} from '../services/database';
import { getWalletTypeForChain, formatWalletType } from '../utils/wallet';
import { generateId } from '../utils/crypto';
import { COLORS, productListEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('product')
  .setDescription('Manage products for sale (Admin only)')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new product')
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('Product name')
          .setRequired(true)
      )
      .addNumberOption(option =>
        option
          .setName('price')
          .setDescription('Price in USDC')
          .setRequired(true)
          .setMinValue(0.01)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to assign on purchase')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('chains')
          .setDescription('Supported chains, comma-separated (e.g. base,polygon,solana)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('billing')
          .setDescription('Billing type: one_time (default), monthly, or yearly')
          .setRequired(false)
          .addChoices(
            { name: 'One-time purchase', value: 'one_time' },
            { name: 'Monthly subscription', value: 'monthly' },
            { name: 'Yearly subscription', value: 'yearly' }
          )
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all products')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit a product')
      .addStringOption(option =>
        option
          .setName('product')
          .setDescription('Product name or ID')
          .setRequired(true)
      )
      .addNumberOption(option =>
        option
          .setName('price')
          .setDescription('New price in USDC')
      )
      .addBooleanOption(option =>
        option
          .setName('active')
          .setDescription('Enable or disable the product')
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete')
      .setDescription('Delete a product')
      .addStringOption(option =>
        option
          .setName('product')
          .setDescription('Product name or ID')
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  
  switch (subcommand) {
    case 'create':
      await createProductCmd(interaction);
      break;
    case 'list':
      await listProducts(interaction);
      break;
    case 'edit':
      await editProduct(interaction);
      break;
    case 'delete':
      await deleteProductCmd(interaction);
      break;
  }
}

// Valid chains list
const VALID_CHAINS = ['base', 'polygon', 'bnb', 'solana'];

async function createProductCmd(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  // Check server is set up
  const server = getServer(serverId);
  if (!server) {
    await interaction.reply({ 
      content: '❌ Server not set up. Run `/setup wallet <address>` first.', 
      ephemeral: true 
    });
    return;
  }
  
  const name = interaction.options.getString('name', true);
  const price = interaction.options.getNumber('price', true);
  const role = interaction.options.getRole('role', true) as Role;
  const chainsInput = interaction.options.getString('chains') || 'base';
  const billingInput = interaction.options.getString('billing') || 'one_time';
  
  // Parse billing
  const billingType = billingInput === 'one_time' ? 'one_time' : 'subscription';
  const billingPeriod = billingInput === 'monthly' ? 'monthly' : billingInput === 'yearly' ? 'yearly' : undefined;
  
  // Validate product name
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    await interaction.reply({ content: '❌ Product name cannot be empty.', ephemeral: true });
    return;
  }
  if (trimmedName.length > 50) {
    await interaction.reply({ content: '❌ Product name too long (max 50 characters).', ephemeral: true });
    return;
  }
  if (!/^[\w\s\-]+$/i.test(trimmedName)) {
    await interaction.reply({ content: '❌ Product name can only contain letters, numbers, spaces, and hyphens.', ephemeral: true });
    return;
  }
  
  // Validate price
  if (price > 10000) {
    await interaction.reply({ content: '❌ Price too high (max $10,000). Double-check your input.', ephemeral: true });
    return;
  }
  
  // Parse and validate chains
  const requestedChains = chainsInput.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
  const invalidChains = requestedChains.filter(c => !VALID_CHAINS.includes(c));
  
  if (invalidChains.length > 0) {
    await interaction.reply({ 
      content: `❌ Invalid chain(s): **${invalidChains.join(', ')}**\n\nValid chains: ${VALID_CHAINS.join(', ')}`, 
      ephemeral: true 
    });
    return;
  }
  
  // Check bot can manage this role
  const botMember = interaction.guild?.members.me;
  if (!botMember) {
    await interaction.reply({ content: '❌ Could not verify bot permissions.', ephemeral: true });
    return;
  }
  
  // Check role hierarchy
  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({ 
      content: `❌ Cannot assign role **${role.name}** - it's higher than or equal to my highest role. Move my role above it in Server Settings > Roles.`, 
      ephemeral: true 
    });
    return;
  }
  
  // Check Manage Roles permission
  if (!botMember.permissions.has('ManageRoles')) {
    await interaction.reply({ 
      content: '❌ I need the "Manage Roles" permission to assign roles.', 
      ephemeral: true 
    });
    return;
  }
  
  // Check wallet is configured for at least one of the chains
  const availableChains = getAvailableChainsForServer(serverId, requestedChains);
  if (availableChains.length === 0) {
    const needsEvm = requestedChains.some(c => c !== 'solana');
    const needsSolana = requestedChains.includes('solana');
    let hint = '';
    if (needsEvm && !server.evmWallet) hint += '\n• EVM wallet needed for: ' + requestedChains.filter(c => c !== 'solana').join(', ');
    if (needsSolana && !server.solanaWallet) hint += '\n• Solana wallet needed for: solana';
    
    await interaction.reply({ 
      content: `❌ No wallet configured for any of the specified chains.${hint}\n\nRun \`/setup wallet <address>\` first.`, 
      ephemeral: true 
    });
    return;
  }
  
  // Warn if some chains are unavailable
  const unavailableChains = requestedChains.filter(c => !availableChains.includes(c));
  let warning = '';
  if (unavailableChains.length > 0) {
    warning = `\n\n⚠️ These chains have no wallet configured and won't be available: ${unavailableChains.join(', ')}`;
  }
  
  // Check if product with same name and role exists - merge chains if so
  const existingProduct = getProductByName(serverId, name);
  if (existingProduct && existingProduct.discordRoleId === role.id) {
    // Merge chains
    const mergedChains = [...new Set([...existingProduct.chains, ...availableChains])];
    updateProduct(existingProduct.id, { chains: mergedChains });
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Product Updated')
      .setColor(COLORS.SUCCESS)
      .setDescription('Added new chains to existing product.')
      .addFields(
        { name: 'Name', value: name, inline: true },
        { name: 'Price', value: `$${existingProduct.price.toFixed(2)} USDC`, inline: true },
        { name: 'Chains', value: mergedChains.map(c => c.toUpperCase()).join(', '), inline: true },
        { name: 'Role', value: role.toString(), inline: true }
      )
      .setFooter({ text: 'MoltsPay • Server Monetization' });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  
  // Create new product
  const productId = generateId();
  createProduct({
    id: productId,
    serverId,
    name,
    type: 'role',
    price,
    currency: 'USDC',
    chains: availableChains,
    discordRoleId: role.id,
    billingType,
    billingPeriod,
    active: true
  });
  
  const billingDisplay = billingType === 'subscription' 
    ? `$${price.toFixed(2)}/${billingPeriod === 'yearly' ? 'year' : 'month'}` 
    : `$${price.toFixed(2)} (one-time)`;
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Product Created')
    .setColor(COLORS.SUCCESS)
    .addFields(
      { name: 'Name', value: name, inline: true },
      { name: 'Price', value: billingDisplay, inline: true },
      { name: 'Chains', value: availableChains.map(c => c.toUpperCase()).join(', '), inline: true },
      { name: 'Role', value: role.toString(), inline: true },
      { name: 'Product ID', value: `\`${productId}\``, inline: false }
    )
    .addFields({ 
      name: 'How to buy', 
      value: `Users can now run \`/buy ${name}\`${warning}` 
    })
    .setFooter({ text: 'MoltsPay • Server Monetization' });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function listProducts(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const products = getServerProducts(serverId, false); // Include inactive
  const embed = productListEmbed(products);
  
  // Add status indicators for admin view
  if (products.length > 0) {
    embed.setDescription(products.map((p, i) => {
      const status = p.active ? '🟢' : '🔴';
      const chainsDisplay = p.chains.map(c => c.toUpperCase()).join('/');
      const billingDisplay = p.billingType === 'subscription' 
        ? `$${p.price.toFixed(2)}/${p.billingPeriod === 'yearly' ? 'yr' : 'mo'}` 
        : `$${p.price.toFixed(2)}`;
      const subIcon = p.billingType === 'subscription' ? '🔄 ' : '';
      return `${status} ${subIcon}**${i + 1}. ${p.name}** - ${billingDisplay} ${p.currency}\n   ID: \`${p.id.slice(0, 8)}...\` | Chains: ${chainsDisplay} | Role: <@&${p.discordRoleId}>`;
    }).join('\n\n'));
  }
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function editProduct(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const productQuery = interaction.options.getString('product', true);
  const newPrice = interaction.options.getNumber('price');
  const active = interaction.options.getBoolean('active');
  
  // Find product
  const products = getServerProducts(serverId, false);
  const product = products.find(p => 
    p.id === productQuery || 
    p.id.startsWith(productQuery) || 
    p.name.toLowerCase() === productQuery.toLowerCase()
  );
  
  if (!product) {
    await interaction.reply({ content: `❌ Product not found: ${productQuery}`, ephemeral: true });
    return;
  }
  
  // Apply updates
  const updates: any = {};
  if (newPrice !== null) updates.price = newPrice;
  if (active !== null) updates.active = active;
  
  if (Object.keys(updates).length === 0) {
    await interaction.reply({ content: '❌ No changes specified.', ephemeral: true });
    return;
  }
  
  updateProduct(product.id, updates);
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Product Updated')
    .setColor(COLORS.SUCCESS)
    .addFields({ name: 'Product', value: product.name, inline: true });
  
  if (newPrice !== null) {
    embed.addFields({ name: 'New Price', value: `$${newPrice.toFixed(2)} USDC`, inline: true });
  }
  if (active !== null) {
    embed.addFields({ name: 'Status', value: active ? '🟢 Active' : '🔴 Disabled', inline: true });
  }
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function deleteProductCmd(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const productQuery = interaction.options.getString('product', true);
  
  // Find product
  const products = getServerProducts(serverId, false);
  const product = products.find(p => 
    p.id === productQuery || 
    p.id.startsWith(productQuery) || 
    p.name.toLowerCase() === productQuery.toLowerCase()
  );
  
  if (!product) {
    await interaction.reply({ content: `❌ Product not found: ${productQuery}`, ephemeral: true });
    return;
  }
  
  deleteProduct(product.id);
  
  await interaction.reply({ 
    content: `✅ Product **${product.name}** has been deleted.`, 
    ephemeral: true 
  });
}

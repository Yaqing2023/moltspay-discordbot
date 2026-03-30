/**
 * /setup - Server owner setup command
 */

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField
} from 'discord.js';
import { upsertServerWallet, getServer, setServerFiatMarkup } from '../services/database';
import { detectWalletType, formatWalletType, getChainsForWalletType } from '../utils/wallet';
import { COLORS } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set up MoltsPay for your server (Admin only)')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('wallet')
      .setDescription('Set a wallet address for receiving payments (auto-detects EVM/Solana)')
      .addStringOption(option =>
        option
          .setName('address')
          .setDescription('Your wallet address (EVM: 0x... or Solana: base58)')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('Check current setup status')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('fiat-markup')
      .setDescription('Set markup percentage for card payments (to cover processing fees)')
      .addNumberOption(option =>
        option
          .setName('percent')
          .setDescription('Markup percentage (e.g., 5 for 5%). Set to 0 to disable card payments.')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(50)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  
  if (subcommand === 'wallet') {
    await setupWallet(interaction);
  } else if (subcommand === 'status') {
    await showStatus(interaction);
  } else if (subcommand === 'fiat-markup') {
    await setupFiatMarkup(interaction);
  }
}

async function setupWallet(interaction: ChatInputCommandInteraction) {
  const address = interaction.options.getString('address', true).trim();
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  // Auto-detect wallet type
  const walletType = detectWalletType(address);
  
  if (walletType === 'unknown') {
    await interaction.reply({ 
      content: '❌ Invalid wallet address.\n\n' +
        '**Supported formats:**\n' +
        '• EVM (Base, Polygon, BNB): `0x` followed by 40 hex characters\n' +
        '• Solana: 32-44 character Base58 string\n\n' +
        '**Examples:**\n' +
        '• EVM: `0xb8d6f2441e8f8dfB6288A74Cf73804cDd0484E0C`\n' +
        '• Solana: `GiyfcU38d2vBHMbvukEJtdXd9MdGtbnsyftx8t3K3zRu`', 
      ephemeral: true 
    });
    return;
  }
  
  // Save to database
  upsertServerWallet(serverId, walletType, address);
  
  const chains = getChainsForWalletType(walletType);
  const chainList = chains.filter(c => !c.includes('_')).join(', '); // Filter out testnets for display
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Wallet Connected')
    .setColor(COLORS.SUCCESS)
    .setDescription(`Your **${formatWalletType(walletType)}** wallet has been saved!`)
    .addFields(
      { name: 'Wallet Address', value: `\`${address}\``, inline: false },
      { name: 'Supported Chains', value: chainList.toUpperCase(), inline: true },
      { name: 'Type', value: walletType.toUpperCase(), inline: true }
    );
  
  // Check if they have both wallet types
  const server = getServer(serverId);
  if (server) {
    const hasEvm = !!server.evmWallet;
    const hasSolana = !!server.solanaWallet;
    
    if (hasEvm && hasSolana) {
      embed.addFields({ 
        name: '🎉 Full Setup', 
        value: 'You have both EVM and Solana wallets configured. You can accept payments on all chains!' 
      });
    } else if (walletType === 'evm' && !hasSolana) {
      embed.addFields({ 
        name: '💡 Tip', 
        value: 'Add a Solana wallet to accept payments on Solana too:\n`/setup wallet <solana-address>`' 
      });
    } else if (walletType === 'solana' && !hasEvm) {
      embed.addFields({ 
        name: '💡 Tip', 
        value: 'Add an EVM wallet to accept payments on Base, Polygon, BNB:\n`/setup wallet 0x...`' 
      });
    }
  }
  
  embed.addFields({ 
    name: 'Next Steps', 
    value: '1. Create products with `/product create`\n2. Users can buy with `/buy <product>`' 
  });
  
  embed.setFooter({ text: 'MoltsPay • Server Monetization' });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showStatus(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const server = getServer(serverId);
  
  if (!server || (!server.evmWallet && !server.solanaWallet)) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Server Not Set Up')
      .setColor(COLORS.WARNING)
      .setDescription('This server has not been configured for MoltsPay yet.')
      .addFields({ 
        name: 'Get Started', 
        value: 'Run `/setup wallet <address>` to connect your receiving wallet.\n\n' +
          'The bot auto-detects wallet type:\n' +
          '• `0x...` → EVM (Base, Polygon, BNB)\n' +
          '• Base58 → Solana'
      });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Server Status')
    .setColor(COLORS.SUCCESS);
  
  if (server.evmWallet) {
    embed.addFields({ 
      name: '🔷 EVM Wallet', 
      value: `\`${server.evmWallet}\`\nChains: Base, Polygon, BNB`, 
      inline: false 
    });
  } else {
    embed.addFields({ 
      name: '🔷 EVM Wallet', 
      value: '❌ Not configured\n`/setup wallet 0x...`', 
      inline: false 
    });
  }
  
  if (server.solanaWallet) {
    embed.addFields({ 
      name: '🟣 Solana Wallet', 
      value: `\`${server.solanaWallet}\`\nChain: Solana`, 
      inline: false 
    });
  } else {
    embed.addFields({ 
      name: '🟣 Solana Wallet', 
      value: '❌ Not configured\n`/setup wallet <base58-address>`', 
      inline: false 
    });
  }
  
  embed.addFields(
    { name: 'Default Chain', value: server.defaultChain, inline: true },
    { name: 'Connected Since', value: server.createdAt.toLocaleDateString(), inline: true },
    { name: 'Card Payment Markup', value: `${Math.round(server.fiatMarkup * 100)}%`, inline: true }
  );
  
  embed.setFooter({ text: 'MoltsPay • Server Monetization' });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function setupFiatMarkup(interaction: ChatInputCommandInteraction) {
  const serverId = interaction.guildId;
  
  if (!serverId) {
    await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const server = getServer(serverId);
  if (!server) {
    await interaction.reply({ 
      content: '❌ Server not set up yet. Run `/setup wallet` first.', 
      ephemeral: true 
    });
    return;
  }
  
  const percent = interaction.options.getNumber('percent', true);
  const markup = percent / 100; // Convert 5 to 0.05
  
  setServerFiatMarkup(serverId, markup);
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS);
  
  if (percent === 0) {
    embed.setTitle('💳 Card Payments Disabled')
      .setDescription('Users will only see the "Pay with USDC" option.')
      .addFields({
        name: 'To re-enable',
        value: 'Run `/setup fiat-markup <percent>` with a value > 0'
      });
  } else {
    embed.setTitle('✅ Card Payment Markup Set')
      .setDescription(`Users can now pay with credit/debit cards via Coinbase.`)
      .addFields(
        { name: 'Markup', value: `${percent}%`, inline: true },
        { name: 'Example', value: `$10.00 product → $${(10 * (1 + markup)).toFixed(2)} with card`, inline: true }
      )
      .addFields({
        name: '💡 Recommendation',
        value: 'Coinbase charges ~3% for card payments. A 5% markup covers fees with a small buffer.'
      });
  }
  
  embed.setFooter({ text: 'MoltsPay • Server Monetization' });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

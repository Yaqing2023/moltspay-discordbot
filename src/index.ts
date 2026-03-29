/**
 * MoltsPay Discord Bot - Entry Point
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import express from 'express';
import { initDatabase, getPayment, getProduct } from './services/database';
import { setPaymentCallbacks } from './services/poller';
import { fulfill } from './services/fulfillment';
import { startCron } from './services/cron';

// Validate required env vars
const requiredEnvVars = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ENCRYPTION_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize database
initDatabase();
console.log('✅ Database initialized');

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Load commands
import { commands } from './commands';

// Populate command collection
client.commands = new Collection();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}
console.log(`📋 Loaded ${commands.length} commands`);

// Event: Bot ready
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Discord bot ready! Logged in as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} servers`);
  
  // Start subscription cron job
  startCron(client);
  
  // Set up payment poller callbacks
  setPaymentCallbacks(
    // On payment confirmed
    async (paymentId: string, txHash: string) => {
      console.log(`[Payment] Confirmed: ${paymentId}, tx: ${txHash}`);
      
      const payment = getPayment(paymentId);
      if (!payment) return;
      
      const product = getProduct(payment.productId);
      if (!product) return;
      
      // Fulfill the order (assign role, etc.)
      const result = await fulfill(client, payment, product);
      console.log(`[Payment] Fulfillment result:`, result);
      
      // Notify user via DM
      try {
        const user = await client.users.fetch(payment.discordUserId);
        if (result.success) {
          await user.send(
            `✅ **Payment Confirmed!**\n\n` +
            `You now have **${product.name}**!\n\n` +
            `Transaction: \`${txHash.slice(0, 10)}...${txHash.slice(-8)}\``
          );
        } else {
          await user.send(
            `⚠️ **Payment received but fulfillment failed**\n\n` +
            `Error: ${result.message}\n` +
            `Please contact an admin with Payment ID: \`${paymentId}\``
          );
        }
      } catch (e) {
        console.log(`[Payment] Could not DM user ${payment.discordUserId}`);
      }
    },
    // On payment expired
    async (paymentId: string) => {
      console.log(`[Payment] Expired: ${paymentId}`);
      
      const payment = getPayment(paymentId);
      if (!payment) return;
      
      // Notify user via DM
      try {
        const user = await client.users.fetch(payment.discordUserId);
        await user.send(
          `⏰ **Payment Expired**\n\n` +
          `Your payment session has expired. No payment was detected.\n\n` +
          `Run \`/buy\` again to try again.`
        );
      } catch (e) {
        console.log(`[Payment] Could not DM user ${payment.discordUserId}`);
      }
    }
  );
});

// Event: Interaction (slash commands, buttons)
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }
    
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);
      const reply = { content: '❌ An error occurred while executing this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  }
  
  // Handle button interactions
  // Note: chain_ and pay_ buttons are handled by awaitMessageComponent in buy.ts
  // Only handle other buttons here
  if (interaction.isButton()) {
    const customId = interaction.customId;
    
    // Skip buttons handled by command flows (awaitMessageComponent)
    if (customId.startsWith('chain_') || customId.startsWith('pay_')) {
      return; // Let the command's awaitMessageComponent handle it
    }
    
    // Handle other buttons
    const [action, type, id] = customId.split('_');
    console.log(`Button clicked: ${action}_${type}_${id}`);
    
    // Placeholder response for unhandled buttons
    await interaction.reply({ content: '⏳ Processing...', ephemeral: true });
  }
});

// Start webhook server for payment notifications
const app = express();
app.use(express.json());

app.post('/webhook/moltspay', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body));
  
  try {
    // TODO: Verify signature with WEBHOOK_SECRET
    // const signature = req.headers['x-moltspay-signature'];
    // if (!verifySignature(req.body, signature)) {
    //   return res.status(401).send('Invalid signature');
    // }
    
    const { paymentId, status, txHash } = req.body;
    
    if (!paymentId) {
      return res.status(400).send('Missing paymentId');
    }
    
    // Import here to avoid circular deps
    const { getPayment, updatePayment, getProduct } = await import('./services/database');
    const { fulfill } = await import('./services/fulfillment');
    
    // Get payment
    const payment = getPayment(paymentId);
    if (!payment) {
      console.log(`Webhook: Payment not found: ${paymentId}`);
      return res.status(404).send('Payment not found');
    }
    
    // Idempotency check
    if (payment.webhookProcessed) {
      console.log(`Webhook: Already processed: ${paymentId}`);
      return res.status(200).send('Already processed');
    }
    
    // Update payment status
    if (status === 'paid') {
      updatePayment(paymentId, {
        status: 'paid',
        txHash: txHash || undefined,
        paidAt: new Date()
      });
      
      // Get product and fulfill
      const product = getProduct(payment.productId);
      if (product) {
        const result = await fulfill(client, payment, product);
        
        if (result.success) {
          updatePayment(paymentId, {
            status: 'fulfilled',
            fulfilledAt: new Date(),
            webhookProcessed: true
          });
          
          // Notify user via DM
          try {
            const user = await client.users.fetch(payment.discordUserId);
            await user.send(`✅ **Payment Confirmed!**\n\nYou now have **${product.name}**!\n\nTransaction: \`${txHash || 'confirmed'}\``);
          } catch (e) {
            console.log('Could not DM user:', payment.discordUserId);
          }
        } else {
          console.error(`Fulfillment failed for ${paymentId}:`, result.message);
          updatePayment(paymentId, { webhookProcessed: true });
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal error');
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const webhookPort = process.env.WEBHOOK_PORT || 3402;

// Start both services
async function main() {
  try {
    // Start webhook server
    app.listen(webhookPort, () => {
      console.log(`✅ Webhook server listening on port ${webhookPort}`);
    });
    
    // Login to Discord
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();

// Extend Client type for commands
declare module 'discord.js' {
  interface Client {
    commands: Collection<string, any>;
  }
}

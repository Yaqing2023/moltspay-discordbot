/**
 * Deploy slash commands to Discord
 * 
 * Run: npm run deploy-commands
 */

import 'dotenv/config';
import { REST } from 'discord.js';
import { Routes } from 'discord-api-types/v10';
import { getCommandsData } from './commands';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID');
  process.exit(1);
}

const commands = getCommandsData();

const rest = new REST().setToken(token);

async function deploy() {
  try {
    console.log(`🔄 Deploying ${commands.length} commands...`);
    
    // Global commands (available in all servers)
    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    
    console.log(`✅ Successfully deployed ${(data as any[]).length} commands globally`);
    
    // List deployed commands
    for (const cmd of commands) {
      console.log(`  • /${cmd.name}`);
    }
    
  } catch (error) {
    console.error('Failed to deploy commands:', error);
    process.exit(1);
  }
}

deploy();

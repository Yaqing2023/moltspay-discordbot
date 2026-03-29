# Discord App Listing

Copy these when setting up the Discord application and bot directory listings.

## Short Description (400 chars max)

```
Accept crypto payments in your Discord server. Sell roles, premium channel access, and digital products for USDC. Gasless payments on Base, Polygon, and more. Powered by MoltsPay - the payment infrastructure for AI agents and communities.
```

## Long Description (for top.gg, discord.bots.gg, etc.)

```
MoltsPay Bot brings crypto monetization to Discord servers.

💰 SELL ANYTHING
• Paid roles (VIP, Premium, Verified)
• Premium channel access
• Digital products (files, codes, links)
• AI services (per-use commands)

⚡ SEAMLESS PAYMENTS
• USDC on Base, Polygon, BNB, Solana
• Auto-detects wallet type (EVM or Solana)
• Pay with MetaMask, Coinbase Wallet, Phantom
• Instant verification via blockchain

🛠️ EASY SETUP
• /setup wallet 0x... - Auto-detects EVM (Base, Polygon, BNB)
• /setup wallet abc... - Auto-detects Solana
• /product create - Create products in seconds
• Users just /buy - Bot handles the rest

🔒 SECURE
• Non-custodial - You control your wallet
• On-chain verification - No chargebacks
• Open source - Audit the code

Built for creators, communities, and the agentic economy.
```

## Tags

```
payments, crypto, monetization, USDC, roles, premium, paywall, 
cryptocurrency, web3, blockchain, Base, Polygon, Solana, 
economy, shop, store, server monetization, paid roles, 
digital products, subscriptions, MoltsPay, gasless
```

## Category

- Primary: **Economy**
- Secondary: **Utility**

## Links

- Website: https://moltspay.com
- Support Server: https://discord.gg/QwCJgVBxVK
- Documentation: https://moltspay.com/docs
- GitHub: https://github.com/moltspay/discord-bot

## Required Permissions

**Permission Integer:** `268438608`

| Permission | Reason |
|------------|--------|
| Manage Roles | Assign/remove paid roles after purchase |
| Manage Channels | Edit channel permissions for premium access |
| Kick Members | Remove members with expired subscriptions |
| Create Instant Invite | Generate paid server invites |
| Send Messages | Send payment confirmations |
| Embed Links | Display rich payment embeds |
| Read Message History | Command context |
| Use Slash Commands | All bot commands |

## Privileged Intents

- **Server Members Intent** - Required to fetch member info for role assignment

## OAuth2 Scopes

- `bot`
- `applications.commands`

## Invite URL Template

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268438608&scope=bot%20applications.commands
```

Replace `YOUR_CLIENT_ID` with your application ID.

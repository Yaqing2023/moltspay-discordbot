# MoltsPay Discord Bot

Server monetization with crypto payments. Sell roles, premium channels, and digital products for USDC.

## Features

- **Sell Roles** - Users pay, bot assigns Discord roles automatically
- **Monthly/Yearly Subscriptions** - Recurring access with automatic expiration
- **Premium Channels** - Gate content behind paid roles
- **Crypto Payments** - Accept USDC on Base, Polygon, BNB, Solana
- **Card Payments** - Credit/debit via Coinbase Onramp with configurable markup
- **One-Tap Payments** - Deep links to MetaMask, Coinbase Wallet, Trust, Phantom, Solflare
- **Multi-Chain Selection** - Users choose which blockchain to pay on
- **Bot Wallets** - Optional in-Discord wallets for seamless payments
- **External Wallets** - Support MetaMask, Coinbase Wallet, etc.
- **Automated Expiry** - Cron job removes expired roles, sends reminders

## Quick Start

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create New Application → Name it "MoltsPay Bot"
3. Go to "Bot" tab → Add Bot → Copy the token
4. Enable **Server Members Intent** under Privileged Gateway Intents
5. Go to "OAuth2" → "URL Generator"
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions (see below)
6. Copy the generated URL and invite the bot to your server
7. **Important:** In your server, drag the bot's role ABOVE any roles it will assign

#### Required Bot Permissions

| Permission | Why |
|------------|-----|
| Manage Roles | Assign/remove paid roles |
| Manage Channels | Edit channel access permissions |
| Kick Members | Remove expired subscriptions |
| Create Instant Invite | Generate paid invite links |
| Send Messages | Send confirmations |
| Embed Links | Rich payment embeds |
| Read Message History | Context for commands |
| Use Slash Commands | /buy, /setup, etc. |

**Permission Integer:** `268438608`

Or check these in URL Generator:
```
☑️ Manage Roles
☑️ Manage Channels
☑️ Kick Members
☑️ Create Instant Invite
☑️ Send Messages
☑️ Embed Links
☑️ Read Message History
☑️ Use Slash Commands
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
ENCRYPTION_KEY=generate_with_command_below
```

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Install & Run

```bash
npm install
npm run deploy-commands  # Register slash commands with Discord
npm run dev              # Start in development mode
```

For production:
```bash
npm run build
npm start
```

## Commands

### Admin Commands (Require Administrator permission)

| Command | Description |
|---------|-------------|
| `/setup wallet <address>` | Set receiving wallet (auto-detects EVM/Solana) |
| `/setup status` | Check current setup |
| `/setup fiat-markup <percent>` | Set card payment markup (0 to disable cards) |
| `/product create <name> <price> <role> [chain] [billing]` | Create a product (billing: one_time/monthly/yearly) |
| `/product list` | List all products |
| `/product edit <id> <field> <value>` | Edit a product |
| `/product delete <id>` | Delete a product |
| `/admin confirm <payment_id>` | Manually confirm a payment |
| `/admin grant <user> <product>` | Grant product without payment |
| `/admin sales` | View sales summary |
| `/admin subs` | List all active subscriptions |
| `/admin expirations [days]` | List subscriptions expiring soon |
| `/admin sub <user>` | View user's subscription status |
| `/admin extend <user> <product> <days>` | Extend a subscription |
| `/admin expire-check` | Manually run expiration check |

### User Commands

| Command | Description |
|---------|-------------|
| `/buy` | List available products |
| `/buy <product>` | Purchase a product |
| `/subscriptions` | View your active subscriptions |
| `/renew <product>` | Renew a subscription |
| `/cancel <product>` | Cancel subscription (keeps access until period end) |
| `/wallet create` | Create a bot-managed wallet |
| `/balance` | Check wallet balance |
| `/fund` | Get wallet address for deposits |

## Payment Methods

### 💎 USDC Payments

Users can pay directly with USDC from their crypto wallet. The bot provides **one-tap payment links** for popular wallets:

| Wallet | Chains Supported | Features |
|--------|------------------|----------|
| MetaMask 🦊 | Base, Polygon, BNB | Mobile + Web links |
| Coinbase Wallet 📘 | Base, Polygon, BNB | Mobile + Web links |
| Trust Wallet 🛡️ | Base, Polygon, BNB | Mobile link |
| Phantom 👻 | Solana | Mobile + Web links |
| Solflare 🔆 | Solana | Mobile + Web links |

**How it works:**
1. User clicks `/buy <product>`
2. Selects chain (if multiple available)
3. Clicks wallet button (amount pre-filled!)
4. Confirms in wallet
5. Bot detects payment and assigns role

### 💳 Card Payments (Coinbase Onramp)

Users without crypto can pay with credit/debit card via Coinbase:

1. Configure markup: `/setup fiat-markup 5` (5% to cover fees)
2. Users see both options: "Pay with USDC $10" or "Pay with Card $10.50"
3. Card payments redirect to Coinbase for secure processing
4. USDC is purchased and sent to your wallet
5. Bot detects payment and fulfills order

**Supported chains for card payments:** Base, Polygon

**Recommended markup:** 5% (Coinbase charges ~3% for cards)

## How It Works

1. **Server Owner Setup**
   - Run `/setup wallet 0xYourWallet...`
   - Set card markup: `/setup fiat-markup 5`
   - Create one-time product: `/product create "VIP" 50.00 @VIPRole`
   - Create subscription: `/product create "VIP Monthly" 5.00 @VIPRole billing:monthly`

2. **User Purchase Flow**
   - User runs `/buy VIP Monthly`
   - If product supports multiple chains: selects chain
   - Chooses payment method (USDC or Card)
   - **USDC:** Taps wallet button, amount pre-filled
   - **Card:** Redirects to Coinbase, pays with card
   - Bot automatically detects payment and assigns role

3. **Payment Verification**
   - EVM chains: On-chain polling detects transfers
   - Webhook support for instant confirmation
   - Bot fulfills order (assigns role, creates subscription)
   - User receives confirmation DM

4. **Subscription Lifecycle**
   - User can check status with `/subscriptions`
   - 3 days before expiry: reminder DM sent
   - On expiry: role automatically removed
   - User can `/renew` anytime (time stacks if early)

## Architecture

```
Discord User
     │
     ├─► /buy → Chain Selection → Payment Method
     │           │                      │
     │           ▼                      ▼
     │    USDC Deep Links         Coinbase Onramp
     │    (MetaMask/Phantom)      (Card → USDC)
     │           │                      │
     │           └──────────┬──────────┘
     │                      ▼
     │              Blockchain (USDC)
     │                      │
     │                      ▼
     │              Payment Poller
     │                      │
     │                      ▼
     └─► Fulfillment (Role Assignment)
                    │
                    ▼
            SQLite Database
```

## Development

```bash
# Run in watch mode
npm run dev

# Type check
npx tsc --noEmit

# Deploy commands to Discord
npm run deploy-commands
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal | Yes |
| `DISCORD_CLIENT_ID` | Application ID | Yes |
| `ENCRYPTION_KEY` | 32-byte hex string for wallet encryption | Yes |
| `WEBHOOK_PORT` | Port for payment webhook server | No (default: 3402) |
| `WEBHOOK_SECRET` | Secret for webhook signature verification | No |
| `DATABASE_PATH` | Path to SQLite database | No (default: ./data/bot.db) |
| `DEFAULT_CHAIN` | Default blockchain for payments | No (default: base) |

## Supported Chains

**EVM Chains** (same wallet address works):
- Base
- Polygon  
- BNB Chain

**Solana** (separate wallet):
- Solana

### Multi-Wallet Setup

The bot auto-detects wallet type from the address format:

```
/setup wallet 0xb8d6f2441e8f8dfB6288A74Cf73804cDd0484E0C
→ ✅ EVM wallet saved (Base, Polygon, BNB)

/setup wallet GiyfcU38d2vBHMbvukEJtdXd9MdGtbnsyftx8t3K3zRu
→ ✅ Solana wallet saved
```

Run the command twice (once for each address type) to accept payments on all chains.

## Card Payments Setup

### Enable Card Payments

```bash
# Set 5% markup (recommended)
/setup fiat-markup 5

# Check status
/setup status
# → Card Payment Markup: 5%
```

### Disable Card Payments

```bash
/setup fiat-markup 0
```

### How Markup Works

| Base Price | Markup | Card Price | Your Revenue |
|------------|--------|------------|--------------|
| $10.00 | 5% | $10.50 | ~$10.18* |
| $50.00 | 5% | $52.50 | ~$50.93* |
| $100.00 | 5% | $105.00 | ~$101.85* |

*After Coinbase's ~3% fee

## Security

- Private keys are encrypted with AES-256-GCM
- Encryption key stored in environment variable
- Sensitive information sent as ephemeral messages
- Wallet backup requires explicit confirmation

## Role Hierarchy

The bot can only assign roles that are **below** its own role in the hierarchy.

After inviting the bot:
1. Go to Server Settings → Roles
2. Drag the bot's role **above** any roles you want it to assign
3. If VIP role is at position 5, bot role must be at position 6+

## Subscriptions

### Creating Subscription Products

```bash
# Monthly subscription
/product create name:VIP-Monthly price:5 role:@VIP billing:monthly

# Yearly subscription  
/product create name:VIP-Yearly price:50 role:@VIP billing:yearly

# One-time purchase (default)
/product create name:Lifetime price:100 role:@VIP
```

### Subscription Behavior

| Feature | Behavior |
|---------|----------|
| **Duration** | Monthly = 30 days, Yearly = 365 days |
| **Renewal** | Manual via `/renew` (no auto-debit) |
| **Early Renewal** | Time stacks (remaining days preserved) |
| **Grace Period** | 3 days after expiry before role removal |
| **Reminders** | DM sent 3 days before expiry |
| **Cancellation** | Keeps access until period end |

### Automated Expiration

The bot runs a daily cron job at midnight UTC:

1. **Expire Check** - Removes roles from expired subscriptions
2. **Send Reminders** - DMs users whose subs expire within 3 days

Admins can manually trigger with `/admin expire-check`.

### Admin Subscription Management

```bash
# View all active subscriptions
/admin subs

# See who's expiring soon
/admin expirations 7

# Check specific user
/admin sub @username

# Extend a subscription
/admin extend @username VIP-Monthly 30
```

## Wallet Deep Links

The bot generates direct payment links with pre-filled amounts:

### EVM Chains (Base, Polygon, BNB)

| Wallet | Mobile | Web |
|--------|--------|-----|
| MetaMask | ✅ app.link | ✅ portfolio.metamask.io |
| Coinbase | ✅ go.cb-w.com | ✅ wallet.coinbase.com |
| Trust Wallet | ✅ link.trustwallet.com | ❌ |

### Solana

| Wallet | Mobile | Web |
|--------|--------|-----|
| Phantom | ✅ phantom.app/ul | ✅ phantom.app/ul |
| Solflare | ✅ solflare.com/ul | ✅ solflare.com/ul |

**Note:** Amount auto-fills on mobile. Desktop users may need to enter amount manually.

## License

MIT

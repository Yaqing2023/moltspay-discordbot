# MoltsPay Discord Bot - Implementation Plan

**Created:** 2026-03-29  
**Target:** Server Monetization MVP (OpenAI use case)

---

## Goal

Server owner sells role-gated access → User pays USDC → Bot assigns role → User unlocks premium channels

---

## Phase 1: Foundation ✅ SCAFFOLDED

**Goal:** Bot connects, responds, has storage

### 1.1 Project Setup ✅
- [x] Initialize Node.js project with TypeScript
- [x] package.json with dependencies
- [x] tsconfig.json
- [x] .env.example

### 1.2 Discord Bot Skeleton ✅
- [x] Basic client setup in index.ts
- [x] Event handlers (ready, interaction)
- [x] Command collection structure

### 1.3 Database Schema ✅
- [x] `servers` table
- [x] `products` table  
- [x] `payments` table
- [x] `wallets` table (for Phase 4)
- [x] Database service with CRUD operations

### 1.4 Basic Admin Command ✅
- [x] `/setup wallet <address>` command
- [x] `/setup status` command
- [x] Store server config in database

**Remaining for Phase 1:**
- [ ] Create Discord application + bot token
- [ ] Test bot connects and responds
- [ ] npm install & verify builds

---

## Phase 2: Product Management ✅ SCAFFOLDED

**Goal:** Server owners can create and list products

### 2.1 Create Product Command ✅
- [x] `/product create <name> <price> <role>`
- [x] Validates role exists
- [x] Checks bot can assign the role (hierarchy check)
- [x] Stores in database

### 2.2 List Products Command ✅
- [x] `/product list`
- [x] Shows all products with status

### 2.3 Edit/Delete Product Commands ✅
- [x] `/product edit <id> price/active`
- [x] `/product delete <id>`

### 2.4 Role Permission Pre-check ✅
- [x] Check "Manage Roles" permission
- [x] Check role hierarchy

**Remaining for Phase 2:**
- [ ] Test all product commands end-to-end
- [ ] Handle edge cases (duplicate names, etc.)

---

## Phase 3: Payment Flow - External Wallet 🔨 IN PROGRESS

**Goal:** User can buy a product using external wallet

### 3.1 Buy Command 🔨
- [x] `/buy <product>` basic structure
- [x] Show product embed with buttons
- [x] Create payment session in database
- [ ] **TODO:** Integrate with MoltsPay API to create payment request
- [ ] **TODO:** Generate actual payment URL

### 3.2 Webhook Endpoint 🔨
- [x] Express server running alongside bot
- [x] POST /webhook/moltspay endpoint stub
- [ ] **TODO:** Verify webhook signature
- [ ] **TODO:** Parse payment status
- [ ] **TODO:** Idempotency check

### 3.3 Fulfillment ✅
- [x] Fulfillment service with type routing
- [x] Role assignment logic
- [x] Digital product delivery (DM file)
- [x] Custom webhook support
- [ ] **TODO:** Test role assignment end-to-end

### 3.4 Error Handling
- [ ] Role assignment failure → mark "paid_unfulfilled", notify admin
- [ ] Payment expired → user can /buy again
- [ ] Duplicate webhook → return 200, don't re-assign

**Key TODO for Phase 3:**
1. MoltsPay API integration for creating payment requests
2. Webhook signature verification
3. Full payment → fulfillment → notification flow

---

## Phase 4: Payment Flow - Bot Wallet

**Goal:** Users can create wallets in the bot and pay from there

### 4.1 Wallet Create Command
- [ ] `/wallet create`
- [ ] Generate wallet using moltspay SDK
- [ ] Encrypt private key (AES-256)
- [ ] Store in database
- [ ] Return address (ephemeral)

### 4.2 Balance Command
- [ ] `/balance`
- [ ] Fetch on-chain USDC balance
- [ ] Show spending limits

### 4.3 Fund Command
- [ ] `/fund`
- [ ] Show wallet address
- [ ] Generate Coinbase Onramp link (optional)

### 4.4 Buy with Bot Wallet
- [ ] Add bot wallet button to /buy
- [ ] Check balance ≥ price
- [ ] Check limits (per_tx, daily)
- [ ] Execute UPP payment via moltspay SDK
- [ ] Fulfill on success

### 4.5 Spending Limit Commands
- [ ] `/config limits <per_tx> <daily>`

---

## Phase 5: Polish & Edge Cases

### 5.1 User Experience
- [ ] Pretty embeds for all responses
- [ ] Confirmation buttons with 60s timeout
- [ ] Ephemeral for sensitive info
- [ ] DM receipts option

### 5.2 Edge Cases
- [ ] User leaves server before fulfillment
- [ ] Partial payment handling
- [ ] Bot restart mid-payment recovery
- [ ] Rate limiting

### 5.3 Admin Dashboard Commands
- [ ] `/sales` - summary (today, week, month)
- [ ] `/sales history` - transaction list

### 5.4 Wallet Backup
- [ ] `/wallet backup` - DM encrypted key
- [ ] Confirmation required

### 5.5 Faucet
- [ ] `/faucet` - testnet USDC
- [ ] Rate limit: 1 per 24h

---

## Phase 6: Multi-Product & Testing

### 6.1 Additional Product Types
- [ ] Channel access (same as role)
- [ ] Digital product scaffold
- [ ] Service execution scaffold

### 6.2 End-to-End Testing
- [ ] Test with real testnet payments (Base Sepolia)
- [ ] Test external wallet flow
- [ ] Test bot wallet flow
- [ ] Test webhook replay (idempotency)
- [ ] Test role hierarchy edge case
- [ ] Test payment expiration

### 6.3 Documentation
- [ ] README with setup instructions
- [ ] .env.example complete
- [ ] One-click deploy button

---

## Phase 7: Launch

### 7.1 Deploy
- [ ] Deploy to Railway/Render/VPS
- [ ] Set up monitoring
- [ ] Webhook endpoint HTTPS

### 7.2 Demo Server
- [ ] Create demo Discord server
- [ ] Example products
- [ ] Demo video

### 7.3 Announce
- [ ] Post in MoltsPay Discord
- [ ] Tweet / Farcaster
- [ ] Moltbook post
- [ ] Dev.to article

---

## Current Status

**Phase 1:** ✅ Scaffolded  
**Phase 2:** ✅ Scaffolded  
**Phase 3:** 🔨 In Progress (need MoltsPay API integration)  
**Phase 4-7:** ⏳ Pending

---

## Files Created

```
moltspay-discordbot/
├── docs/
│   └── IMPLEMENTATION-PLAN.md     # This file
├── src/
│   ├── index.ts                   # Entry point, client setup
│   ├── deploy-commands.ts         # Command deployment script
│   ├── commands/
│   │   ├── index.ts               # Command loader
│   │   ├── setup.ts               # /setup command
│   │   ├── product.ts             # /product command
│   │   └── buy.ts                 # /buy command
│   ├── services/
│   │   ├── database.ts            # SQLite operations
│   │   └── fulfillment.ts         # Order fulfillment
│   ├── utils/
│   │   ├── crypto.ts              # Encryption helpers
│   │   └── embeds.ts              # Discord embed builders
│   └── types/
│       └── index.ts               # TypeScript types
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Next Steps

1. **Create Discord Application**
   - Go to https://discord.com/developers/applications
   - Create new application
   - Create bot, get token
   - Enable "Server Members Intent"
   - Generate invite URL with bot + applications.commands scopes

2. **Configure Environment**
   - Copy .env.example to .env
   - Fill in DISCORD_TOKEN, DISCORD_CLIENT_ID
   - Generate ENCRYPTION_KEY

3. **Install & Test**
   ```bash
   cd ~/clawd/projects/moltspay-discordbot
   npm install
   npm run deploy-commands
   npm run dev
   ```

4. **MoltsPay API Integration**
   - Create payment request endpoint
   - Webhook signature verification
   - Payment URL generation

---

## Key Decisions Made

1. **Webhook hosting:** Express server on same process (port 3402)
2. **Encryption:** Bot-managed with env var key (simple for MVP)
3. **Chain:** Base-only for Phase 1
4. **Storage:** SQLite (simple, portable, good enough for MVP)

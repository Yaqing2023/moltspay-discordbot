# Digital Service Integration Plan

## Overview

Allow users to purchase and use MoltsPay-powered services (like video generation) directly from Discord.

## Concept

```
User: /generate video "a cat playing piano"
  ↓
Bot shows price ($0.99) + wallet buttons
  ↓
User pays
  ↓
Bot calls MoltsPay service API
  ↓
Bot returns video to user
```

## Product Types

| Type | Current | New |
|------|---------|-----|
| role | ✅ | - |
| subscription | 🔜 | - |
| digital | - | File delivery via DM |
| service | - | **API call + return result** |

## Service Product Schema

```sql
-- Existing product table, new fields:
service_endpoint TEXT,     -- e.g., "https://juai8.com/zen7"
service_id TEXT,           -- e.g., "text-to-video"
service_params_schema TEXT -- JSON schema for required params
```

## Commands

### Admin: Create Service Product

```
/product create-service 
  name:Video Generation 
  endpoint:https://juai8.com/zen7 
  service:text-to-video 
  price:0.99
```

### User: Use Service

**Option A: Generic command**
```
/service "Video Generation" prompt:"a cat playing piano"
```

**Option B: Custom commands per service**
```
/generate video "a cat playing piano"
/generate image "sunset over mountains"
```

## Flow

### Purchase + Execute

```
User: /generate video "a cat dancing"
  ↓
Find service product "text-to-video"
  ↓
Show price: $0.99 USDC
[🦊 MetaMask] [📘 Coinbase] [🌈 Rainbow]
  ↓
User pays → polling detects payment
  ↓
Call MoltsPay service:
  POST https://juai8.com/zen7/text-to-video
  Body: { prompt: "a cat dancing" }
  ↓
Wait for response (may take 60-90s for video)
  ↓
Return result to user:
  - Video: Upload as attachment
  - Image: Upload as attachment
  - Text: Display in embed
  - URL: Show link
```

### Service Execution Options

**Option 1: Direct API Call (Simple)**
- Bot has server wallet
- Bot pays for service directly
- User reimburses bot via payment flow

**Option 2: Pass-through (Complex)**
- User's payment goes to service provider
- Need to coordinate payment + service call

**Recommended: Option 1** - Bot acts as intermediary

## Architecture

```
┌─────────────────────────────────────────────┐
│ Discord                                      │
│                                              │
│  User ──/generate──> Bot                     │
│                       │                      │
│                       ▼                      │
│              Show payment UI                 │
│                       │                      │
│                       ▼                      │
│              User pays (to Bot wallet)       │
│                       │                      │
└───────────────────────│──────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ Bot Backend                                   │
│                                               │
│  1. Verify payment received                   │
│  2. Call MoltsPay service (bot pays)          │
│  3. Return result to Discord                  │
│                                               │
└───────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ MoltsPay Service (e.g., Zen7)                │
│                                               │
│  Receives x402 payment + request              │
│  Returns video/image/result                   │
│                                               │
└───────────────────────────────────────────────┘
```

## Bot Wallet Requirement

For calling MoltsPay services, bot needs its own wallet:

```env
BOT_WALLET_PRIVATE_KEY=0x...
BOT_WALLET_CHAIN=base
```

Bot wallet needs USDC balance to pay for services.

**Revenue model:**
- User pays Bot: $1.00
- Bot pays Service: $0.99
- Bot keeps: $0.01 (or markup)

## Response Handling

| Service Returns | Bot Does |
|-----------------|----------|
| `{ video_url: "..." }` | Download + upload to Discord |
| `{ image_url: "..." }` | Download + upload to Discord |
| `{ text: "..." }` | Display in embed |
| `{ file: base64 }` | Decode + upload |
| `{ error: "..." }` | Show error, offer refund? |

## Error Handling

```
Service call fails:
  ↓
Log error
  ↓
DM user: "Service failed. Contact admin for refund."
  ↓
Mark payment as "service_failed"
  ↓
Admin can manually refund
```

## Implementation Order

1. Bot wallet setup (private key in env)
2. Service product type in DB
3. `/product create-service` command
4. `/service` or `/generate` command
5. Payment flow (reuse existing)
6. Service execution after payment
7. Response handling (video/image upload)
8. Error handling + refund flow

## Example Usage

```
User: /generate video prompt:a happy corgi running on the beach

Bot: 🎬 Video Generation
     
     Price: $0.99 USDC on Base
     
     [🦊 MetaMask] [📘 Coinbase]

User: *clicks MetaMask, pays*

Bot: ⏳ Payment received! Generating video...
     This may take 60-90 seconds.

*90 seconds later*

Bot: ✅ Here's your video!
     [video attachment]
     
     Prompt: "a happy corgi running on the beach"
     Cost: $0.99 USDC
```

## Dependencies

- MoltsPay SDK (`moltspay` npm package)
- Bot wallet with USDC balance
- File upload handling for Discord
- Timeout handling (video gen can take 90s+)

## Future Enhancements

- Service discovery from `/.well-known/agent-services.json`
- Dynamic pricing from service endpoint
- Usage history `/my-generations`
- Favorites / re-run previous prompts

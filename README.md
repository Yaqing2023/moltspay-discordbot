# MoltsPay Discord Bot

Server monetization with crypto payments. Sell roles, premium channels, and digital products for USDC.

## Quick Start

```bash
cp .env.example .env    # Configure
npm install             # Install
npm run build           # Build
npm run deploy-commands # Register slash commands
npm start               # Run
```

## Documentation

| 文档 | 说明 |
|------|------|
| [DEV-AND-DEPLOY.md](docs/DEV-AND-DEPLOY.md) | 完整开发与部署文档（架构、流程、数据库、运维、已知问题） |
| [DESIGN.md](docs/DESIGN.md) | 产品设计文档 |
| [IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | 实现计划 |
| [SUBSCRIPTION-PLAN.md](docs/SUBSCRIPTION-PLAN.md) | 订阅功能计划 |
| [DIGITAL-SERVICE-PLAN.md](docs/DIGITAL-SERVICE-PLAN.md) | 数字服务计划 |
| [LAUNCH-TODO.md](docs/LAUNCH-TODO.md) | 上线清单 |
| [APP-LISTING.md](docs/APP-LISTING.md) | 应用商店描述 |

## Features

- 💎 USDC payments (Base, Polygon, BNB, Solana)
- 💳 Credit/debit card via Coinbase Onramp
- 🅰️ 支付宝支付（AI 收）
- 🛒 One-tap wallet deep links (MetaMask, Coinbase, Phantom, etc.)
- 🔄 Monthly/yearly subscriptions with auto-expiry
- 📋 Slash commands: /buy, /setup, /product, /admin

## Bot Info

- Bot ID: 1487637287910248619
- Repo: Yaqing2023/moltspay-discordbot (private)
- License: MIT

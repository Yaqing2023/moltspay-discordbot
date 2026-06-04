# MoltsPay Discord Bot — 开发与部署文档

**最后更新:** 2026-06-04

---

## 1. 概述

MoltsPay Discord Bot 是一个独立运行的 Discord 支付 Bot，用于在 Discord 服务器内销售商品（角色、频道访问、数字产品等），支持加密货币、信用卡和支付宝三种支付方式。

**关键点：** 这个 Bot 和 OpenClaw 完全独立，不走 OpenClaw 的 Discord 接入，而是自己独立连接 Discord Gateway。

---

## 2. 两个 Bot 的区别

| | MoltsPay (支付 Bot) | AlienClawZen7 (AI 助手) |
|---|---|---|
| Bot ID | 1487637287910248619 | 1472466161114419272 |
| 用途 | 支付、商品管理、角色分配 | AI 对话、视频生成 |
| 运行方式 | 独立 Node.js 进程 | OpenClaw discord channel |
| 代码位置 | ~/clawd/projects/moltspay-discordbot/ | OpenClaw 配置内 |
| 通信方式 | Discord.js 直连 Gateway | 通过 OpenClaw 路由 |
| 两者关系 | 互不通信 | 互不通信 |

---

## 3. 技术栈

- **运行时:** Node.js (v22+)
- **语言:** TypeScript
- **Discord 库:** discord.js v14
- **数据库:** SQLite (better-sqlite3)，WAL 模式
- **区块链交互:** ethers.js v6
- **QR 码:** qrcode 包
- **支付 CLI:** alipay-bot（支付宝 AI 收）
- **Webhook 服务:** Express.js

---

## 4. 架构

```
                    ┌─────────────────────────────────┐
                    │      Discord Gateway             │
                    └──────┬──────────────┬────────────┘
                           │              │
                    Slash Commands     Events
                           │              │
                    ┌──────▼──────────────▼────────────┐
                    │        Bot 主进程 (index.ts)       │
                    │  - Discord Client (discord.js)     │
                    │  - Express Webhook Server (:3402)  │
                    │  - Cron Scheduler (订阅到期检查)    │
                    └──────┬──────────────┬────────────┘
                           │              │
              ┌────────────▼──┐     ┌─────▼──────────────┐
              │  Commands/    │     │  Services/          │
              │  - buy.ts     │     │  - payment.ts       │
              │  - setup.ts   │     │  - poller.ts        │
              │  - product.ts │     │  - alipay.ts        │
              │  - admin.ts   │     │  - fulfillment.ts   │
              │  - subscript. │     │  - subscription.ts  │
              │  - cancel.ts  │     │  - database.ts      │
              │  - renew.ts   │     │  - cron.ts          │
              └───────────────┘     └──────┬─────────────┘
                                           │
                              ┌────────────▼────────────┐
                              │     SQLite Database      │
                              │  - servers               │
                              │  - products              │
                              │  - payments              │
                              │  - subscriptions         │
                              │  - wallets               │
                              └─────────────────────────┘
                                           │
                    ┌──────────────────────┬▼───────────────────┐
                    │                      │                     │
              ┌─────▼─────┐    ┌──────────▼──────┐    ┌────────▼────────┐
              │ EVM 链上   │    │ Coinbase Onramp  │    │  alipay-bot CLI │
              │ Poller     │    │ API (信用卡)     │    │  (支付宝)       │
              │ (ethers.js)│    │                  │    │                 │
              │ Base/Polygon/BNB│ moltspay.com/api │    │ aigw.alipay.com │
              └────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 5. 目录结构

```
moltspay-discordbot/
├── src/
│   ├── index.ts              # 入口：Discord Client + Express Webhook
│   ├── deploy-commands.ts    # 注册 Slash Commands 到 Discord
│   ├── commands/
│   │   ├── index.ts          # 命令汇总导出
│   │   ├── buy.ts            # /buy 购买流程（最复杂）
│   │   ├── setup.ts          # /setup 钱包配置
│   │   ├── product.ts        # /product 商品管理
│   │   ├── admin.ts          # /admin 管理命令
│   │   ├── subscription.ts   # /subscriptions 查看
│   │   ├── cancel.ts         # /cancel 取消订阅
│   │   └── renew.ts          # /renew 续费
│   ├── services/
│   │   ├── database.ts       # SQLite 全部操作
│   │   ├── payment.ts        # 支付会话创建
│   │   ├── poller.ts         # EVM 链上 USDC Transfer 轮询
│   │   ├── alipay.ts         # 支付宝支付（alipay-bot CLI）
│   │   ├── fulfillment.ts    # 履约（分配角色/发DM/调webhook）
│   │   ├── subscription.ts   # 订阅业务逻辑
│   │   └── cron.ts           # 定时任务（到期检查+提醒）
│   ├── types/
│   │   └── index.ts          # 类型定义
│   └── utils/
│       ├── crypto.ts         # ID 生成
│       ├── deeplinks.ts      # 钱包 Deep Link 生成
│       ├── embeds.ts         # Discord Embed 模板
│       ├── onramp.ts         # Coinbase Onramp 集成
│       └── wallet.ts         # 钱包工具
├── data/
│   └── bot.db                # SQLite 数据库
├── .env                      # 环境变量
├── restart.sh                # 重启脚本
└── tsconfig.json
```

---

## 6. 核心流程

### 6.1 USDC 支付流程

```
用户 /buy <product>
    │
    ▼ 选支付方式: 💎 USDC
    │
    ▼ 选链: 🔵Base / 🟣Polygon / 🟡BNB / 🟢Solana
    │
    ▼ 生成唯一金额（基础价 + 随机 0.001~0.009 USDC，防止重复检测）
    │
    ▼ 生成钱包 Deep Link 按钮（MetaMask/Coinbase/Trust/Phantom/Solflare）
    │  移动端：金额自动填充
    │  桌面端：需手动输入金额
    │
    ▼ 启动 Poller（每10秒轮询链上 Transfer 事件）
    │  - 查询 USDC 合约 Transfer(to=收款地址) 事件
    │  - 比对金额（允许超额支付）
    │  - 检查 txHash 是否已被使用（防双花）
    │  - 最多轮询 90 次（15分钟），超时标记过期
    │
    ▼ 检测到支付
    │
    ▼ 调用 fulfill() 履约
    │  - role 类型 → 分配 Discord 角色
    │  - digital 类型 → DM 发送文件
    │  - custom 类型 → 调用外部 webhook
    │  - subscription 类型 → 创建/续期订阅 + 分配角色
    │
    ▼ DM 通知用户支付确认
```

### 6.2 信用卡支付流程

```
用户 /buy <product>
    │
    ▼ 选支付方式: 💳 Card
    │  （需 server 设置 fiat-markup > 0，最低金额 $5）
    │
    ▼ 自动选择 Base 链
    │
    ▼ 调用 moltspay.com/api/v1/onramp/create 生成 Coinbase Onramp URL
    │  - 金额 = 基础价 × (1 + markup%)
    │  - markup 用于覆盖 Coinbase 手续费（推荐 5%）
    │
    ▼ 用户在 Coinbase 完成信用卡支付
    │  - Coinbase 购买 USDC 直接打到收款钱包
    │
    ▼ 同样用 EVM Poller 检测链上到账
    │
    ▼ 履约
```

### 6.3 支付宝支付流程

```
用户 /buy <product>
    │
    ▼ 选支付方式: 🅰️ 支付宝
    │  （需 server 启用 alipay，product 配置 alipay 价格）
    │
    ▼ 向服务端 POST 请求，触发 402 响应
    │  - 获取 Payment-Needed 头
    │
    ▼ alipay-bot payment-intent → 建立会话
    │
    ▼ alipay-bot check-wallet → 确认钱包开通
    │  - 有重试机制（最多3次），处理网关抖动
    │  - 真正的"未开通"错误直接失败
    │
    ▼ 保存 Payment-Needed 到临时文件 ~/.moltspay/alipay/402_<id>.txt
    │
    ▼ alipay-bot 402-buyer-pay → 获取支付链接 + tradeNo
    │
    ▼ 生成 QR 码图片（用 qrcode 包从支付 URL 生成）
    │
    ▼ 发送 Embed（含 QR 码 + 手机支付按钮）
    │
    ▼ 启动 Alipay Poller（每5秒轮询，30分钟超时）
    │  - 调用 alipay-bot 402-query-payment-status
    │  - 检测 "支付状态成功"/"SUCCESS" 标记
    │
    ▼ 检测到支付 → 在频道发送确认消息
    │  ⚠️ 注意：支付宝路径没有走 fulfill()，
    │  直接在 onPaid 回调里发频道消息，不分配角色
```

---

## 7. 数据库 Schema

### servers 表
| 字段 | 类型 | 说明 |
|------|------|------|
| server_id | TEXT PK | Discord 服务器 ID |
| evm_wallet | TEXT | EVM 收款钱包地址 |
| solana_wallet | TEXT | Solana 收款钱包地址 |
| default_chain | TEXT | 默认链 (base) |
| fiat_markup | REAL | 信用卡加价比例 (0.05 = 5%) |
| alipay_enabled | INT | 支付宝开关 |
| alipay_seller_id | TEXT | 支付宝卖家 ID |
| alipay_service_endpoint | TEXT | 支付宝 402 服务端地址 |

### products 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 商品 ID |
| server_id | TEXT | 所属服务器 |
| name | TEXT | 商品名 |
| type | TEXT | role/channel/digital/custom/service |
| price | REAL | USDC 价格 |
| chains | TEXT | JSON 数组，支持哪些链 |
| discord_role_id | TEXT | 对应 Discord 角色 |
| billing_type | TEXT | one_time / subscription |
| billing_period | TEXT | monthly / yearly |
| alipay_price_cny | TEXT | 支付宝 CNY 价格 |
| alipay_goods_name | TEXT | 支付宝商品名 |

### payments 表
| 字段 | 类型 | 说明 |
|------|------|------|
| payment_id | TEXT PK | 支付 ID |
| discord_user_id | TEXT | 买家 Discord ID |
| product_id | TEXT | 商品 ID |
| amount | REAL | 实付金额（含随机小数） |
| chain | TEXT | 支付链 |
| status | TEXT | pending/paid/fulfilled/expired/failed |
| tx_hash | TEXT | 链上交易哈希 |
| payment_method | TEXT | usdc/card/alipay |

### subscriptions 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 订阅 ID |
| user_id | TEXT | 用户 ID |
| product_id | TEXT | 商品 ID |
| status | TEXT | active/expired/cancelled |
| current_period_end | TEXT | 当前周期结束时间 |
| reminder_sent | INT | 是否已发到期提醒 |

---

## 8. 配置

### .env 文件

```env
DISCORD_TOKEN=           # Discord Bot Token（必填）
DISCORD_CLIENT_ID=       # Discord 应用 ID（必填，1487637287910248619）
ENCRYPTION_KEY=          # AES-256 加密密钥（必填，32字节 hex）
WEBHOOK_PORT=3402        # Webhook 端口
WEBHOOK_SECRET=          # Webhook 签名验证
MOLTSPAY_API_URL=https://moltspay.com  # MoltsPay 服务端
DATABASE_PATH=./data/bot.db             # SQLite 路径
DEFAULT_CHAIN=base                      # 默认链
```

---

## 9. 运维

### 启动/重启

```bash
# 重启（推荐）
cd ~/clawd/projects/moltspay-discordbot && bash restart.sh

# restart.sh 内容：
# 1. pkill -9 杀死旧进程
# 2. 释放 3402 端口
# 3. sleep 5
# 4. nohup node dist/index.js >> bot.log 2>&1 &
```

### 查看日志

```bash
tail -50 ~/clawd/projects/moltspay-discordbot/bot.log
```

### 检查进程

```bash
ps aux | grep moltspay-discordbot/dist | grep -v grep
```

### 注册 Slash Commands

```bash
cd ~/clawd/projects/moltspay-discordbot
npx tsx src/deploy-commands.ts
```

### 数据库操作

```bash
sqlite3 ~/clawd/projects/moltspay-discordbot/data/bot.db

# 常用查询
SELECT * FROM servers;
SELECT * FROM products WHERE server_id = '1472602423267819734';
SELECT * FROM payments ORDER BY created_at DESC LIMIT 10;
SELECT * FROM subscriptions WHERE status = 'active';
```

---

## 10. Webhook 端点

Bot 启动时在 3402 端口启动 Express 服务器：

| 端点 | 方法 | 说明 |
|------|------|------|
| POST /webhook/moltspay | JSON | MoltsPay 支付回调（幂等处理） |
| GET /health | - | 健康检查 |

Webhook 流程：
1. 收到 { paymentId, status, txHash }
2. 查找 payment，检查幂等性（webhookProcessed 标记）
3. 更新状态 → 调用 fulfill() → DM 通知用户

---

## 11. 定时任务

### 订阅到期检查（Cron）
- 每天 UTC 00:00 执行
- 启动 5 分钟后也会跑一次（兜底）
- 功能：
  1. 找出已过期的 active 订阅 → 移除角色 → 标记 expired → DM 通知
  2. 找出 3 天内到期的订阅 → 发提醒 DM

---

## 12. 钱包 Deep Link 生成

### EVM 链（Base/Polygon/BNB）

| 钱包 | 移动端 | 桌面端 |
|------|--------|--------|
| MetaMask 🦊 | app.link + 合约参数 | portfolio.metamask.io |
| Coinbase 📘 | go.cb-w.com | wallet.coinbase.com |
| Trust 🛡️ | link.trustwallet.com | 不支持 |

链接格式示例（MetaMask Base）：
```
https://metamask.app.link/send/{usdc_contract}@8453/transfer?address={recipient}&uint256={amount_units}
```

### Solana

| 钱包 | 链接格式 |
|------|----------|
| Phantom 👻 | phantom.app/ul/v1/transfer?recipient=...&splToken=... |
| Solflare 🔆 | solflare.com/ul/v1/transfer?... |

---

## 13. 已知问题

### 13.1 内存泄漏（严重）

**状态：** 已修复（2026-06-04）
**现象：** 长时间运行后 heap 膨胀到 4GB+ 导致 OOM 崩溃
**时间线：** 2026-06-04 确认 Bot 因 OOM 挂掉，同日修复

**代码层面的原因（已确认）：**

1. **每次轮询 new ethers.JsonRpcProvider（主因）** — poller.ts 每次 startPolling 都创建新的 provider，每个 provider 自带后台区块轮询循环且从不销毁，随支付次数线性泄漏
2. **支付宝轮询递归 setTimeout** — alipay.ts 用 setTimeout 递归轮询，error 路径会持续重试
3. **Poller 未清理（潜在）** — poller.ts 用 `setInterval` + `activePollers` Map，若 stopPolling 在异常路径未被调用，interval 会一直运行
4. **Discord.js 事件监听（潜在）** — buy.ts 里 collector 超时后若没清理干净，可能泄漏

**已实施修复：**
- ✅ `poller.ts`：新增 `providerCache` Map + `getProvider(chain, url)`，按链复用单例 JsonRpcProvider（堵住主因）
- ✅ `alipay.ts`：新增 `ALIPAY_MAX_POLLS=360` 硬上限 + `pollCount` 计数器，超时或超次数即 expire
- ✅ `restart.sh`：启动加 `--max-old-space-size=512`（安全网，超限快速崩溃而非吃满内存）
- ✅ `index.ts`：新增 `startMemoryMonitor()`，每 5 分钟向 bot.log 记录 `rss/heapUsed/heapTotal/external/activePollers`，便于持续观测

**仍待跟进：**
- 用内存监控日志确认 `activePollers` 是否只增不减（验证嫌疑 3/4）
- 考虑改用 systemd + 自动重启策略

### 13.2 支付宝路径不完整

**状态：** 已修复（2026-06-04）

原问题：支付宝支付成功后只在频道发消息，没有调用 fulfill() 分配角色，role 类型商品付了钱拿不到角色。

修复：`buy.ts` 的 alipay `onPaid` 回调现在先 `getPayment(paymentId)` → `fulfill(client, payment, product)` 再发频道消息，与 EVM/Onramp 路径一致；履约失败时在确认消息里附带 Payment ID 提示联系管理员。

---

## 14. 部署清单

### 首次部署

1. 创建 Discord Application → Bot → 获取 Token
2. 开启 Server Members Intent
3. OAuth2 URL Generator: scopes=`bot applications.commands`，权限整数=`268438608`
4. 邀请 Bot 到服务器
5. 把 Bot 角色拖到要分配的角色上方
6. `cp .env.example .env` 并填写
7. `npm install && npm run build`
8. `npx tsx src/deploy-commands.ts` 注册命令
9. `npm start` 或 `bash restart.sh`

### 服务器管理员设置

```
/setup wallet 0xb8d6f2441e8f8dfB6288A74Cf73804cDd0484E0C    # 设置 EVM 钱包
/setup wallet GiyfcU38d2vBHMbvukEJtdXd9MdGtbnsyftx8t3K3zRu  # 设置 Solana 钱包
/setup fiat-markup 5                                         # 5% 信用卡加价
/product create name:VIP price:5 role:@VIP                   # 创建商品
/product create name:VIP-Monthly price:5 role:@VIP billing:monthly  # 订阅
```

---

## 15. 与 OpenClaw 的关系

**没有关系。** 两个完全独立的系统：

- MoltsPay Bot：独立 Node.js 进程，自己管理 Discord 连接
- AlienClawZen7：通过 OpenClaw 配置的 Discord channel 接入

它们之间没有任何通信机制。用户在 Discord 上同时看到两个 Bot，各自独立响应。

如果要打通两个 Bot（比如支付成功后通知 AI 助手），需要额外实现：
- 方案 A：MoltsPay Bot 调 OpenClaw API
- 方案 B：共享数据库/消息队列
- 方案 C：通过 Discord 频道消息间接通信

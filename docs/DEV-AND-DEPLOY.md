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

### 13.3 支付宝下单报错 `Expected 402, got 404`（service 名不匹配）

**状态：** 代码已迁移到 moltspay SDK（2026-06-05）；端点/商品的 service 对齐仍需按部署环境配置（见下）
**现象：** Discord `/buy` 选支付宝后报错 `❌ 支付宝支付创建失败：Expected 402, got 404`

**根因（已复现 + 正向验证）：**
这是**业务层 404**，不是网络/URL/支付宝授权问题。链路本身是通的（`/health`=200，`/execute` 存在，`ping` 能正常返回 402），唯一缺口是 **bot 发送的 service 名 ≠ 402 服务端注册的 service id**。

- 报错位置：`src/services/alipay.ts:254-256`
  ```ts
  body: JSON.stringify({ service: product.name, params: {} })   // ← 发的是 Discord 商品名
  if (res.status !== 402) throw new Error(`Expected 402, got ${res.status}`);
  ```
- 402 服务端（`payment-agent`，独立进程，端点 `http://127.0.0.1:8402/execute`）的 `/execute` 逻辑：
  ```ts
  const skill = this.skills.get(service);
  if (!skill) return sendJson(res, 404, { error: `Service '${service}' not found or not registered` });
  ```
- 服务端实际注册的 service id（来自 `skills/video_gen/moltspay.services.json`）：`ping` / `text-to-video` / `image-to-video`
- bot 实际发送的 `service`（= `product.name`）：`zen7-vip` / `zen7-subscription` / `test-video` …
- 二者完全不匹配 → 服务端返回 404 → bot 断言抛出 `Expected 402, got 404`

复现：
```
service='zen7-vip'      -> 404 ❌（bot 实际发的）
service='test-video'    -> 404 ❌
service='ping'          -> 402 ✅（服务端真有的名字，带 Payment-Needed 头）
```

**历史确认：** 此链路**从未端到端跑通过**，非回归。支付宝接入（commit `0d93c18`，2026-06-04）起 `service: product.name` 就没变过；8402 服务端自 2026-06-03 起一直加载 `video_gen` 清单，从未注册过商品名对应的 service。

**架构定性（重要，避免误修）：**
本 bot（`moltspay-discordbot`）与 8402 上运行的 `payment-agent + video_gen` 是**两套完全独立、互不相关的系统**：

- 本 bot：独立的 Discord 电商，卖自己的商品（会员/角色等），有自己的价格，履约 = 发 Discord 角色。
- `payment-agent + video_gen`：独立的 x402 服务提供方，卖 AI 视频生成能力（`ping`/`text-to-video`/`image-to-video`），有自己的 service、价格、商户凭证。

两者之间**没有也不应该有**「商品 ↔ service」的所属或映射关系。因此问题的本质是：bot 的 `alipay_service_endpoint` 被错误地指向了**一个不相关系统的端点**（`http://127.0.0.1:8402/execute`），bot 拿自己的商品名去查 video_gen 的 service 表当然 404 —— 这是**接错对象**，不是「缺一层映射」。

> ⚠️ **不要**把 zen7-vip / zen7-subscription 等商品塞进 video_gen 的 manifest。那会把两个独立系统错误耦合，并导致用错商户、收错金额。

**已实施修复（2026-06-05）：迁移到 moltspay SDK**
确认 `/execute` 端点本就是给本 bot 用的收款入口，集成方式应走官方 SDK，而不是 bot 自己手写 fetch+CLI。已将 `src/services/alipay.ts` 从「手写 402 fetch + `spawn('alipay-bot')` + 自写轮询」整体重写为调用 SDK：

```ts
import { MoltsPayClient } from 'moltspay';
const client = new MoltsPayClient({ alipaySessionId: `discord-${paymentId}` });
await client.pay(serviceEndpoint, service, {}, {
  rail: 'alipay',
  timeoutMs: 30 * 60 * 1000,
  onPaymentPending: (info) => { /* 生成二维码、建 DB 记录、展示 */ },
});
// pay() resolve → 支付成功 → fulfill()；reject(在 onPending 前) → "创建失败"
```

- 对外 API：`alipay.ts` 现导出 `startAlipayPayment(userId, serverId, product, endpoint, priceCny, { onPending, onPaid, onFailed })`，删除了旧的 `createAlipayPayment` / `startAlipayPolling`。
- `service` 字段改为 `product.alipay?.serviceId ?? product.name`（用 `alipay_service_id`，回退到商品名）。
- `buy.ts` 的支付宝分支改为调用该接口；QR 展示移入 `onPending`，履约/超时走 `onPaid`/`onFailed`。
- `database.ts` 新增支付宝写入路径（`setServerAlipay` + `createProduct`/`updateProduct` 现写入 alipay 字段）。⚠️ 命令层入口（`/setup alipay`、`/product` 的 alipay 选项）**尚未接线**，所以目前服务器/商品的支付宝配置仍需手工写库；这块是独立的待办（原「给 /setup 与 /product 增加支付宝支持」需求）。

> ⚠️ **依赖坑（已处理）**：SDK 经 `@solana/spl-token` 传递依赖 `bigint-buffer`，其预编译二进制在 **Node v22 上加载即段错误（SIGSEGV）**，会让 bot 启动崩溃。已用 `npm rebuild bigint-buffer` 修复，并在 `package.json` 加 `postinstall: npm rebuild bigint-buffer` 让全新安装也自动重建。若 bot 启动即 segfault，先跑 `npm rebuild bigint-buffer`。

**已实施收款端（方案 B：bot 进程内自托管 cashier，2026-06-05）：**
确认 `/execute` 即 bot 的收款入口（1.7.0 标准架构：买方=MoltsPayClient，卖方=持 RSA2 商户私钥、产出并签名 402 的 moltspay server，见 `payment-agent/docs/ALIPAY-RAIL.md`）。采用**方案 B**——bot 同进程内起一个 `MoltsPayServer` 充当收银台：

- `alipay/moltspay.services.json`：bot 商品 manifest。`provider.alipay` 复用现有商户（seller `2088641494699428`，**绝对路径**引用 `skills/video_gen/cert/` 的 RSA2 证书，未复制私钥）；`services` 为每个支付宝商品注册一条（`zen7-vip` ¥35 / `zen7-subscription` ¥0.50 / `test-video` ¥1），service id = 商品名，`input` 留空（避免缺参 400）。
- `src/services/alipayServer.ts`：`startAlipayServer()` 启动 cashier（端口 `ALIPAY_SERVER_PORT`，默认 8412），为每个 service 注册**空占位 handler**（履约在 bot 的 onPaid 发角色，server 不负责）；`getAlipayEndpoint()` 暴露本地 `/execute`。
- `src/index.ts`：启动时调用 `startAlipayServer()`（失败非致命，回退到 per-server 配置端点）。
- `src/commands/buy.ts`：支付宝端点优先用 `getAlipayEndpoint()`，回退 `server.alipayServiceEndpoint`。

验证：`MoltsPayServer` 起后 `POST /execute {service:"zen7-vip"}` → **402 + Payment-Needed**（商户签名挑战），未知 service → 404。`tsc`/`build`/编译产物冒烟均通过。

**运行时发现并修复（2026-06-05，重要）：**
- **双 `/execute` bug**：`MoltsPayClient.pay(serverUrl, …)` 内部会自己拼 `/execute`。若传入的 endpoint 已含 `/execute`（如 `http://host:8412/execute`），会变成 `/execute/execute` → 404 `Not found`，pay() 在 onPaymentPending 前快速抛错（Discord 表现为交互失败）。**已修复**：`alipay.ts` 用 `serviceEndpoint.replace(/\/+execute\/?$/i, '')` 取 base url 再传给 `pay()`。`getAlipayEndpoint()` 返回带 `/execute` 的串仍可用于 curl/health，buyer 侧会自动归一。
- **`SERVICE_PRICE_MISMATCH`（商户后台配置，非代码）**：修复后链路跑到支付宝网关，`zen7-vip`(¥35)/`zen7-subscription`(¥0.50) 报「服务价格不匹配」。原因：manifest 未给它们单独 `service_id`，默认用 `provider.alipay.service_id_default = API_0EA6DC4FC99A4DF7`，而该 service_id 在**支付宝商户后台注册单价为 ¥1.00**（test-video ¥1 因此能成）。要支持其它金额，需在支付宝开放平台为对应金额注册 service_id，并在 manifest 的 `services[].alipay.service_id` 指定。

**仍需按环境核对（非代码）：**
1. 商户后台「服务单价」需与 manifest 的 `alipay.price_cny` 一致，否则 `SERVICE_PRICE_MISMATCH`；
2. 商户证书路径（现绝对引用 video_gen 的 cert）在部署机上要可读；
3. 新增支付宝商品时，往 `alipay/moltspay.services.json` 加一条 service（id=商品名）即可。

> 注：早前列的「指 `alipay_service_endpoint` 到外部端点 / 用 `alipay_service_id` 映射」已被方案 B 取代——bot 自带收银台，端点指向自身，service id 用商品名。`alipay_service_id` 仍可选用作覆盖。

（注：早前「两系统互不相关、修复在 bot 侧自建 402」的判断已被澄清更新——`/execute` 即 bot 的收款端点，集成走 SDK；video_gen 只是当时错挂在 8402 的无关清单。）

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

# MoltsPay Discord Bot — 已知问题

记录当前已发现、尚未解决（或刚修复待观察）的问题。按严重程度排列。

---

## 1. MetaMask 桌面/网页版 deeplink 无法预填（未修复）

**状态：** 未修复 — 待定方案
**发现日期：** 2026-06-10
**影响：** 桌面端用户**无法**通过「🌐 MetaMask」按钮付款

### 现象
点击 `/buy` 生成的桌面 MetaMask 链接，例如：
```
https://portfolio.metamask.io/transfer?chain=8453&token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&to=0xb8d6f2441e8f8dfB6288A74Cf73804cDd0484E0C&amount=0.012
```
打开后收款地址 / 金额 / 代币 / 链**全部没有自动填入**。

### 根因（平台限制，非参数拼写错误）
- `portfolio.metamask.io/transfer` 是 MetaMask Portfolio 网页版自己的转账/跨链 UI，**不接受 URL 预填参数**。`chain` / `token` / `to` / `amount` 会被直接忽略。
- MetaMask 官方文档**没有**针对 Portfolio 网页转账的 deeplink/预填规范——发送流程要求手动选币、手填地址与金额。
- 因此「改 URL 格式」救不了这条桌面链接，是平台能力缺失。
- 同样的限制普遍适用于其它「🌐 网页」钱包按钮：Coinbase（`wallet.coinbase.com/send`）、Phantom / Solflare 网页版。桌面网页钱包普遍不支持「向任意地址转账」的 URL 预填。

### 唯一能预填的路径
MetaMask **手机端 deeplink**（`/buy` 里的 📱 按钮），EIP-681 标准，手机 App 内可自动带出地址与金额：
```
https://metamask.app.link/send/{token}@{chainId}/transfer?address={recipient}&uint256={amountUnits}
```

### 次生问题（更严重）
桌面用户点了网页按钮 → Portfolio 不预填 → 而 Discord 消息里**没有把收款地址 / 金额作为可复制文本展示**（地址只藏在 deeplink 里）。结果桌面用户**既没自动填、也无处复制 → 完全无法付款**。

代码位置：
- `src/utils/deeplinks.ts` — `getEVMWalletLinks()` 生成 `webUrl: https://portfolio.metamask.io/transfer?...`
- `src/commands/buy.ts` — `buildPaymentEmbed()` 只展示 Price / Chain / Expires / Status / Tip，**未展示可复制的收款地址与代币合约**。

### 候选修复方案（待实施）
1. **加二维码（推荐，通用）**：把 EIP-681 URI 渲染成二维码图片贴进 Embed，桌面用户用手机 MetaMask 扫码 → 手机端自动预填。`qrcode` 包目前在 `node_modules` 里（回退后未写进 `package.json`，需补一行依赖）。
2. **展示可复制文本**：在 Embed 里加「收款地址 + 精确金额 + 代币合约」字段，供桌面用户手动转账。
3.（可选）**移除误导性的桌面网页钱包按钮**，避免用户点了一脸懵。

> 建议 1 + 2 同时做：扫码付覆盖大多数人，地址/金额文本兜底，桌面/手机都走得通。

---

## 2. 单链商品点「Pay with USDC」交互崩溃（已修复，待线上观察）

**状态：** 已修复（2026-06-10），改动在本地 `main`、已 build + 重启生效
**影响范围：** 所有 `chains` 只配单条链的商品（10 个商品里 8 个），多链商品不受影响

### 现象
`/buy` 选单链商品（如 `test-video`、`zen7-subscription`）点「💎 Pay with USDC」→ Discord 显示 **"This interaction failed"**。

### 根因
单链商品在 `showChainSelection` 走「跳过选链」分支：对**同一个 interaction 先 `deferUpdate()` 再 `update()`** → Discord 抛 `InteractionAlreadyReplied`。多链路径用的是用户新点「选链按钮」那个全新交互，所以正常。

### 修复（`src/commands/buy.ts`）
- `showUsdcPayment`：按 `interaction.deferred || interaction.replied` 选 `editReply`（单链已 defer）/ `update`（多链全新交互）。
- 单链「无钱包」错误分支：`update` → `editReply`。
- 顺带修文案：订阅 Billing `${billingPeriod}ly` → `${billingPeriod}`（原显示 "monthlyly subscription"）。

---

## 背景：当前支付路径

2026-06-10 已将代码**回退到支付宝接入前**（`2a75a03` + cherry-pick 内存泄漏修复 `9b04b03`），**支付宝整套已移除**。当前仅 **USDC（链上）** 与 **信用卡（Coinbase Onramp）** 两条路径。信用卡需服务器设 `fiat-markup > 0` 且金额 ≥ $5。

支付宝相关代码完整保存在分支 `backup/alipay-revert-20260610`（commit `c42c700`），需要时可取回。

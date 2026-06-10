# 简报：支付宝 `Expected 402, got 404` 排查 + 迁移到 moltspay SDK

**日期**：2026-06-05　**范围**：moltspay-discordbot 支付宝支付路径

---

## 1. 问题
Discord `/buy` 选支付宝报错：`❌ 支付宝支付创建失败：Expected 402, got 404`。

## 2. 根因（已复现）
- 报错在旧 `alipay.ts` Step 0：`POST {endpoint} {service: product.name}`，期望 402，实得 404 即抛错。
- bot 发的 `service`=商品名（如 `zen7-vip`），而端点 `127.0.0.1:8402/execute` 上跑的是 **video_gen** 清单，只注册了 `ping`/`text-to-video`/`image-to-video` → 查无此 service → 业务层 404。
- 正向验证：`service=ping` 能正常返回 402。链路本身通（`/health`=200）。

## 3. 关键事实（按调查顺序澄清）
- **配置是手工灌库的**：`alipay_service_endpoint`、商品 `alipay_*` 字段都没有命令写入路径，是直接写进 `data/bot.db` 的。
- **架构定性**：`/execute` 端点本就是给本 bot 用的收款入口；集成应走官方 SDK。video_gen 只是当时错挂在 8402 的无关清单。
- **金额来源**：实际收款金额来自端点 service 的 `alipay.price_cny`，不是 bot 传的 priceCny。

## 4. zen7-vip「之前」到底怎么走的
- 配置：role 商品，5 USDC / ¥35 CNY，server `1472602423267819734`。
- **实际走的是 USDC 加密路径**（34 条记录全是 USDC；base 上 **2 笔 fulfilled** 成交）。该路径是**手写 `ethers` 链上轮询**（poller.ts），**不经过任何 SDK**。
- **支付宝路径从未成功发起**（0 条 alipay 记录）：点按钮即 Step 0 → 404 → 写库前抛错。
- 对照：唯一跑通支付宝的是 **test-video（¥1）**——3 paid + 1 fulfilled，有真实交易号。说明链路能成，差的是 zen7-vip 的「端点/service 没配对」。
- **结论**：迁移前整个 bot **零 SDK 使用**；三条支付路径（USDC / 信用卡 / 支付宝）历史上全是各自手写的。

## 5. 本次已做（代码）
迁移支付宝路径到 moltspay SDK：
- `src/services/alipay.ts`：**重写**，改用 `MoltsPayClient.pay(endpoint, service, {}, { rail:'alipay', timeoutMs, onPaymentPending })`；删除手写 fetch+`alipay-bot` CLI+轮询。新导出 `startAlipayPayment(...,{onPending,onPaid,onFailed})`。`service` 用 `alipay_service_id ?? product.name`。
- `src/commands/buy.ts`：支付宝分支改调新接口；QR 入 `onPending`，履约/超时走 `onPaid`/`onFailed`。
- `src/services/database.ts`：新增支付宝写入路径（`setServerAlipay` + create/update 商品 alipay 字段）。
- `package.json`：加 `postinstall: npm rebuild bigint-buffer`。
- 文档：更新 `DEV-AND-DEPLOY.md §13.3`。

**依赖坑（已修）**：SDK 经 `@solana/spl-token` 依赖 `bigint-buffer`，其预编译二进制在 **Node v22 加载即段错误（SIGSEGV）**，会让 bot 启动崩溃。已 `npm rebuild bigint-buffer` 修复并加 postinstall。

**验证**：`tsc --noEmit` ✅、`npm run build` ✅、运行时 require 迁移后模块加载 SDK 无段错误 ✅、无旧符号残留 ✅。

## 6. 仍待办（非本次范围）
1. **配置对齐（要点）**：SDK 不改变前提——`pay(endpoint, service)` 仍需端点注册了对应 service、金额/商户正确。当前 zen7-vip 仍指向 video_gen、`alipay_service_id` 为 NULL，**直接下单仍会 404**。需决定 bot 的收款端点 + 各商品 service/金额/商户，再对齐。
2. **命令入口未接线**：`/setup alipay`、`/product` 的支付宝选项尚未添加（DB 写入函数已就绪），目前配置仍需手工写库。
3. **未重启线上 bot**：改动需 `npm run build` 后重启生效。
4. USDC / 信用卡两条路径仍是手写 ethers，未评估是否迁 SDK。

# 本地测试服务处理说明（Alipay 进程内收银台）

> 适用于 `moltspay-discordbot` 的支付宝（alipay rail）本地联调。
> 这套是**机器人进程内的本地收银台**，非公网服务；和 `zen7` 的对外 HTTP 服务是两码事。

---

## 1. 架构总览

机器人进程启动时会同时拉起两个本地 HTTP 端口：

| 端口 | 用途 | 代码 | 协议 |
|---|---|---|---|
| **3402** | Discord webhook 服务 | `src/index.ts` `app.listen(webhookPort)` | Express |
| **8412** | **进程内支付宝收银台**（本说明主角） | `src/services/alipayServer.ts` `startAlipayServer()` | `MoltsPayServer`（POST `/execute`） |

端口可用环境变量覆盖：`ALIPAY_SERVER_PORT`（默认 `8412`）。

收银台地址：

```
http://127.0.0.1:8412/execute        # POST-only，x402 / HTTP 402 收款
```

服务 id 以 query 形式挂在资源标识上：`/execute?service=<id>`（这套 SDK 里 `?service=` 是合法且必需的）。

---

## 2. 启动链路

`src/index.ts:263` → `startAlipayServer()`（`src/services/alipayServer.ts`）：

1. 读 `ALIPAY_SERVER_PORT`（默认 8412）。
2. 读服务清单 `alipay/moltspay.services.json`（`MANIFEST_PATH = ../../alipay/moltspay.services.json`）。
3. `new MoltsPayServer(MANIFEST_PATH, { port })`，给每个 service 注册一个 **no-op handler**：
   ```ts
   server.skill(svc.id, async () => ({ ok: true }));
   ```
   收银台**只负责收款**；真正履约（发 Discord 角色）由 bot 在 `onPaid` 回调里做。
4. `server.listen(port)`，把 `endpoint = http://127.0.0.1:${port}/execute` 暴露给 `getAlipayEndpoint()`。
5. **非致命**：若启动失败（如商户证书缺失），`endpoint = null`，bot 回退到各服务器自配的 `server.alipayServiceEndpoint`。

---

## 3. 服务清单（`alipay/moltspay.services.json`）

provider 段包含支付宝商户信息：

```jsonc
"alipay": {
  "seller_id": "2088641494699428",
  "app_id":    "2021006150642142",
  "seller_name": "上海超响应数字科技有限公司",
  "service_id_default": "API_0EA6DC4FC99A4DF7",
  "private_key_path":        "/home/juhe0092/clawd/skills/video_gen/cert/ALIPAY_PRIVATE_KEY.txt",
  "alipay_public_key_path":  "/home/juhe0092/clawd/skills/video_gen/cert/ALIPAY_PUBLIC_KEY.txt",
  "gateway_url": "https://openapi.alipay.com/gateway.do",
  "sign_type":  "RSA2"
}
```

每个 service：`id` / `price`(USDC) / `alipay.price_cny`(实际人民币扣款) / `alipay.goods_name`。
现有测试商品：`zen7-vip`、`zen7-subscription`、`test-video`（均 `price_cny` 极小，便于真扣验证）。

---

## 4. 支付处理完整流程

用户在 Discord 点「支付宝支付」按钮 → `src/commands/buy.ts:showAlipayPayment`：

```
1. alipayEndpoint = getAlipayEndpoint() || server.alipayServiceEndpoint
   （优先进程内 8412 收银台，否则回退每服务器配置）
2. 校验 product.alipay 与 endpoint 都在，否则报 "Alipay not configured"
3. 显示「正在生成支付链接…」
4. startAlipayPayment(userId, serverId, product, alipayEndpoint, priceCny, handlers)
```

`src/services/alipay.ts:startAlipayPayment`：

```
service   = product.alipay.serviceId ?? product.name
serverUrl = endpoint 去掉尾部 /execute   // 防止拼成 /execute/execute → 404
client    = new MoltsPayClient({ alipaySessionId: `discord-${paymentId}` })  // 每笔独立 session
client.pay(serverUrl, service, {}, { rail:'alipay', timeoutMs, onPaymentPending, ... })
```

`MoltsPayClient.pay()` 内部：

```
打 ${serverUrl}/execute?service=${service}（POST）
→ 收银台返回 402 挑战
→ 驱动本地 alipay-bot CLI 链：
   ensure-cli(--version) → payment-intent → check-wallet → 402-buyer-pay
→ 拿到支付链接/二维码 → 触发 onPaymentPending
→ 轮询 402-query-payment-status 直到 paid → 触发 onPaid
```

回调侧：
- **onPaymentPending**：落库 `createPayment(status:'pending')`，清洗 URL（去掉 markdown `[..](..)` 尾部 `)`、中文标点），生成二维码 PNG（`~/.moltspay/alipay/qr_<id>.png`），在 Discord 渲染二维码 + 金额 + 有效期。
- **onPaid**：发放 Discord 角色 / 会员（真正履约），更新支付状态。

> ⚠️ URL 清洗很关键：`alipay-bot` 把链接打在 markdown `[文字](url)` 里，SDK 的正则会贪婪吞掉尾部 `)`，不清洗会导致二维码/链接 404。

---

## 5. 本地启动与测试

### 5.1 构建 + 跑机器人

```bash
cd ~/clawd/projects/moltspay-discordbot
npm run build                       # tsc → dist/
MOLTSPAY_ALIPAY_LOG=debug bash restart.sh
# restart.sh: fuser -k 3402/tcp 杀旧进程 → truncate bot.log → nohup node dist/index.js >> bot.log
```

启动成功日志：
```
✅ Webhook server listening on port 3402
[AlipayServer] cashier listening on http://127.0.0.1:8412 (N services: zen7-vip, ...)
```

dev 热重载：`npm run dev`（`tsx watch src/index.ts`）。

### 5.2 触发支付（端到端，会真实扣款）

Discord 里 `/buy` → 选商品 → 「支付宝支付」。选 `test-video`（¥1.00）等小额商品。
全流程时延参考：冷启动 pre-QR ~77s，缓存命中 ~48s（详见 `docs/ALIPAY-PROCESSING-TIME-ASSESSMENT-*.md`）。

### 5.3 安全探针（不扣款）

`scripts/probe-alipay-cli.sh [次数]` —— 在 SDK 同款过滤环境下测 `alipay-bot` 各步耗时：

```bash
bash scripts/probe-alipay-cli.sh 3
```

**只跑** `--version` / `check-wallet` / `payment-intent`，**绝不跑** `402-buyer-pay`（那会创建真实支付宝交易）。用于隔离 CLI 冷启动 vs 每步真实耗时。

---

## 6. 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| 收银台没起来，回退到外部 endpoint | 商户证书路径缺失（`private_key_path` / `alipay_public_key_path`）→ `startAlipayServer` 异常，`endpoint=null` |
| 链接拼成 `/execute/execute` → 404 | endpoint 存了带 `/execute` 的全路径；`startAlipayPayment` 已用正则 `replace(/\/+execute\/?$/i,'')` 去尾 |
| 二维码/链接 404 | `alipay-bot` 输出 markdown 链接，未清洗尾部 `)`/标点；用 `cleanUrl()` 处理 |
| `pkill -f "...dist..."` 把当前 shell 也杀了（exit 143/144） | 内联 pkill 自匹配命令行；改用脚本文件里的 pattern，或 `restart.sh` 的 `fuser -k 3402/tcp` |
| 端口冲突 | 改 `ALIPAY_SERVER_PORT`；webhook 固定 3402（restart.sh 用它做 kill） |
| 单笔 session 复用导致冲突 | 每笔支付都 `new MoltsPayClient`，`alipaySessionId = discord-<paymentId>` 保证唯一 |

---

## 7. 一句话总结

进程内收银台 = `http://127.0.0.1:8412/execute`（POST，`?service=<id>`），随 bot 一起起；
每个 service 是 no-op 占位，收款成功后由 bot 在 `onPaid` 发 Discord 角色；
联调用 Discord `/buy` 走端到端（真扣小额），用 `probe-alipay-cli.sh` 做不扣款的耗时探测。

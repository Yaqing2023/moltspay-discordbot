# MoltsPay Discord Bot — 文档索引

本目录收录 MoltsPay Discord Bot 的设计、实现、部署与运维文档。按用途分组如下。

## 🚀 上手 / 运维

| 文档 | 说明 |
|---|---|
| [DEV-AND-DEPLOY.md](./DEV-AND-DEPLOY.md) | **开发与部署文档**（最常用）。技术栈、架构、支付流程（EVM / Onramp / 支付宝）、环境变量、部署清单，以及 **§13 已知问题**（内存泄漏、支付宝履约、支付宝 `Expected 402, got 404`）。 |
| [LAUNCH-TODO.md](./LAUNCH-TODO.md) | 上线待办与状态（top.gg 审核、上线后步骤、相关链接）。 |

## 🏗️ 设计 / 规划

| 文档 | 说明 |
|---|---|
| [DESIGN.md](./DESIGN.md) | **总体设计**（最全，1000+ 行）。Overview、架构、商品模型（服务器变现）等。 |
| [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) | 实现计划，按 Phase 拆分的开发路线与进度。 |
| [SUBSCRIPTION-PLAN.md](./SUBSCRIPTION-PLAN.md) | 月度订阅方案：数据模型变更、命令、计费逻辑。 |
| [DIGITAL-SERVICE-PLAN.md](./DIGITAL-SERVICE-PLAN.md) | 数字服务接入方案：概念、商品类型、集成设计。 |

## 📣 上架 / 文案

| 文档 | 说明 |
|---|---|
| [APP-LISTING.md](./APP-LISTING.md) | 应用上架文案（top.gg / discord.bots.gg 等的简介、详述、标签）。 |

---

## 快速指引

- **要部署 / 排查线上问题** → 先看 [DEV-AND-DEPLOY.md](./DEV-AND-DEPLOY.md)，已知问题集中在该文档 §13。
- **要理解整体架构与商品模型** → 看 [DESIGN.md](./DESIGN.md)。
- **支付宝 `Expected 402, got 404` 问题** → 见 [DEV-AND-DEPLOY.md §13.3](./DEV-AND-DEPLOY.md)。该问题已定性为「bot 与 `payment-agent/video_gen` 是两套独立系统、bot 的 402 收款端点接错对象」，修复方向待确认，**未实施代码改动**。

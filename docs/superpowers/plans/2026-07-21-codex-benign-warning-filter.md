# Codex 无害告警展示过滤实施方案

> **For agentic workers:** REQUIRED: 在当前会话按测试先行方式执行；当前项目不使用 sub-agent，未经用户要求不提交或推送。

**Goal:** 从 Web UI 实时会话详情中移除两类已确认无害的 Codex 告警，同时保留原始进度事件和服务日志。

**Architecture:** 新增纯函数识别并过滤 Web 展示数据中的目标 `stderr` 行，在 Web Server 的频道状态响应边界调用。采集、追踪和日志读取链路保持不变。

**Tech Stack:** Bun、TypeScript、原生 Web API、Bun Test

---

## Task 1: 告警识别与展示副本

**Files:**
- Create: `src/web/stderr-display.ts`
- Create: `tests/web-stderr-display.test.ts`

- [x] 增加失败测试，覆盖两类无害告警、混合文本、相似告警和原始对象不变。
- [x] 运行 `bun test tests/web-stderr-display.test.ts`，确认因模块不存在而失败。
- [x] 实现按行过滤和频道状态展示副本函数。
- [x] 再次运行定向测试并确认通过。

## Task 2: Web API 接入

**Files:**
- Modify: `src/web-server.ts`
- Modify: `tests/web-server.test.ts`

- [x] 增加失败测试，要求频道接口隐藏目标告警且日志接口保留原文。
- [x] 运行 `bun test tests/web-server.test.ts`，确认频道接口断言失败。
- [x] 在 `/api/status`、`/api/channels` 和 `/api/overview` 的频道数据出口应用展示过滤。
- [x] 再次运行 Web Server 定向测试并确认通过。

## Task 3: 完整验收

- [x] 运行 `bun test`、`bun run typecheck`、`bun run build` 和 `git diff --check`。
- [x] 使用项目内 `config.yaml` 重启后台服务。
- [x] 检查 `/api/channels`、`/api/logs`、服务状态和飞书频道连接。
- [x] 保持改动未提交，等待用户明确要求后再提交或推送。

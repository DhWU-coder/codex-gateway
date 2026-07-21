# Fast 与 Verbosity 默认值展示实施方案

> **For agentic workers:** REQUIRED: 按测试先行方式执行；当前项目不使用 sub-agent。

**Goal:** 在 Web UI 中同时显示 Codex CLI 的 Fast 和 Verbosity 实际默认值。

**Architecture:** 复用模型目录 app-server 会话中的 `config/read`，把 `service_tier` 转换为 Fast 布尔默认值，并与 Verbosity 一起经 `/api/models` 传给页面。页面统一生成全局默认与账号继承文案，保存逻辑保持不变。

**Tech Stack:** Bun、TypeScript、Codex app-server、原生 HTML/CSS/JavaScript

---

## Task 1: Codex 默认值读取

**Files:**
- Modify: `src/codex/model-catalog.ts`
- Modify: `tests/codex-model-catalog.test.ts`

- [x] 扩展 app-server 协议测试，覆盖 `config/read` 和 Verbosity 空值回退。
- [x] 让模型目录缓存同时提供模型列表和 Verbosity 默认值。
- [x] 扩展失败测试，覆盖 `service_tier: fast`、普通 service tier 和配置读取失败。
- [x] 在共享运行默认值中加入 Fast 布尔状态。
- [x] 验证模型目录测试通过。

## Task 2: API 与页面展示

**Files:**
- Modify: `src/service/daemon.ts`
- Modify: `src/web-server.ts`
- Modify: `src/web/page.ts`
- Modify: `tests/service-daemon.test.ts`
- Modify: `tests/web-server.test.ts`

- [x] 在 `/api/models` 返回 Verbosity 默认设置。
- [x] 更新全局默认和账号继承的 Verbosity 编辑态、只读态文字。
- [x] 扩展 API 和页面失败测试，要求返回并使用 Fast 默认值。
- [x] 更新全局默认和账号继承的 Fast 编辑态、只读态文字。
- [x] 验证相关测试通过。

## Task 3: 完整验收

- [x] 运行 `bun test`、`bun run typecheck`、`bun run build` 和 `git diff --check`。
- [x] 重启服务并验证全局、账号以及窄屏状态。
- [x] 保持改动未提交，等待用户明确要求后再提交或推送。

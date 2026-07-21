# Usage Pending Settlement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不估算 Token 的前提下，让管理台准确展示执行中待入账状态，并在任务完成后自动更新用量。

**Architecture:** 用量 API 组合已有 JSONL 统计与频道活跃会话数；前端渲染待入账提示，并复用两秒轮询刷新当前可见的用量页。Runner 的成功后落盘逻辑保持不变，通过失败与中断测试补齐行为边界。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、`bun:test`

---

### Task 1: 锁定用量 API 与页面行为

**Files:**
- Modify: `tests/web-server.test.ts`

- [x] 添加 `/api/usage` 返回 `activeSessions` 的断言。
- [x] 添加页面包含待入账区域、提示文本和用量页轮询逻辑的断言。
- [x] 运行 `bun test tests/web-server.test.ts`，确认新增断言先失败。

### Task 2: 实现待入账状态与自动刷新

**Files:**
- Modify: `src/web-server.ts`
- Modify: `src/web/page.ts`

- [x] 在 `/api/usage` 响应中附加频道活跃会话总数。
- [x] 在用量页增加待入账提示区域并按活跃会话数显隐。
- [x] 在两秒轮询中刷新当前可见的用量页，并防止旧请求覆盖新结果。
- [x] 运行 `bun test tests/web-server.test.ts`，确认页面与接口测试通过。

### Task 3: 补齐日志写入边界测试

**Files:**
- Modify: `src/codex/json-events.ts`
- Modify: `tests/codex-runner.test.ts`

- [x] 使用当前 Codex CLI 的真实事件形状测试缺少 `total_tokens` 的场景。
- [x] 在总量缺失时使用真实输入与输出字段计算必填总量。
- [x] 添加 Codex CLI 非零退出时即使输出 usage 也不落盘的测试。
- [x] 添加 AbortSignal 中断时不落盘的测试。
- [x] 运行 `bun test tests/codex-runner.test.ts`，确认成功、失败和中断场景全部通过。

### Task 4: 完整验证

**Files:**
- Verify: `src/web-server.ts`
- Verify: `src/web/page.ts`
- Verify: `tests/web-server.test.ts`
- Verify: `tests/codex-runner.test.ts`

- [x] 运行 `bun test`。
- [x] 运行 `bun run typecheck`。
- [x] 运行 `bun run build`。
- [x] 重启 Gateway，并验证 `/api/usage` 与管理台实际展示。

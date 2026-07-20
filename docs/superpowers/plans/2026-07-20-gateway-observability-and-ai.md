# Codex Gateway 可观测性与 AI 增强 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development. User instructions override subagent, worktree and commit guidance: work in the current checkout, do not use subagents, and do not commit or push unless explicitly requested.

**Goal:** 补齐 Codex 流式进度、飞书消息追踪、AI 总结增强、历史治理和可操作的 Web UI。

**Architecture:** Codex runner 产生统一进度事件，router 负责请求级回调隔离，Feishu channel 维护有界运行状态，ChannelManager 向本机 Web API 暴露受控操作。历史存储继续使用 JSON/JSONL，但改为原子元数据写入和可恢复索引。

**Tech Stack:** TypeScript、Bun、Codex CLI JSONL、飞书 Node SDK、原生 HTML/CSS/JavaScript

---

## Chunk 1: 流式事件与追踪

### Task 1: Codex JSONL 进度

**Files:**
- Modify: `tests/codex-runner.test.ts`
- Modify: `src/codex/json-events.ts`
- Modify: `src/codex/runner.ts`

- [ ] 先写 `item.started/item.completed` 和分块 JSONL 的失败测试。
- [ ] 实现统一进度事件解析与 runner 的逐行回调。
- [ ] 验证最终文本、session ID 和 usage 解析保持兼容。

### Task 2: 消息追踪和请求级进度

**Files:**
- Create: `tests/feishu-message-tracker.test.ts`
- Create: `src/feishu/message-tracker.ts`
- Modify: `tests/session-router.test.ts`
- Modify: `src/session/router.ts`

- [ ] 先写有界消息、阶段、耗时、事件和附件的失败测试。
- [ ] 实现消息追踪器。
- [ ] 先写 router 请求级进度绑定测试，再接入 `onProgress`。

## Chunk 2: 历史与 AI

### Task 3: 历史存储治理

**Files:**
- Modify: `tests/session-history.test.ts`
- Modify: `src/session/history.ts`
- Modify: `tests/config.test.ts`
- Modify: `src/config.ts`
- Modify: `config-example.yaml`

- [ ] 先写索引恢复、保留策略、消息计数和批量 fork 的失败测试。
- [ ] 实现原子 JSON 写、索引恢复、直接计数和归档清理。
- [ ] 增加兼容默认值的 history/summary 配置。

### Task 4: AI 总结增强

**Files:**
- Modify: `tests/session-router.test.ts`
- Modify: `src/session/router.ts`
- Modify: `tests/feishu-channel.test.ts`
- Modify: `src/feishu/channel.ts`

- [ ] 先写模型和 prompt 版本缓存、强制刷新及错误隔离测试。
- [ ] 实现 `/summary [N] [--refresh]` 和增强缓存。
- [ ] 保证批量总结部分失败仍返回其余结果。

## Chunk 3: 飞书运行体验

### Task 5: reaction、连接测试和防重

**Files:**
- Create: `tests/feishu-client.test.ts`
- Modify: `src/feishu/client.ts`
- Modify: `src/feishu/send.ts`
- Modify: `tests/feishu-channel.test.ts`
- Modify: `src/feishu/channel.ts`

- [ ] 先写 Typing reaction SDK 适配器测试。
- [ ] 接入处理生命周期，并保证失败不影响主任务。
- [ ] 增加连接测试、TTL 防重和无效文件反馈测试与实现。

### Task 6: 进度回复合并

**Files:**
- Create: `tests/feishu-output-relay.test.ts`
- Create: `src/feishu/output-relay.ts`
- Modify: `tests/feishu-channel.test.ts`
- Modify: `src/feishu/channel.ts`

- [ ] 先写静默合并、flush 和 dispose 测试。
- [ ] 接入 `sendProgressReplies`，避免与最终文本重复。

## Chunk 4: Web UI

### Task 7: ChannelManager 操作 API

**Files:**
- Modify: `tests/channel-manager.test.ts`
- Modify: `src/channel-manager.ts`
- Modify: `src/service/daemon.ts`

- [ ] 先写运行配置、连接测试、归档查询和摘要操作测试。
- [ ] 实现按 channel ID 委托的受控操作。

### Task 8: 监控 API 和页面

**Files:**
- Modify: `tests/web-server.test.ts`
- Modify: `src/web-server.ts`

- [ ] 先写操作路由、参数校验和监控页面结构测试。
- [ ] 实现连接测试、运行配置、归档和摘要 API。
- [ ] 重做响应式监控页面，展示频道、最近 session、时间线和归档摘要。

## Chunk 5: 文档与验证

### Task 9: 使用说明与完整验证

**Files:**
- Modify: `README.md`
- Modify: `tests/readme.test.ts`

- [ ] 更新配置、飞书命令、AI 总结和 Web UI 说明。
- [ ] 运行 `bun test`。
- [ ] 运行 `bun run typecheck`。
- [ ] 运行 `bun run build`。
- [ ] 运行 `git diff --check` 并检查工作区差异。

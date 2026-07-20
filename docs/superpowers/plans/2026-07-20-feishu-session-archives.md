# 飞书多 Session 归档 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Codex Gateway 增加可归档、查看、恢复、fork 和摘要的飞书多 session 管理。

**Architecture:** 将 `SessionHistoryStore` 从单文件模型升级为归档索引模型，并由 `CodexSessionRouter` 暴露会话查询与切换 API。飞书频道只负责解析命令和格式化回复，摘要仍复用现有 Codex runner。

**Tech Stack:** TypeScript、Bun、Codex CLI、JSON/JSONL 本地存储

---

## Chunk 1: 归档存储

### Task 1: 建立多归档数据模型

**Files:**
- Create: `tests/session-history.test.ts`
- Modify: `src/session/history.ts`

- [x] 编写创建多个归档、维护当前指针和按时间列出归档的失败测试。
- [x] 运行 `bun test tests/session-history.test.ts`，确认因归档 API 缺失而失败。
- [x] 实现归档元数据、索引、当前指针、消息读写和预览。
- [x] 再次运行测试并确认通过。

### Task 2: 增加迁移、恢复、fork 与摘要缓存

**Files:**
- Modify: `tests/session-history.test.ts`
- Modify: `src/session/history.ts`

- [x] 编写旧数据迁移、恢复、fork 和摘要缓存失效的失败测试。
- [x] 运行目标测试并确认预期失败。
- [x] 实现旧目录迁移、归档切换、消息复制及 `summary.json` 读写。
- [x] 再次运行存储测试并确认通过。

## Chunk 2: 路由能力

### Task 3: 接入归档生命周期

**Files:**
- Modify: `tests/session-router.test.ts`
- Modify: `src/session/router.ts`

- [x] 编写 `/new` 对应的新归档保留旧历史、恢复原生 session 和 fork 上下文的失败测试。
- [x] 运行路由测试并确认预期失败。
- [x] 改造消息队列持有归档元数据，并实现列表、详情、恢复、fork API。
- [x] 再次运行路由测试并确认通过。

### Task 4: 接入 session 摘要

**Files:**
- Modify: `tests/session-router.test.ts`
- Modify: `src/session/router.ts`

- [x] 编写摘要生成、解析和缓存复用的失败测试。
- [x] 运行目标测试并确认预期失败。
- [x] 实现摘要 prompt、容错解析和最多 5 个并发任务。
- [x] 再次运行路由测试并确认通过。

## Chunk 3: 飞书命令与文档

### Task 5: 补齐飞书命令

**Files:**
- Modify: `tests/feishu-channel.test.ts`
- Modify: `src/feishu/channel.ts`

- [x] 编写 `/sessions`、`/session`、`/resume`、`/fork`、`--summary` 和完整 `/status` 的失败测试。
- [x] 运行频道测试并确认预期失败。
- [x] 扩展 router 接口、命令解析、命令处理和回复格式化。
- [x] 再次运行频道测试并确认通过。

### Task 6: 更新说明并完成回归验证

**Files:**
- Modify: `README.md`
- Modify: `tests/readme.test.ts`

- [x] 编写 README 命令说明的失败测试。
- [x] 更新 README 的会话管理说明。
- [x] 运行 `bun test`。
- [x] 运行 `bun run typecheck`。
- [x] 运行 `bun run build`。
- [x] 检查 `git diff --check` 和工作区差异，确保没有覆盖既有改动。

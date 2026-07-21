# Feishu Session Runtime Commands Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development only when repository instructions permit subagents; otherwise execute locally. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增飞书 `/model`、`/effort` 与 `/fast` 命令，在当前 session 内持久化并应用 Codex 运行参数。

**Architecture:** Channel 负责命令解析、动态模型目录查询和能力校验，Session Router 负责当前归档运行参数的持久化更新。Daemon 创建单例模型目录并同时注入 Channel Manager 与 Web UI，避免重复进程和不一致缓存。

**Tech Stack:** Bun、TypeScript、Codex app-server 模型目录、现有飞书 Channel 与 SessionHistoryStore。

---

### Task 1: Session Router 运行参数更新

**Files:**
- Modify: `src/session/router.ts`
- Test: `tests/session-router.test.ts`

- [ ] 写入当前 session 更新与运行中拒绝的失败测试。
- [ ] 运行定向测试并确认按预期失败。
- [ ] 实现持久化更新接口和结果类型。
- [ ] 运行定向测试并确认通过。

### Task 2: 飞书命令和模型能力校验

**Files:**
- Modify: `src/feishu/channel.ts`
- Test: `tests/feishu-channel.test.ts`

- [ ] 写入模型、Effort、Fast 查询、列表、切换、默认恢复与错误分支测试。
- [ ] 运行定向测试并确认按预期失败。
- [ ] 扩展命令联合类型、解析器和处理器。
- [ ] 使用模型目录校验模型、Effort 和 Fast 能力。
- [ ] 扩展 `/status` 输出。
- [ ] 运行定向测试并确认通过。

### Task 3: 共享模型目录接线

**Files:**
- Modify: `src/channel-manager.ts`
- Modify: `src/service/daemon.ts`
- Test: `tests/channel-manager.test.ts`
- Test: `tests/service-daemon.test.ts`

- [ ] 写入 provider 传递与共享实例的失败测试。
- [ ] 运行定向测试并确认按预期失败。
- [ ] 扩展 Manager 与默认 Channel 工厂参数。
- [ ] 调整 Daemon 创建顺序并复用同一目录实例。
- [ ] 运行定向测试并确认通过。

### Task 4: 文档与完整验证

**Files:**
- Modify: `README.md`

- [ ] 记录全部命令、session 作用域、校验和恢复默认语义。
- [ ] 运行类型检查、完整测试和构建。
- [ ] 重启 Gateway 并检查频道连接状态。

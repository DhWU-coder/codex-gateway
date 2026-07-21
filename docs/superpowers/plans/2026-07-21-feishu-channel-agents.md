# Feishu Channel AGENTS.md Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available and permitted by repository instructions) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个飞书账户创建、编辑并按消息动态注入独立的 `AGENTS.md`。

**Architecture:** 新增专职文件存储模块，配置加载阶段推导固定路径，Channel 负责生命周期和 Web 管理入口，Session Router 每次执行时读取最新内容，Runner 通过 Codex CLI 的 `developer_instructions` 注入。全局与项目级 `AGENTS.md` 始终交给 Codex 原生机制处理。

**Tech Stack:** Bun、TypeScript、Node 文件系统 API、Codex CLI、现有原生 HTML/CSS/JavaScript Web UI。

---

## Chunk 1: 存储与命令注入

### Task 1: 账户指令文件存储

**Files:**
- Create: `src/feishu/instructions.ts`
- Modify: `src/paths.ts`
- Modify: `src/config.ts`
- Test: `tests/feishu-instructions.test.ts`
- Test: `tests/config.test.ts`

- [ ] 写入路径推导、空文件创建、读写、大小限制和指令包装的失败测试。
- [ ] 运行定向测试，确认因模块或行为缺失而失败。
- [ ] 实现固定路径推导和文件存储模块。
- [ ] 在账户规范化时写入派生的 `instructionsPath`。
- [ ] 运行定向测试，确认通过。

### Task 2: Codex Runner 与 Session Router 注入

**Files:**
- Modify: `src/codex/runner.ts`
- Modify: `src/session/router.ts`
- Test: `tests/codex-runner.test.ts`
- Test: `tests/session-router.test.ts`

- [ ] 写入 `developer_instructions` 命令参数和逐次读取行为的失败测试。
- [ ] 运行定向测试，确认失败原因正确。
- [ ] 扩展 Runner 输入并生成 `-c developer_instructions=...` 参数。
- [ ] 扩展 Router，在每次新会话或续接会话执行前调用 provider。
- [ ] 运行定向测试，确认通过。

## Chunk 2: Channel 与 Web 管理

### Task 3: Channel 生命周期和管理接口

**Files:**
- Modify: `src/feishu/channel.ts`
- Modify: `src/channel-manager.ts`
- Test: `tests/feishu-channel.test.ts`
- Test: `tests/channel-manager.test.ts`

- [ ] 写入启用、禁用账户均补建空文件，以及读取保存接口的失败测试。
- [ ] 运行定向测试，确认失败原因正确。
- [ ] 在 Channel 启动前确保文件存在，并将 provider 传给 Router。
- [ ] 在 Channel Manager 暴露读取和保存能力。
- [ ] 运行定向测试，确认通过。

### Task 4: Web API 与编辑器

**Files:**
- Modify: `src/web-server.ts`
- Modify: `src/web/page.ts`
- Test: `tests/web-server.test.ts`

- [ ] 写入 GET/PUT API、输入校验和页面控件的失败测试。
- [ ] 运行定向测试，确认失败原因正确。
- [ ] 实现频道指令 API。
- [ ] 实现账户卡片入口和 Markdown 编辑对话框。
- [ ] 运行定向测试，确认通过。

## Chunk 3: 文档与验证

### Task 5: 使用说明和端到端验证

**Files:**
- Modify: `README.md`

- [ ] 记录路径、空文件语义、优先级和生效时机。
- [ ] 运行 `bun test` 和类型检查。
- [ ] 重启 Gateway 服务。
- [ ] 验证两个现有飞书账户的 `AGENTS.md` 均存在且为空。
- [ ] 验证服务状态和 Web API 正常。


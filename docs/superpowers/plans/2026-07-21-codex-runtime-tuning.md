# Codex Runtime Tuning Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为全局和飞书账号增加 Effort、Fast、Verbosity 配置，并让新会话按模型能力使用这些设置。

**Architecture:** 模型目录提供能力元数据，配置层计算全局与账号有效值，SessionRouter 将设置快照到 session 元数据，Runner 统一转换为 Codex CLI 参数。Web UI 使用结构化控件编辑并保持继承语义。

**Tech Stack:** Bun、TypeScript、YAML Document API、原生 HTML/CSS/JavaScript、Playwright

---

## Chunk 1: 配置、模型能力与 CLI

### Task 1: 扩展模型能力目录

**Files:**
- Modify: `src/codex/model-catalog.ts`
- Modify: `tests/codex-model-catalog.test.ts`

- [x] **Step 1: 写失败测试**

断言目录保留支持的 Effort、默认 Effort 和 Fast 能力，并过滤非法值。

- [x] **Step 2: 验证测试按预期失败**

Run: `bun test tests/codex-model-catalog.test.ts`

- [x] **Step 3: 实现能力解析**

扩展 `CodexModelOption`，从 app-server 响应规范化能力字段。

- [x] **Step 4: 验证测试通过**

Run: `bun test tests/codex-model-catalog.test.ts`

### Task 2: 配置继承和 CLI 参数

**Files:**
- Modify: `src/config.ts`
- Modify: `src/codex/runner.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/codex-runner.test.ts`

- [x] **Step 1: 写失败测试**

覆盖全局字段、账号继承、账号 `fast: false` 覆盖，以及 CLI 参数顺序。

- [x] **Step 2: 验证测试按预期失败**

Run: `bun test tests/config.test.ts tests/codex-runner.test.ts`

- [x] **Step 3: 实现类型、校验、继承与参数映射**

新增 `CodexReasoningEffort`、`CodexVerbosity` 和可选 Fast，并将有效值传入 Runner。

- [x] **Step 4: 验证测试通过**

Run: `bun test tests/config.test.ts tests/codex-runner.test.ts`

## Chunk 2: 会话快照和热更新

### Task 3: 保存会话运行设置

**Files:**
- Modify: `src/session/history.ts`
- Modify: `src/session/router.ts`
- Modify: `tests/session-router.test.ts`
- Modify: `tests/session-history.test.ts`

- [x] **Step 1: 写失败测试**

断言旧 session 保留运行设置，新 session 使用更新设置，历史元数据兼容缺失字段。

- [x] **Step 2: 验证测试按预期失败**

Run: `bun test tests/session-router.test.ts tests/session-history.test.ts`

- [x] **Step 3: 实现 session 快照**

扩展 session 默认值、元数据、Router 运行参数和默认配置更新接口。

- [x] **Step 4: 验证测试通过**

Run: `bun test tests/session-router.test.ts tests/session-history.test.ts`

### Task 4: 频道热更新

**Files:**
- Modify: `src/channel-manager.ts`
- Modify: `src/feishu/channel.ts`
- Modify: `tests/channel-manager.test.ts`
- Modify: `tests/feishu-channel.test.ts`

- [x] **Step 1: 写失败测试**

断言三个设置变化不重建飞书频道，并转发给 SessionRouter。

- [x] **Step 2: 验证测试按预期失败**

Run: `bun test tests/channel-manager.test.ts tests/feishu-channel.test.ts`

- [x] **Step 3: 实现热更新接口**

扩展 ManagedChannel、FeishuChannel 和 Router 更新逻辑。

- [x] **Step 4: 验证测试通过**

Run: `bun test tests/channel-manager.test.ts tests/feishu-channel.test.ts`

## Chunk 3: 配置 API 与 Web UI

### Task 5: 配置编辑与 API

**Files:**
- Modify: `src/web/config-editor.ts`
- Modify: `src/web-server.ts`
- Modify: `tests/web-config-editor.test.ts`
- Modify: `tests/web-server.test.ts`

- [x] **Step 1: 写失败测试**

覆盖全局保存/删除、账号继承/覆盖、非法值和 API 返回。

- [x] **Step 2: 验证测试按预期失败**

Run: `bun test tests/web-config-editor.test.ts tests/web-server.test.ts`

- [x] **Step 3: 实现配置读写与 API**

在现有 Codex 配置端点和飞书账号端点中扩展字段，继续保留注释和 Secret。

- [x] **Step 4: 验证测试通过**

Run: `bun test tests/web-config-editor.test.ts tests/web-server.test.ts`

### Task 6: Web UI 控件

**Files:**
- Modify: `src/web/page.ts`
- Modify: `tests/web-server.test.ts`

- [x] **Step 1: 写失败页面测试**

断言全局和账号控件、继承选项、模型能力联动与不兼容提示存在。

- [x] **Step 2: 验证测试按预期失败**

Run: `bun test tests/web-server.test.ts`

- [x] **Step 3: 实现页面交互**

增加稳定尺寸的选择器和 Fast 三态控件，保存时发送结构化值。

- [x] **Step 4: 验证测试通过**

Run: `bun test tests/web-server.test.ts`

## Chunk 4: 文档和验证

### Task 7: 更新文档并完整验收

**Files:**
- Modify: `README.md`
- Modify: `config-example.yaml`

- [x] **Step 1: 更新配置和继承说明**

- [x] **Step 2: 运行完整测试与构建**

Run: `bun test && bun run typecheck && bun run build && git diff --check`

- [x] **Step 3: 浏览器验收**

重启后台服务，用 Playwright 验证桌面/移动端、浅色/深色主题、模型能力联动、自由选择、继承、取消和保存。

- [x] **Step 4: 保持工作区未提交**

不执行 git add、commit 或 push，仅汇报改动和验证结果。

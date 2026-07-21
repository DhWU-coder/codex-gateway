# Codex Gateway Web 模型配置 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Project policy forbids subagents, worktrees, and Git commits unless the user explicitly requests them. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让全局 Codex 模型和飞书账号模型都能通过支持自由输入与动态下拉选择的 Web 控件配置，并对新会话无中断生效。

**Architecture:** 新增独立的 Codex app-server 模型目录客户端和 `GET /api/models`。配置编辑器分别原子修改 `codex.model` 与账号 `model`，ChannelManager 将有效模型热更新到 SessionRouter，浏览器使用复用的原生组合输入框完成选择和输入。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、yaml、Bun test、Playwright CLI。

---

## Chunk 1: 模型目录与配置持久化

### Task 1: Codex CLI 模型目录

**Files:**
- Create: `src/codex/model-catalog.ts`
- Create: `tests/codex-model-catalog.test.ts`

- [x] **Step 1: 写失败测试**

覆盖 app-server 初始化握手、`model/list` 请求、模型字段归一化、默认模型排序、缓存复用、非法 JSON、子进程退出和超时。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test tests/codex-model-catalog.test.ts`

Expected: FAIL，因为模型目录模块尚不存在。

- [x] **Step 3: 实现最小模型目录客户端**

使用 `node:child_process` 和 `node:readline` 启动 `<codex.command> app-server --stdio`，完成 JSONL 协议握手并请求 `model/list`。导出可注入超时和进程启动器的读取函数，以及带 TTL 的目录实例。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test tests/codex-model-catalog.test.ts`

Expected: PASS。

### Task 2: 全局与账号模型配置编辑器

**Files:**
- Modify: `src/web/config-editor.ts`
- Modify: `tests/web-config-editor.test.ts`

- [x] **Step 1: 写失败测试**

覆盖全局模型读取、写入、留空删除、YAML 注释保留，以及账号模型写入、留空删除和请求未提供字段时保留旧值。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test tests/web-config-editor.test.ts`

Expected: FAIL，因为全局编辑函数不存在且账号保存忽略模型输入。

- [x] **Step 3: 实现配置读写**

新增 `getCodexModelEditorState` 和 `saveCodexModelEditorState`。扩展 `normalizeSavedAccount`，仅在请求明确包含 `model` 时写入或删除字段。复用现有原子写入函数。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test tests/web-config-editor.test.ts`

Expected: PASS。

## Chunk 2: API 与模型热更新

### Task 3: Web 模型与全局配置 API

**Files:**
- Modify: `src/web-server.ts`
- Modify: `src/service/daemon.ts`
- Modify: `tests/web-server.test.ts`
- Modify: `tests/service-daemon.test.ts`

- [x] **Step 1: 写失败 API 测试**

覆盖 `GET /api/models` 成功和失败、`GET /api/codex-config`、`POST /api/codex-config`、非法请求体与配置路径不可用。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test tests/web-server.test.ts tests/service-daemon.test.ts`

Expected: FAIL，因为新路由和模型目录依赖尚未接入。

- [x] **Step 3: 实现 API 与依赖注入**

扩展 WebServerOptions 注入模型目录 provider。Daemon 使用当前 `codex.command` 创建缓存目录实例。新增模型列表和 Codex 模型配置路由，错误返回结构化 JSON。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test tests/web-server.test.ts tests/service-daemon.test.ts`

Expected: PASS。

### Task 4: 新旧会话边界清晰的模型热更新

**Files:**
- Modify: `src/channel-manager.ts`
- Modify: `src/feishu/channel.ts`
- Modify: `src/session/router.ts`
- Modify: `tests/channel-manager.test.ts`
- Modify: `tests/feishu-channel.test.ts`
- Modify: `tests/session-router.test.ts`

- [x] **Step 1: 写失败测试**

覆盖模型变化不重建频道、Channel 将模型传给 Router、已有 session 保留原模型、`/new` 使用新模型，以及摘要模型没有显式覆盖时使用新默认模型。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test tests/channel-manager.test.ts tests/feishu-channel.test.ts tests/session-router.test.ts`

Expected: FAIL，因为模型仍被归类为非热字段。

- [x] **Step 3: 实现模型热更新**

扩展 ManagedChannel 和 FeishuRouterLike 的更新接口。ChannelManager 不再忽略 `model`，FeishuChannel 更新有效账号模型，SessionRouter 更新默认模型。Runner 输入优先使用 session 元数据模型。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test tests/channel-manager.test.ts tests/feishu-channel.test.ts tests/session-router.test.ts`

Expected: PASS。

## Chunk 3: Web 组合输入框与文档

### Task 5: 两处模型组合输入框

**Files:**
- Modify: `src/web/page.ts`
- Modify: `tests/web-server.test.ts`

- [x] **Step 1: 写失败页面测试**

断言配置页存在 Codex 模型编辑操作，频道账号模型不再强制只读，页面包含模型目录 API、组合输入框菜单、键盘交互和继承提示。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test tests/web-server.test.ts`

Expected: FAIL，因为页面还没有模型编辑与组合输入框。

- [x] **Step 3: 实现组合输入框和保存交互**

增加稳定尺寸的组合输入框样式和原生 JavaScript 控件。进入页面时并行加载模型目录；全局配置编辑写入 `/api/codex-config`；账号编辑继续写入 `/api/feishu-config`。目录失败时显示提示但保留输入。

- [x] **Step 4: 运行页面测试并确认通过**

Run: `bun test tests/web-server.test.ts`

Expected: PASS。

### Task 6: README 与完整验证

**Files:**
- Modify: `README.md`

- [x] **Step 1: 更新说明**

说明全局模型和账号模型均可在 Web UI 编辑、账号空值继承全局、下拉来自 Codex CLI，以及新模型从新会话开始生效。

- [x] **Step 2: 运行完整自动化验证**

Run: `bun test`

Expected: 全部测试通过。

Run: `bun run typecheck`

Expected: 退出码 0。

Run: `bun run build`

Expected: 退出码 0。

Run: `git diff --check`

Expected: 无输出。

- [x] **Step 3: 浏览器验证**

启动或重启 `codex-gateway`，使用 Playwright 在桌面和移动尺寸检查浅色、深色主题，验证两处输入、下拉选择、自由输入、取消、保存、账号继承和错误降级，确认没有溢出或重叠。

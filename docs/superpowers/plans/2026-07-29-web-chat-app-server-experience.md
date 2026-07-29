# Web Chat App Server 交互升级 Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web Chat 执行链路迁移到共享 Codex App Server，并补齐原生命令、结构化引用、持久化执行过程、会话菜单和输入框模型配置。

**Architecture:** 使用一个通过 `stdio` 通信的 App Server 客户端承载所有 Web Chat Thread，保留 `CodexSessionRouter` 的队列和历史能力，并用 App Server Runner 适配现有 Runner 边界。Web Chat 独立 Trace Store 保存脱敏过程快照，HTTP/SSE 只公开 Gateway 定义的稳定事件；飞书继续使用 `codex exec --json`。

**Tech Stack:** TypeScript、Bun、Node `child_process`、Codex App Server JSON-RPC、现有 Bun HTTP/SSE、原生 HTML/CSS/JavaScript、Bun Test。

**Design:** `docs/superpowers/specs/2026-07-29-web-chat-app-server-experience-design.md`

---

## Chunk 1: App Server 协议与执行适配

### Task 1: App Server JSON-RPC 客户端

**Files:**
- Create: `src/codex/app-server-types.ts`
- Create: `src/codex/app-server-client.ts`
- Test: `tests/codex-app-server-client.test.ts`

- [x] **Step 1: 编写失败测试，锁定握手、并发和失败边界**

测试使用可控假子进程流，验证客户端启动后发送：

```ts
{
  method: "initialize",
  id: 1,
  params: {
    clientInfo: {
      name: "codex-gateway",
      title: "Codex Gateway",
      version: "0.1.0",
    },
    capabilities: null,
  },
}
```

并验证乱序返回的两个请求仍解析到正确 Promise、服务端通知发送给订阅者。测试同时覆盖：

- 请求超时后 Promise 拒绝且关联项被删除。
- 子进程退出时所有待处理请求拒绝。
- 服务端带 `method` 和 `id` 的反向请求交给显式 handler；未支持请求返回 JSON-RPC 错误，
  不能悬挂。
- `stop()` 幂等。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/codex-app-server-client.test.ts`

Expected: FAIL，提示 `app-server-client` 模块不存在。

- [x] **Step 3: 实现窄类型和客户端生命周期**

`app-server-types.ts` 定义 Gateway 使用的 JSON-RPC 信封和最小稳定类型：

```ts
export type AppServerRequestId = number;

export interface AppServerRequest {
  id: AppServerRequestId;
  method: string;
  params?: unknown;
}

export interface AppServerNotification {
  method: string;
  params?: unknown;
}

export interface AppServerClient {
  start(): Promise<void>;
  request<T>(method: string, params?: unknown): Promise<T>;
  subscribe(listener: (notification: AppServerNotification) => void): () => void;
  stop(): Promise<void>;
  readonly ready: boolean;
}
```

`app-server-client.ts` 使用 `spawn(command, ["app-server", "--stdio"])`，逐行解析 JSON，
关联请求 ID，分发无 ID 通知，处理超时、标准错误、进程退出和显式停止。所有代码注释使用中文。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `bun test tests/codex-app-server-client.test.ts`

Expected: PASS，且没有未处理 Promise 或悬挂子进程。

### Task 2: App Server Thread/Turn 运行时

**Files:**
- Create: `src/codex/app-server-runtime.ts`
- Modify: `src/codex/runner.ts`
- Modify: `src/codex/json-events.ts`
- Test: `tests/codex-app-server-runtime.test.ts`
- Test: `tests/codex-runner.test.ts`

- [x] **Step 1: 编写失败测试，定义 Runner 与结构化输入**

扩展 `CodexRunInput`：

```ts
export type CodexStructuredInput =
  | { type: "text"; text: string }
  | { type: "localImage"; path: string }
  | { type: "mention"; name: string; path: string }
  | { type: "skill"; name: string; path: string };

export interface CodexRunInput {
  // 保留现有字段
  structuredInput?: CodexStructuredInput[];
  additionalContext?: Record<string, { value: string; kind: "application" | "untrusted" }>;
}
```

测试新 Thread 使用 `thread/start` 后 `turn/start`，恢复 Thread 使用 `thread/resume`，并将
`fast` 映射为 `serviceTier: "fast"`、标准速度映射为 `null`。同一 RED 阶段覆盖：

- `agentMessage` 的 `phase` 为中间阶段时只发送 Progress。
- 最终 Agent Message 只写入 `CodexRunResult.text`，不作为中间回复重复。
- `commandExecution`、`fileChange`、`mcpToolCall`、`dynamicToolCall`、`webSearch`、
  `reasoning` 和 `plan` 映射正确。
- 不同 Thread 的通知不串线。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/codex-app-server-runtime.test.ts tests/codex-runner.test.ts`

Expected: FAIL，提示 Runtime 或结构化输入不存在。

- [x] **Step 3: 实现 App Server Runtime**

Runtime 提供以下业务接口：

```ts
export interface CodexAppServerRuntime {
  run(input: CodexRunInput): Promise<CodexRunResult>;
  listModels(): Promise<unknown[]>;
  listSkills(cwd: string): Promise<unknown[]>;
  listInstalledPlugins(cwd: string): Promise<unknown[]>;
  listInstalledApps(): Promise<unknown[]>;
  searchFiles(cwd: string, query: string): Promise<unknown[]>;
  setThreadName(threadId: string, name: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  forkThread(threadId: string): Promise<string>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  executeThreadAction(input: CodexThreadActionInput): Promise<unknown>;
}
```

`run` 订阅指定 Thread/Turn 通知，把 App Server Item 转成扩展的 `CodexProgressEvent`，收集
最终 Agent Message，在 `turn/completed` 后返回。AbortSignal 调用 `turn/interrupt`。

- [x] **Step 4: 扩展过程事件并保持 Exec 兼容**

`CodexProgressEvent` 增加 `reasoning`、`plan`、`file_change`、`web_search`、
`context_compaction` 和带阶段的 `assistant_text`。现有 `runCodex` 不产生的新事件不影响飞书；
现有 Tracker 对未知新增类型使用白名单摘要，不抛出异常。

- [x] **Step 5: 运行 Chunk 1 测试**

Run: `bun test tests/codex-app-server-client.test.ts tests/codex-app-server-runtime.test.ts tests/codex-runner.test.ts tests/feishu-message-tracker.test.ts`

Expected: PASS。

## Chunk 2: Session、Trace 与服务端 API

### Task 3: Session Thread 映射与旧会话兼容

**Files:**
- Modify: `src/web-chat/session-store.ts`
- Modify: `src/web-chat/types.ts`
- Modify: `src/session/history.ts`
- Modify: `src/session/router.ts`
- Test: `tests/web-chat-session-store.test.ts`
- Test: `tests/session-history.test.ts`
- Test: `tests/session-router.test.ts`

- [x] **Step 1: 编写失败测试**

测试 `WebChatSessionRecord` 可保存 `threadId`、Plan Mode、Goal 和安全权限 ID；旧 JSON 缺少
这些字段时仍可读取。Session 历史消息可以保存不含绝对路径的引用元数据。测试还覆盖 App
Server `thread/resume` 失败时只创建一个新 Thread，使用保存的近期历史继续，更新 Session
的 `threadId`，但不删除页面旧消息：

```ts
export interface SessionReference {
  id: string;
  name: string;
  kind: "file" | "directory" | "skill" | "plugin" | "app";
}
```

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/web-chat-session-store.test.ts tests/session-history.test.ts tests/session-router.test.ts`

Expected: FAIL，提示新字段不存在或未持久化。

- [x] **Step 3: 实现兼容字段与 Router 输入透传**

Session Store 增加原子更新 Thread 状态的方法。`CodexSessionMessageOptions` 增加 Runner
结构化输入和历史引用；Router 将结构化输入传给 Runner，Exec Runner 忽略该字段。

Web Chat 不再从页面更新 Verbosity，但旧字段仍能读取，飞书和全局配置不受影响。恢复失败时
Router 只执行一次新 Thread 回退，并保存新的 Thread ID。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `bun test tests/web-chat-session-store.test.ts tests/session-history.test.ts tests/session-router.test.ts`

Expected: PASS。

### Task 4: Trace 标准化与持久化

**Files:**
- Create: `src/web-chat/trace-types.ts`
- Create: `src/web-chat/trace-normalizer.ts`
- Create: `src/web-chat/trace-store.ts`
- Test: `tests/web-chat-trace-normalizer.test.ts`
- Test: `tests/web-chat-trace-store.test.ts`

- [x] **Step 1: 编写失败测试，定义 Trace 快照**

测试以下核心类型，并覆盖运行快照、完成、失败、停止、损坏文件、脱敏、长输出截断和超过
活动上限：

```ts
export interface WebChatTurnTrace {
  messageId: string;
  assistantMessageId: string;
  threadId?: string;
  turnId?: string;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  latestActivity?: string;
  steps: { current: number; total?: number };
  fileChanges: { files: number; additions?: number; deletions?: number };
  entries: WebChatTraceEntry[];
  summary?: string;
  error?: string;
}
```

中间回复与工具组按顺序交错；相邻工具事件归入同一组，新的中间回复结束当前工具组。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/web-chat-trace-normalizer.test.ts tests/web-chat-trace-store.test.ts`

Expected: FAIL，提示 Trace 模块不存在。

- [x] **Step 3: 实现标准化、脱敏和摘要**

标准化器只接收 `CodexProgressEvent`，输出稳定 Trace Entry。工具详情递归过滤
`token`、`secret`、`password`、`authorization`、`cookie`、`apiKey` 等字段，文本限制
4000 字，完整 Trace 限制 200 个活动项。摘要使用确定性模板，不调用模型。

- [x] **Step 4: 实现 Trace Store**

每个 Trace 写入：

```text
<gatewayHome>/web-chat/users/<userId>/sessions/<sessionId>/traces/<messageId>.json
```

使用临时文件加 `renameSync` 原子替换。运行中更新按 200ms 节流，最终状态立即刷新。
`list()` 按开始时间排序，损坏文件跳过并记录警告。

- [x] **Step 5: 运行测试确认 GREEN**

Run: `bun test tests/web-chat-trace-normalizer.test.ts tests/web-chat-trace-store.test.ts`

Expected: PASS。

### Task 5: Web Chat Manager 切换 App Server

**Files:**
- Create: `src/web-chat/capabilities.ts`
- Create: `src/web-chat/commands.ts`
- Modify: `src/web-chat/manager.ts`
- Modify: `src/web-chat/channel.ts`
- Modify: `src/channel-manager.ts`
- Modify: `src/service/daemon.ts`
- Test: `tests/web-chat-manager.test.ts`
- Test: `tests/web-chat-channel.test.ts`
- Test: `tests/channel-manager.test.ts`

- [x] **Step 1: 编写失败测试**

测试 Manager：

- Web Chat 使用 App Server Runner，飞书 Runner 不变。
- 新 Session 保存返回的 Thread ID。
- 引用 ID 由服务端 Capability Catalog 解析，客户端不能提交任意绝对路径。
- 同一 Session 串行，不同 Session 不限制并发。
- 重命名、删除和分支同步 Thread。
- Goal、Plan、Clear、Compact、Review、Permissions 和 Status 有真实 App Server 调用。
- 权限列表过滤 `danger-full-access`。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/web-chat-manager.test.ts tests/web-chat-channel.test.ts tests/channel-manager.test.ts`

Expected: FAIL，提示 App Server 或命令接口不存在。

- [x] **Step 3: 实现 Capability Catalog**

Catalog 将模型、Skill、插件、应用和文件搜索结果映射为不含服务器路径的公开项，并在服务端
保存短时稳定 ID 到真实能力的映射。发送消息时重新校验所属用户、工作区边界和能力启用状态。

- [x] **Step 4: 实现命令服务**

`commands.ts` 定义允许命令和参数解析，返回结构化结果，不执行任意字符串。`/clear` 新建空
Thread 并更新当前 Session 映射；`/plan` 使用 App Server Collaboration Mode；
`/permissions` 只允许安全 Profile。

- [x] **Step 5: 集成 Trace**

Manager 在 `message.accepted` 前创建 Trace，在 Progress 中更新并发布公开活动，在输出、失败
或停止时最终化。Session 详情返回消息和 Trace。Trace 写入失败不阻止最终回复。

- [x] **Step 6: 接入服务生命周期**

Daemon 创建一个共享 App Server Client/Runtime 并注入 WebChatManager；停止 Gateway 时关闭
Runtime。Channel 状态显示 App Server ready/error，连接测试读取模型和能力目录。

- [x] **Step 7: 运行测试确认 GREEN**

Run: `bun test tests/web-chat-manager.test.ts tests/web-chat-channel.test.ts tests/channel-manager.test.ts`

Expected: PASS。

### Task 6: HTTP、SSE 与安全边界

**Files:**
- Modify: `src/web-chat/event-hub.ts`
- Modify: `src/web-chat/http.ts`
- Modify: `src/web-server.ts`
- Test: `tests/web-chat-event-hub.test.ts`
- Test: `tests/web-chat-http.test.ts`
- Test: `tests/web-access-control.test.ts`

- [x] **Step 1: 编写失败测试**

覆盖：

- Session 详情返回 `traces`。
- 发送消息接收 Capability 引用 ID。
- Capability、文件搜索和命令 API 强制登录与用户边界。
- SSE 接受 `message.activity` 和 `message.trace`，拒绝原始未知字段。
- 缓冲淘汰时发送 reset，客户端可重新加载快照。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/web-chat-event-hub.test.ts tests/web-chat-http.test.ts tests/web-access-control.test.ts`

Expected: FAIL，提示新 API 或事件类型不存在。

- [x] **Step 3: 实现 API**

新增：

```text
GET  /api/chat/capabilities
GET  /api/chat/files/search?q=<query>
POST /api/chat/sessions/:id/commands
```

扩展消息 POST 的 `references`，扩展 Session GET 的 `traces`。命令 API 只接收白名单命令名和
参数对象。

- [x] **Step 4: 实现公开事件白名单**

公开事件载荷只允许活动 ID、类型、标题、状态、时间、脱敏详情和 Trace 摘要。保留现有禁止
字段递归检查，并新增允许字段投影，不能仅依赖黑名单。

- [x] **Step 5: 运行 Chunk 2 测试**

Run: `bun test tests/web-chat-trace-normalizer.test.ts tests/web-chat-trace-store.test.ts tests/web-chat-manager.test.ts tests/web-chat-event-hub.test.ts tests/web-chat-http.test.ts`

Expected: PASS。

## Chunk 3: Web Chat 界面

### Task 7: 会话右键、长按和行内重命名

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Modify: `src/web/chat/script.ts`
- Modify: `src/web/chat/icons.ts`
- Test: `tests/web-chat-page.test.ts`
- Test: `tests/web-chat-icons.test.ts`

- [x] **Step 1: 编写失败页面测试**

断言页面包含一个复用的 Session Context Menu、移动端 `...` 按钮、行内重命名控件所需脚本，
并使用 Lucide 的 `Ellipsis`、`Pencil` 和 `Trash2` 图标。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/web-chat-page.test.ts tests/web-chat-icons.test.ts`

Expected: FAIL，缺少菜单结构和交互。

- [x] **Step 3: 实现桌面右键与移动端入口**

会话项改为语义容器加独立打开按钮，避免按钮嵌套。桌面监听 `contextmenu`；移动端 `...`
打开菜单，长按 550ms 打开同一菜单并抑制后续 click。

- [x] **Step 4: 实现重命名和删除**

重命名使用行内输入，支持 `Enter`、`Esc` 和失焦；删除显示确认。运行中会话的删除菜单项
disabled。菜单支持键盘焦点、点击外部和 `Esc` 关闭。

- [x] **Step 5: 运行测试确认 GREEN**

Run: `bun test tests/web-chat-page.test.ts tests/web-chat-icons.test.ts`

Expected: PASS。

### Task 8: Composer 命令、引用和模型菜单

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Modify: `src/web/chat/script.ts`
- Modify: `src/web/chat/icons.ts`
- Test: `tests/web-chat-page.test.ts`

- [x] **Step 1: 编写失败测试**

断言：

- 顶部不再包含 `modelInput`、`effortSelect`、`fastToggle` 和 `verbositySelect`。
- Composer 包含模型组合按钮、分层菜单、命令面板、引用面板和引用标签区域。
- 页面脚本没有 `/verbosity`。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/web-chat-page.test.ts`

Expected: FAIL，旧顶部控件仍存在。

- [x] **Step 3: 实现模型组合菜单**

输入框右下角按钮显示模型简称和 Effort。菜单提供模型、推理强度、标准/Fast 和高级入口；
菜单更新复用现有 Runtime API，正在运行时禁用修改。移动端文本缩短且弹层不超出视口。

- [x] **Step 4: 实现 `/` 面板**

输入以 `/` 开头时按命令名和说明过滤；支持上下键、Enter、Esc、鼠标和触摸。模型、Effort、
Fast、Review 和 Permissions 进入二级菜单；其他命令调用命令 API或现有 Session API。

- [x] **Step 5: 实现 `@` 和 `+` 面板**

`@` 面板按文件、Skills、插件/应用分组，输入变化时防抖请求文件搜索。选中项生成可移除标签；
发送时只提交公开 Capability ID。`+` 菜单复用面板并保留现有本地文件选择。

- [x] **Step 6: 运行测试确认 GREEN**

Run: `bun test tests/web-chat-page.test.ts`

Expected: PASS，内联脚本语法检查通过。

### Task 9: 交错过程时间线和最新活动状态条

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Modify: `src/web/chat/script.ts`
- Test: `tests/web-chat-page.test.ts`
- Test: `tests/web-chat-http.test.ts`

- [x] **Step 1: 编写失败测试**

页面测试要求：

- Trace 中间回复与工具组按 Entry 顺序渲染。
- 工具组默认折叠且可展开详情。
- Running Trace 默认展开，最终 Trace 默认折叠。
- Composer 上方存在最新活动状态条，点击可滚动到当前 Trace。
- SSE 活动按稳定 ID 合并。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/web-chat-page.test.ts tests/web-chat-http.test.ts`

Expected: FAIL，缺少 Trace UI。

- [x] **Step 3: 实现时间线**

消息渲染按用户消息、Trace、最终 Assistant 消息组合。中间回复使用 Markdown；工具组摘要使用
图标、标题、状态和耗时，详情使用只读代码块。任何服务端详情都通过安全文本渲染。

- [x] **Step 4: 实现运行状态条与自动折叠**

运行状态条显示步骤、最新活动和文件统计；SSE 更新时保持滚动跟随但不抢夺用户手动滚动。
Trace 完成后自动折叠，最终回复保持展开。本次浏览器会话记录用户手动展开状态。

- [x] **Step 5: 运行 Chunk 3 测试**

Run: `bun test tests/web-chat-page.test.ts tests/web-chat-icons.test.ts tests/web-chat-http.test.ts`

Expected: PASS。

## Chunk 4: Doctor、回归与真实验证

### Task 10: Doctor 与运行日志

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/service/commands.ts`
- Modify: `src/service/daemon.ts`
- Test: `tests/cli.test.ts`
- Test: `tests/service-commands.test.ts`
- Test: `tests/service-daemon.test.ts`

- [x] **Step 1: 编写失败测试**

测试 Doctor 输出 App Server 握手、模型目录、Skill 和插件/应用目录检查；日志不包含 Token、
Cookie 或密码值。

- [x] **Step 2: 运行测试确认 RED**

Run: `bun test tests/cli.test.ts tests/service-commands.test.ts tests/service-daemon.test.ts`

Expected: FAIL，缺少 App Server 检查。

- [x] **Step 3: 实现检查与日志**

Doctor 使用短生命周期 Client 完成握手和目录读取，明确区分“协议不可用”和“某个目录为空”。
Daemon 日志记录启动、重启、恢复回退和 Trace 写入失败，不输出原始请求内容。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `bun test tests/cli.test.ts tests/service-commands.test.ts tests/service-daemon.test.ts`

Expected: PASS。

### Task 11: 完整回归与真实 App Server 验证

**Files:**
- Modify: `README.md`（仅补充 Web Chat 命令、引用和运行要求）
- Test: `tests/readme.test.ts`

- [x] **Step 1: 更新 README 和文档测试**

说明 Web Chat 使用本机 App Server、`/` 命令、`@` 引用、模型菜单和过程历史；不出现要求用户
直接运行 `bun run src/index.ts` 的使用命令。

- [x] **Step 2: 运行静态和完整测试**

Run: `bun test`

Expected: 全部通过。

Run: `bun run typecheck`

Expected: exit 0。

Run: `bun run build`

Expected: exit 0。

- [x] **Step 3: 运行真实 App Server 协议冒烟测试**

使用当前配置中的 Codex 命令完成初始化、模型目录、Skill、插件/应用和文件搜索请求。验证
App Server 子进程停止后没有残留进程。

- [x] **Step 4: 重启 Gateway 并完成真实 Chat 流程**

Run: `codex-gateway restart`

Expected: 服务后台启动，Chat URL 可访问。

验证新建、旧会话恢复、`@文件`、Skill、工具调用、Stop、Goal、Plan、模型/Effort/Fast、
重命名、删除和分支。

- [x] **Step 5: 桌面与移动端视觉验证**

使用 Playwright 检查桌面和移动端：

- 右键、`...`、长按菜单不越界。
- 命令、引用和模型菜单不遮挡输入框。
- 中间回复、折叠工具组、状态条和最终回复无重叠。
- 390px 移动端按钮和标签可换行，长文字不溢出。

- [x] **Step 6: 最终工作区核对**

Run: `git diff --check`

Expected: 无空白错误。

Run: `git status --short`

Expected: 只包含本次及用户此前已有的未提交改动；不执行 `git add`、`git commit` 或
`git push`。

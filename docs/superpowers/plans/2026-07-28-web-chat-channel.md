# Web Chat Channel Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一 Gateway 端口提供局域网多用户 Web Chat，同时保证现有管理后台和完整运行日志只能从本机访问。

**Architecture:** Web Server 先按真实 socket 地址划分 Chat 与管理路由，再将 Chat 请求交给独立的认证服务和 `WebChatManager`。每个 Web 用户有固定 workspace，每个 Chat Session 有独立 `CodexSessionRouter`，因此同一 Session 串行、不同 Session 无应用层并发上限；`WebChatChannel` 将用户和运行日志接入现有 Channel Manager 与管理 UI。

**Tech Stack:** Bun、TypeScript、Bun.serve、Bun.password Argon2id、SSE、现有 CodexSessionRouter、SessionHistoryStore、CodexModelCatalog 和内联 HTML/CSS/JavaScript。

**Approved spec:** `docs/superpowers/specs/2026-07-28-web-chat-channel-design.md`

---

## Chunk 1: 服务边界与身份基础

### Task 1: 可配置监听地址与本机管理守卫

**Files:**
- Create: `src/web/access-control.ts`
- Modify: `src/config.ts`
- Modify: `src/cli.ts`
- Modify: `src/service/commands.ts`
- Modify: `src/service/daemon.ts`
- Modify: `src/service/ports.ts`
- Modify: `src/service/state.ts`
- Modify: `src/web-server.ts`
- Modify: `config-example.yaml`
- Test: `tests/config.test.ts`
- Test: `tests/cli.test.ts`
- Test: `tests/service-commands.test.ts`
- Test: `tests/service-daemon.test.ts`
- Test: `tests/service-ports.test.ts`
- Create: `tests/web-access-control.test.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: 写入监听地址和请求地址分类失败测试**

覆盖：

```ts
expect(config.service.host).toBe("127.0.0.1");
expect(loadGatewayConfigFromObject({ service: { host: "0.0.0.0" } }).service.host)
  .toBe("0.0.0.0");
expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
expect(isLoopbackAddress("192.168.1.8")).toBe(false);
```

并验证远程地址访问 `/` 返回 `/chat` 重定向，访问 `/api/config` 返回 `403`，伪造 `X-Forwarded-For: 127.0.0.1` 不生效。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/config.test.ts tests/cli.test.ts tests/service-commands.test.ts tests/service-daemon.test.ts tests/service-ports.test.ts tests/web-access-control.test.ts tests/web-server.test.ts
```

Expected: FAIL，缺少 `service.host`、地址分类器和请求上下文。

- [ ] **Step 3: 实现访问边界**

`src/web/access-control.ts` 提供：

```ts
export interface WebRequestContext {
  remoteAddress?: string;
}

export function isLoopbackAddress(address?: string): boolean;
export function isChatRoute(pathname: string): boolean;
```

`startWebServer` 使用 `fetch(request, server)` 和 `server.requestIP(request)` 获取真实对端地址，不读取转发头。`handleWebRequest` 在处理任何管理路由前执行 loopback 守卫；现有直接调用测试默认显式传入 loopback 上下文。

配置和服务状态新增 `service.host`。默认值保持 `127.0.0.1`，示例配置写明设置 `0.0.0.0` 才开放局域网。端口探测使用相同监听地址，避免探测成功但 Daemon 绑定失败。启动和状态输出显示本机管理 URL；host 为 `0.0.0.0` 时额外列出从系统网卡解析到的局域网 Chat URL。

- [ ] **Step 4: 运行定向测试**

Run:

```bash
bun test tests/config.test.ts tests/cli.test.ts tests/service-commands.test.ts tests/service-daemon.test.ts tests/service-ports.test.ts tests/web-access-control.test.ts tests/web-server.test.ts
bun run typecheck
```

Expected: PASS，远程管理请求均在路由处理前被拒绝。

- [ ] **Step 5: 检查 Chunk 1 第一阶段**

Run:

```bash
git diff --check
```

Expected: 无输出。确认没有放宽现有管理 API，也没有信任代理头。

### Task 2: Web Chat 用户持久化

**Files:**
- Create: `src/web-chat/types.ts`
- Create: `src/web-chat/user-store.ts`
- Modify: `src/paths.ts`
- Test: `tests/web-chat-user-store.test.ts`
- Test: `tests/paths.test.ts`

- [ ] **Step 1: 写入用户存储失败测试**

测试创建用户后：

- `users.json` 不包含明文密码；
- `Bun.password.verify` 可以验证密码；
- 用户名大小写归一化后不能重复；
- 工作目录和 Session 目录由不可变用户 ID 推导；
- 更新运行默认值不会修改密码哈希；
- 重置密码、启停、软删除和彻底删除行为明确；
- 损坏数据文件返回可恢复错误而不是覆盖。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-user-store.test.ts tests/paths.test.ts
```

Expected: FAIL，用户存储和 Web Chat 路径函数不存在。

- [ ] **Step 3: 实现原子用户存储**

`WebChatUserStore` 提供异步密码操作：

```ts
list(): WebChatUserPublic[];
getById(userId: string): WebChatUserRecord | null;
findByUsername(username: string): WebChatUserRecord | null;
create(input: CreateWebChatUserInput): Promise<WebChatUserPublic>;
update(userId: string, input: UpdateWebChatUserInput): WebChatUserPublic | null;
resetPassword(userId: string, password: string): Promise<boolean>;
verifyPassword(userId: string, password: string): Promise<boolean>;
remove(userId: string, purgeData: boolean): boolean;
```

使用 `Bun.password.hash(..., { algorithm: "argon2id" })`，JSON 原子写入并固定 `0600`。所有路径通过 `resolveWebChatUserRoot`、`resolveWebChatWorkspacePath` 和 `resolveWebChatSessionsPath` 推导。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
bun test tests/web-chat-user-store.test.ts tests/paths.test.ts
bun run typecheck
```

Expected: PASS。

### Task 3: 登录 Session、CSRF 与限流

**Files:**
- Create: `src/web-chat/auth.ts`
- Test: `tests/web-chat-auth.test.ts`

- [ ] **Step 1: 写入认证失败测试**

覆盖：

- 正确密码创建 opaque Session 和独立 CSRF Token；
- 错误用户名和错误密码返回相同错误；
- 连续失败触发短时限流；
- Cookie 解析不接受伪造 Session；
- 修改请求必须同时满足 Cookie、CSRF 和账号启用；
- logout、密码变更和账号停用撤销相关 Session；
- Session 过期和服务重建后失效。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-auth.test.ts
```

Expected: FAIL，`WebChatAuthService` 不存在。

- [ ] **Step 3: 实现内存认证服务**

认证 Session 使用 `randomBytes(32).toString("base64url")`，绝对有效期为 24 小时。Cookie 名固定，使用：

```text
HttpOnly; SameSite=Strict; Path=/
```

纯 HTTP 不设置 `Secure`。限流键由规范化用户名与真实客户端地址组成。密码修改必须验证旧密码，管理员重置通过独立本机 API 完成。

- [ ] **Step 4: 运行认证与 Chunk 1 全部测试**

Run:

```bash
bun test tests/web-chat-auth.test.ts tests/web-chat-user-store.test.ts tests/web-access-control.test.ts
bun run typecheck
```

Expected: PASS。

---

## Chunk 2: Session、事件与文件

### Task 4: Web Chat Session 元数据和 SSE 事件缓冲

**Files:**
- Create: `src/web-chat/session-store.ts`
- Create: `src/web-chat/event-hub.ts`
- Test: `tests/web-chat-session-store.test.ts`
- Test: `tests/web-chat-event-hub.test.ts`

- [ ] **Step 1: 写入 Session 存储和事件失败测试**

Session 测试覆盖创建、稳定排序、重命名、运行状态、运行参数、软所有权校验、删除和损坏单条记录隔离。事件测试覆盖每用户隔离、递增 ID、订阅、取消订阅、有限缓冲和 `Last-Event-ID` 续传。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-session-store.test.ts tests/web-chat-event-hub.test.ts
```

Expected: FAIL，对应类不存在。

- [ ] **Step 3: 实现小型持久化单元**

每个 Session 使用：

```text
<userRoot>/sessions/<sessionId>/web-session.json
<userRoot>/sessions/<sessionId>/history/
```

`WebChatEventHub` 只保存允许远程展示的事件，默认每用户保留最近 500 条；事件负载中必须包含 `sessionId`，不得包含 stderr 或工具原始输入输出。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
bun test tests/web-chat-session-store.test.ts tests/web-chat-event-hub.test.ts
bun run typecheck
```

Expected: PASS。

### Task 5: 扩展 Router 的导入和消息附件能力

**Files:**
- Modify: `src/session/history.ts`
- Modify: `src/session/router.ts`
- Test: `tests/session-history.test.ts`
- Test: `tests/session-router.test.ts`

- [ ] **Step 1: 写入失败测试**

覆盖：

- 用户消息可携带稳定消息 ID 和附件元数据；
- Assistant 输出处理器可以移除文件指令并保存生成文件附件；
- 新 Router 可以导入来源 Session 消息，且不复用来源原生 Codex Session ID；
- 导入后的第一次请求将历史作为 fallback prompt；
- 旧飞书消息 JSONL 继续兼容。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/session-history.test.ts tests/session-router.test.ts
```

Expected: FAIL，消息元数据和导入接口不存在。

- [ ] **Step 3: 实现向后兼容扩展**

为 `SessionMessage` 增加可选的 `id` 和 `attachments`。Router 的 `send` 增加末尾可选消息元数据参数，不改变现有调用。新增：

```ts
importMessages(conversationKey: string, messages: SessionMessage[], forkedFrom?: string): void;
```

Assistant 输出处理器返回清理后的文本和附件，Router 先处理再持久化。所有新增字段保持可选，旧 JSONL 无需迁移。

- [ ] **Step 4: 运行 Router 回归**

Run:

```bash
bun test tests/session-history.test.ts tests/session-router.test.ts tests/feishu-channel.test.ts
bun run typecheck
```

Expected: PASS，飞书行为不变。

### Task 6: 用户文件仓库

**Files:**
- Create: `src/web-chat/files.ts`
- Test: `tests/web-chat-files.test.ts`

- [ ] **Step 1: 写入文件隔离失败测试**

覆盖上传、图片识别、下载、30 MB 限制、空文件、目录、绝对路径、`..`、跨用户 token、越界符号链接和 Codex 返回文件。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-files.test.ts
```

Expected: FAIL，文件仓库不存在。

- [ ] **Step 3: 实现文件 token 与真实路径校验**

文件 token 使用随机 ID，元数据保存原始名称、MIME、大小、所属用户和真实路径。所有下载与返回文件复用或提取现有 `realpath` 工作目录边界校验，不向客户端返回绝对路径。

- [ ] **Step 4: 运行测试**

Run:

```bash
bun test tests/web-chat-files.test.ts tests/feishu-return-files.test.ts
bun run typecheck
```

Expected: PASS。

### Task 7: WebChatManager 核心业务

**Files:**
- Create: `src/web-chat/manager.ts`
- Test: `tests/web-chat-manager.test.ts`

- [ ] **Step 1: 写入核心业务失败测试**

覆盖：

- 每个用户和 Session 使用独立 Router 与目录；
- 同一 Session 消息串行；
- 不同 Session 可以同时进入 runner，且没有应用层并发上限；
- 停止、重命名、删除、服务重建恢复；
- 跨用户访问统一未找到；
- Fork 创建新 Web Session 并导入历史；
- 模型、Effort、Fast 使用共享目录校验；
- Web Runner 强制 `workspace-write`、关闭危险绕过、清空 `extraArgs`；
- 正常文本进入 SSE，stderr 和工具细节只进入管理员 tracker；
- 上传附件、图片输入、生成文件和 usage 项目根路径正确。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-manager.test.ts
```

Expected: FAIL，Manager 不存在。

- [ ] **Step 3: 实现 Manager**

Manager 组合用户存储、Session 存储、事件中心、文件仓库、共享模型目录和 Router 工厂。每个 Session 的 conversation key 使用自身 ID，Router 放入以 `userId/sessionId` 为键的运行表。每次发送使用按消息绑定的 output/progress 回调，避免排队消息日志错位。

Web Runner 参数固定：

```ts
{
  sandbox: "workspace-write",
  dangerouslyBypassApprovalsAndSandbox: false,
  extraArgs: [],
  cwd: user.workspacePath
}
```

- [ ] **Step 4: 运行 Chunk 2 测试**

Run:

```bash
bun test tests/web-chat-manager.test.ts tests/web-chat-files.test.ts tests/web-chat-session-store.test.ts tests/web-chat-event-hub.test.ts tests/session-router.test.ts
bun run typecheck
```

Expected: PASS。

---

## Chunk 3: 频道接入与 HTTP API

### Task 8: Web Chat 受管频道

**Files:**
- Create: `src/web-chat/channel.ts`
- Modify: `src/channel-manager.ts`
- Modify: `src/service/daemon.ts`
- Test: `tests/web-chat-channel.test.ts`
- Modify: `tests/channel-manager.test.ts`
- Modify: `tests/service-daemon.test.ts`

- [ ] **Step 1: 写入频道失败测试**

验证：

- Channel Manager 永远包含 `web-chat` 与配置的飞书频道；
- Web Chat 状态返回用户数、启用数、Session 数、活跃数和用户账户卡片数据；
- 用户 Session 映射为现有管理抽屉可识别的 `recentSessions`；
- archive detail 和 AI summary 可通过现有 Channel Manager 接口调用；
- Daemon 将同一 model catalog、项目根目录和配置传给 WebChatManager 与 Web Server。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-channel.test.ts tests/channel-manager.test.ts tests/service-daemon.test.ts
```

Expected: FAIL，`web-chat` 频道不存在。

- [ ] **Step 3: 实现频道适配器**

`WebChatChannel` 只负责适配 `ManagedChannel`：

```ts
id = "web-chat";
getStatus(): ManagedChannelStatus;
listArchivedSessions(conversationKey: string): SessionSummary[];
getArchivedSessionDetail(...): ArchivedSessionDetail | null;
summarizeArchivedSession(...): Promise<SessionSummaryWithAi | null>;
```

用户 CRUD 和 Chat 业务仍由 Manager 提供，避免频道适配器承担 HTTP 或认证职责。

- [ ] **Step 4: 运行频道回归**

Run:

```bash
bun test tests/web-chat-channel.test.ts tests/channel-manager.test.ts tests/service-daemon.test.ts
bun run typecheck
```

Expected: PASS。

### Task 9: Chat 与本机用户管理 API

**Files:**
- Create: `src/web-chat/http.ts`
- Modify: `src/web-server.ts`
- Test: `tests/web-chat-http.test.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: 写入 HTTP 失败测试**

覆盖：

- 远程可打开 `/chat` 和登录，但不能访问管理 API；
- 登录 Cookie、`/me`、logout、修改密码和 CSRF；
- Session CRUD、发送、停止、Fork、运行参数、分页消息；
- multipart 上传和 token 下载；
- SSE 只收到当前用户公开事件并支持 `Last-Event-ID`；
- 本机用户管理 CRUD、重置密码、启停和 purge 二次确认；
- 本机可对指定用户执行 Codex 运行环境测试，远程调用返回 `403`；
- 跨用户 Session、文件和事件不可见；
- 非本机调用用户管理 API 返回 `403`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-http.test.ts tests/web-server.test.ts
```

Expected: FAIL，路由未实现。

- [ ] **Step 3: 实现路由分发**

`handleWebChatRequest` 接受真实请求上下文、Auth 和 Manager。Chat API 从 Cookie 解析用户，不读取 body 中的 user ID。所有修改路由统一走 CSRF 守卫。SSE 使用 `ReadableStream`，取消请求时清理订阅。

本机管理 API 使用 `/api/web-chat/users` 命名空间，并在进入处理器前通过 loopback 守卫。

- [ ] **Step 4: 运行 HTTP 与安全回归**

Run:

```bash
bun test tests/web-chat-http.test.ts tests/web-server.test.ts tests/web-access-control.test.ts
bun run typecheck
```

Expected: PASS。

---

## Chunk 4: 用户界面、文档与完整验证

### Task 10: 远程 Chat 页面

**Files:**
- Create: `src/web/chat/page.ts`
- Create: `src/web/chat/markdown.ts`
- Create: `src/web/chat/styles.ts`
- Create: `src/web/chat/script.ts`
- Test: `tests/web-chat-page.test.ts`

- [ ] **Step 1: 写入页面结构失败测试**

验证 HTML 包含登录视图、Session 侧栏、模型参数、消息区、附件、发送、停止、手机抽屉、主题切换和错误状态，不包含管理导航、配置/日志 API 或 stderr 展示。提取所有内联脚本并用 `new Function` 做语法检查。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-page.test.ts
```

Expected: FAIL，页面渲染器不存在。

- [ ] **Step 3: 实现响应式 Chat UI**

页面使用现有主题变量但保持独立结构。Markdown 渲染器先解析标题、段落、列表、引用、链接、粗体、行内代码和代码围栏，再通过 DOM API 与 `textContent` 构建节点；模型输出不得直接赋给 `innerHTML`，链接协议只允许 `http:`、`https:` 和 `mailto:`。所有控件使用稳定尺寸；桌面两栏，手机 Session 列表为抽屉。

前端流程：

- 登录后读取 `/me`、模型和 Session；
- 打开单一 SSE；
- 选择或创建 Session；
- 发送、停止、Fork、重命名、删除和切换运行参数；
- 上传附件并显示下载；
- 断线后重拉当前 Session 快照。

- [ ] **Step 4: 运行页面测试**

Run:

```bash
bun test tests/web-chat-page.test.ts tests/web-chat-http.test.ts
bun run typecheck
```

Expected: PASS。

### Task 11: 管理后台 Web Chat 频道 UI

**Files:**
- Modify: `src/web/page.ts`
- Modify: `src/web-server.ts`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: 写入管理 UI 失败测试**

验证频道列表出现 `Web Chat`，用户卡片支持新增、编辑、启停、重置密码和删除；模型运行参数复用现有控件；Session 行可以打开实时过程与历史归档；日志抽屉显示完整进度事件。确保远程 Chat 页面仍不包含这些元素。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-server.test.ts tests/web-chat-page.test.ts
```

Expected: FAIL，管理页没有 Web Chat 组件。

- [ ] **Step 3: 实现管理 UI**

在现有频道面板中加入 Web Chat 选择和用户列表，不创建嵌套卡片。复用 `createRuntimeTuningFields`、`createSessionRow` 和现有 Session Drawer。密码字段只用于创建或重置，API 永不返回哈希。

- [ ] **Step 4: 运行 UI 回归**

Run:

```bash
bun test tests/web-server.test.ts tests/web-chat-page.test.ts
bun run typecheck
```

Expected: PASS。

### Task 12: README、示例配置和端到端验证

**Files:**
- Modify: `README.md`
- Modify: `config-example.yaml`
- Modify: `src/cli.ts`
- Modify: `tests/readme.test.ts`

- [ ] **Step 1: 更新用户文档**

记录：

- `service.host: 0.0.0.0` 的显式开放方式；
- 本机管理地址与局域网 `/chat` 地址；
- Web Chat 用户只能从本机频道页创建；
- workspace 隔离和共享 Codex 额度；
- 不设置应用层并发上限；
- 局域网纯 HTTP 没有传输加密；
- 管理 API 只允许 loopback；
- 所有操作继续使用 `codex-gateway` CLI。

- [ ] **Step 2: 运行完整自动化验证**

Run:

```bash
bun test
bun run typecheck
bun run build
git diff --check
```

Expected: 全部退出码为 0。

- [ ] **Step 3: 重启服务并检查监听**

Run:

```bash
codex-gateway restart
codex-gateway status
curl -fsS http://127.0.0.1:18788/api/status
curl -fsS http://127.0.0.1:18788/chat
```

Expected: 服务运行，管理 API 本机可访问，Chat 页面可渲染，Web Chat 和飞书频道均出现在状态中。

- [ ] **Step 4: 验证远程访问边界**

使用本机局域网 IP 请求 `/chat` 应返回页面；请求管理 API 应返回 `403`。创建临时 Web 用户完成登录、新建 Session、模型参数读取、SSE 建连和退出，然后删除临时用户。

- [ ] **Step 5: 最终状态检查**

Run:

```bash
git status --short
```

Expected: 只包含本次功能文件以及用户原有的 `.DS_Store`，不执行 `git add`、`git commit` 或 `git push`。

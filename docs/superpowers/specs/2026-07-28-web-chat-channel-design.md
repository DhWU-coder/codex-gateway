# Web Chat 频道与局域网聊天设计

## 目标

为 Codex Gateway 增加一个固定多用户的 Web Chat 频道。局域网用户通过 `http://<主机 IP>:<端口>/chat` 登录并使用完整 Codex 聊天能力；现有 Gateway 管理后台、配置、日志、用量、频道管理和服务操作仍只允许本机访问。

首版要求：

- 用户名和密码登录，由本机管理员创建用户；
- 所有用户共享本机当前 Codex 登录与模型额度；
- 每个用户拥有独立工作目录、Session、消息和文件；
- Web Chat 强制使用工作目录受限模式，可以联网，但不能访问其他用户目录或系统文件；
- 同一 Session 内消息串行，不同 Session 之间不设置用户级或全局并发上限；
- 管理后台的频道页新增 `Web Chat`，支持用户管理、会话归档、实时过程和完整日志；
- 远程 Chat 用户只能查看自己的正常聊天过程，不能读取原始工具日志、标准输出或标准错误；
- 桌面与手机浏览器都提供完整 Chat 体验。

## 服务监听与访问边界

`service.host` 成为可配置字段，默认值保持 `127.0.0.1`。管理员显式设置为 `0.0.0.0` 后，Gateway 才允许局域网设备连接。

Web 服务按路由分为三类：

### 公开路由

- `/chat`
- Chat 页面静态资源
- `/api/chat/auth/login`

### 已登录 Chat 路由

- `/api/chat/me`
- `/api/chat/auth/logout`
- `/api/chat/models`
- `/api/chat/sessions`
- `/api/chat/sessions/:sessionId`
- `/api/chat/sessions/:sessionId/messages`
- `/api/chat/sessions/:sessionId/runtime`
- `/api/chat/sessions/:sessionId/stop`
- `/api/chat/sessions/:sessionId/fork`
- `/api/chat/sessions/:sessionId/files`
- `/api/chat/events`

所有 Chat 路由从服务端登录 Session 中获取用户 ID，不接受客户端提交任意用户 ID。资源不属于当前用户时统一返回 `404`。

### 仅本机管理路由

现有管理页面 `/`、所有现有 `/api/*` 管理接口，以及新增的 Web Chat 用户管理接口，只接受 socket 对端地址为 `127.0.0.1`、`::1` 或 IPv4 映射的 loopback 地址。访问判断不读取 `X-Forwarded-For`。

非本机访问 `/` 时跳转到 `/chat`。非本机访问其他管理页面或管理 API 时返回 `403`。本机访问行为保持兼容。

## 用户与认证

用户数据存放在：

```text
~/.codex-gateway/web-chat/users.json
```

文件使用原子写入和 `0600` 权限。每条用户记录包含：

- 不可变用户 ID；
- 唯一用户名；
- Argon2id 密码哈希；
- 启用状态；
- 模型、Effort、Fast 和 Verbosity 默认值；
- 创建时间、更新时间和最近登录时间。

不保存明文密码。用户名使用规范化后的稳定值进行唯一性比较。工作目录和历史目录由用户 ID 推导，管理员不能写入任意路径：

```text
~/.codex-gateway/channels/web/<userId>/workspace/
~/.codex-gateway/channels/web/<userId>/sessions/
```

登录成功后创建高熵随机 Session，浏览器只持有 opaque Cookie。服务端把 Session Token 的 SHA-256 哈希、CSRF Token、用户 ID 和过期时间原子保存到 `~/.codex-gateway/web-chat/auth-sessions.json`，不保存原始 Token；服务重启后恢复仍有效且用户仍启用的 Session。Cookie 使用 `HttpOnly` 和 `SameSite=Strict`；局域网纯 HTTP 下不能设置有效的 `Secure` 传输保护。

所有修改请求校验登录状态、CSRF Token 和同源请求。登录接口限制连续失败次数，返回统一的“用户名或密码错误”，不泄露账号是否存在。用户可修改自己的密码；本机管理员可创建、启停、重置密码和删除用户。

停用用户后立即拒绝新登录和 Chat 请求，并停止该用户的运行任务。删除用户默认只删除账号记录；彻底删除工作目录和历史数据必须通过独立的二次确认操作。用户修改密码时必须提供当前密码；管理员重置密码不需要旧密码，但只能从本机管理接口执行。

## Web Chat 频道

新增一个 ID 为 `web-chat` 的受管频道，并接入现有 `ChannelManager`。频道状态包含：

- 配置用户数和启用用户数；
- Session 总数；
- 当前运行任务数；
- 每个用户的模型默认值、工作目录、最近活跃时间；
- 每个用户的最近 Session 和消息跟踪状态。

管理后台“频道”页显示 `Web Chat` 与 `飞书` 两个频道入口。Web Chat 频道账户卡片提供：

- 新增、编辑、启停、删除用户；
- 设置或重置密码；
- 编辑用户默认模型、Effort、Fast 和 Verbosity；
- 查看只读工作目录；
- 测试 Codex 运行环境；
- 打开实时过程和历史归档抽屉；
- 查看消息、附件、工具事件、标准输出、标准错误、耗时和 AI 总结。

管理 UI 尽量复用飞书现有频道卡片、模型组合框、Session 行、实时过程抽屉、历史归档和 AI 总结组件。用户管理 API 仍受 loopback 守卫保护。

## Session 与执行模型

新增 `WebChatManager` 负责用户、Chat Session、认证 Session 和实时订阅。每个 Web Chat Session 使用独立的 `CodexSessionRouter`，工作目录指向所属用户的固定 workspace，历史目录位于所属用户的 Session 子目录。

同一 Session 内复用 Router 的现有队列，保证消息串行。不同 Session 拥有独立 Router，可以并发执行；不设置每用户或全局并发上限，实际上限由本机资源决定。

新建 Session 时生成不可预测的 Session ID。Session 元数据保存标题、创建时间、更新时间、运行状态和当前运行参数。标题默认来自首条用户消息的安全截断，用户可以重命名。

支持：

- 新建、列举、打开、重命名和删除 Session；
- 停止当前 Session；
- 恢复 Codex 原生 Session；
- 将历史消息 Fork 为新的 Web Chat Session；
- Session 级模型、Effort 和 Fast 切换；
- 历史消息、附件、生成文件和 AI 总结；
- 服务重启后恢复持久化 Session 元数据和消息。

运行中的 Session 不允许删除，用户必须先显式停止，再删除该 Session 的历史目录。Session API 使用分页返回消息，避免长会话一次加载全部内容。

## Codex 安全策略

Web Chat 不继承飞书的完全权限模式。每次 Web Chat 执行强制使用：

- `workspace-write` 沙箱；
- 当前用户 workspace 作为工作目录；
- 非交互审批策略；
- Gateway 的联网与实时搜索配置；
- 共享的 Codex 命令、Profile、模型目录和用量日志；
- 不允许继承会覆盖沙箱或审批策略的全局 `extraArgs`；
- 不传递 `dangerouslyBypassApprovalsAndSandbox`。

Session 级模型、Effort 和 Fast 使用现有共享 `CodexModelCatalog` 校验并持久化。用户默认运行参数存储在 Web Chat 用户记录中，不写入项目 `config.yaml`。

## 文件能力

上传文件保存到所属用户 workspace 内的 Gateway 隔离目录。文件名经过清理，单文件大小沿用 30 MB 限制。图片可以作为 Codex 输入，其余文件以工作目录路径写入用户提示。

下载和 Codex 返回文件必须：

- 属于当前用户；
- 位于用户 workspace 真实路径内；
- 不是越界符号链接；
- 存在、非目录、非空且不超过限制。

远程用户不能提交绝对路径读取任意文件。管理员在本机日志抽屉中可以查看附件元数据，但 Secret、密码哈希和 Cookie 永不进入日志。

## 实时事件

远程页面通过用户级 SSE `/api/chat/events` 接收事件。事件包含递增序号、Session ID、类型、时间和可公开负载。

公开事件包括：

- Session 创建、更新、删除和运行状态；
- 用户消息确认；
- 允许展示的 Codex 文本进度；
- 最终回答；
- 上传或生成文件；
- 简化后的失败信息。

原始工具输入输出、命令参数、标准输出和标准错误只写入现有消息跟踪器，供本机管理员查看，不发送到远程 SSE。

SSE 支持 `Last-Event-ID` 续传有限窗口内的事件。窗口缺失时客户端重新拉取 Session 和消息快照。发送消息、停止、切换参数、上传文件等操作使用普通 HTTP API。

## 远程 Chat UI

`/chat` 是独立于管理后台的应用界面，不包含任何管理导航或管理 API 调用。

桌面布局：

- 左侧为 Session 列表和新建按钮；
- 中间为消息流和正常实时过程；
- 顶部显示当前 Session 标题、模型、Effort、Fast 和运行状态；
- 底部为稳定高度的多行输入框、附件、发送和停止控件。

手机布局：

- Session 列表收进侧边抽屉；
- 顶栏提供菜单、标题和运行状态；
- 输入区域固定在底部并适配安全区域；
- 文件和运行参数通过紧凑菜单或抽屉编辑。

页面支持明暗主题并复用 Gateway 主题键。消息使用 Markdown 安全渲染，代码块可复制；生成文件显示下载入口。界面不展示原始 stderr 或完整工具日志。

## 数据流

一次消息请求：

1. Chat API 校验登录 Session、CSRF、账号状态和 Session 所有权。
2. 服务保存用户消息和附件元数据。
3. 对应 Session Router 将消息加入自身队列。
4. Codex 过程事件写入管理员消息跟踪器。
5. 可公开事件经过过滤后写入 SSE 缓冲并推送给当前用户。
6. 最终回答、Session ID、运行参数和真实 Token usage 持久化。
7. 页面通过 SSE 更新；断线时通过消息 API 恢复。

## 错误处理

- 无效登录统一返回相同错误并参与限流；
- 未登录返回 `401`，无效 CSRF 返回 `403`；
- 非本机访问管理路由返回 `403`；
- 跨用户资源访问统一返回 `404`；
- 账号停用返回 `403` 并要求重新登录；
- Session 正在运行时拒绝运行参数更新和删除；
- Codex 失败时保留用户消息和失败状态，远程返回简短说明，完整 stderr 仅管理员可见；
- SSE 断线不停止任务；
- 模型目录、文件上传、越界路径和不支持能力均返回可操作错误。

## 测试

### 服务与安全

- `service.host` 默认 loopback，显式配置后监听 `0.0.0.0`；
- loopback、IPv4 映射 loopback和远程地址分类；
- 远程请求无法访问所有管理页面和管理 API；
- 不信任伪造的 `X-Forwarded-For`；
- 未登录、CSRF、停用账号和登录限流。

### 用户与隔离

- 密码只保存 Argon2id 哈希；
- 用户创建、更新、启停、重置密码和删除；
- 用户工作目录稳定推导；
- 用户之间不能读取 Session、消息、日志、附件和文件；
- 路径穿越和符号链接越界被拒绝。

### Session 与执行

- 新建、重命名、删除、恢复和 Fork；
- 同一 Session 串行，不同 Session 无应用层并发限制；
- 停止、失败和服务重启恢复；
- 模型、Effort、Fast 校验与持久化；
- SSE 事件过滤、续传和快照恢复；
- 真实 Token usage 继续写入项目用量日志。

### UI 与管理频道

- Web Chat 频道状态和用户卡片；
- 管理员实时日志、历史归档和 AI 总结；
- 远程页面不出现管理入口或原始日志；
- 登录、聊天、文件、Session 和运行参数完整流程；
- 桌面、手机、明暗主题、长文本和文件状态。

## 文档与运行

README 和示例配置增加：

```yaml
service:
  host: 0.0.0.0
  port: 18788
```

`codex-gateway run/start/restart/status/stop` 命令保持不变。启动输出同时显示本机管理地址和局域网 Chat 地址。文档明确说明局域网纯 HTTP 不提供传输加密，默认 host 不会自动开放。

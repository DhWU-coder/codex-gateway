# Codex Gateway

把飞书机器人和多用户 Web Chat 消息转发到本机 Codex CLI 的独立网关。

## 安装

```bash
git clone https://github.com/DhWU-coder/codex-gateway.git
cd codex-gateway
bun install
bun link
```

安装后确认命令可用：

```bash
codex-gateway --help
codex-gateway doctor
```

## 快速使用

```bash
codex-gateway init-config
```

编辑项目根目录下的 `config.yaml`，填入飞书开放平台应用的 `appId`、`appSecret` 和机器人 `botOpenId`。

```bash
codex-gateway doctor
codex-gateway start
codex-gateway status
```

`run` 和 `start` 都会后台启动服务；`restart`、`stop`、`status` 用于管理后台进程。启动成功后终端会打印本机管理地址；开放局域网 Chat 时还会打印可访问的 Chat 地址。默认管理地址是 `http://127.0.0.1:18788/`。

## 工作方式

- 私聊消息会直接进入 Codex。
- 群聊消息只有 @ 机器人时才会处理。
- 每个私聊或群聊会维护独立的 Codex session 归档。
- 图片和文件会先保存到账号工作目录下的 `.codex-gateway/`。
- Codex 生成的工作目录内文件会自动上传并回复到原飞书消息。
- `/new` 或 `/clear` 归档当前会话并开启新会话，不会删除旧会话。
- `/stop` 停止当前运行中的会话。
- `/status` 查看当前会话状态。
- `/model` 查看当前模型，`/model list` 列出可用模型，`/model <model_id>` 切换模型，`/model default` 恢复账号默认模型。
- `/effort` 查看当前推理强度，`/effort list` 列出当前模型支持的强度，`/effort <值>` 切换强度，`/effort default` 恢复账号默认值。
- `/fast` 切换 Fast，`/fast on`、`/fast off` 显式开关，`/fast default` 恢复账号默认值。
- `/sessions [数量|all]` 按最近活跃时间查看历史会话。
- `/sessions [数量|all] --summary [数量|all]` 使用 Codex 生成历史会话摘要；省略摘要数量时默认总结 10 个会话。
- `/summary` 总结当前会话，`/summary N` 总结第 N 个历史会话；追加 `--refresh` 会忽略缓存并重新生成。
- `/session` 查看当前会话详情，`/session N` 查看历史列表中第 N 个会话的最近消息。
- `/resume N` 恢复第 N 个已有 Codex 原生 session 的历史会话。
- `/fork N` 复制第 N 个会话的历史，开启一个不复用原生 session 的分支会话。
- `/file 路径` 或 `/sendfile 路径` 手动回传工作目录内的文件。

`/model`、`/effort` 和 `/fast` 只修改当前飞书私聊或群聊 session，不写入 `config.yaml`，并随会话归档持久化，重启服务或 `/resume` 后仍然生效。模型和 Effort 列表来自 Codex CLI 当前账号的动态模型目录；切换时会校验模型支持的 Effort 和 Fast 能力。任务运行期间不能修改这些参数，请等待完成或先发送 `/stop`。

`/sessions` 返回的编号会随最近活跃时间变化。执行中的会话不能 `/resume` 或 `/fork`，请等待完成或先发送 `/stop`。会话摘要会按消息数、摘要模型和提示词版本缓存；批量总结中单个 session 失败不会影响其他结果。

## 文件回传

Codex 需要回传生成文件时，会在最终回复中单独输出：

```text
[[codex:file:路径]]
```

网关会移除这行指令，先发送正常回复，再上传文件。相对路径以当前飞书账号的 Codex 工作目录为基准；绝对路径也必须位于该目录内。文件必须存在、非空且不超过 30MB。

文件不存在、越过工作目录或不符合大小限制时，机器人会在原消息下回复具体的回传失败原因。

## 局域网 Web Chat

Web Chat 默认不对局域网开放。需要使用时，在项目根目录的 `config.yaml` 中显式修改 `service.host`：

```yaml
service:
  host: 0.0.0.0
  port: 18788
```

然后继续使用 Gateway CLI 重启和查看地址：

```bash
codex-gateway restart
codex-gateway status
```

默认由管理员在本机打开 `http://127.0.0.1:18788/`，进入“频道 > Web Chat”创建用户名和密码，并设置用户默认模型、Effort 和 Fast。需要允许局域网用户自助注册时，再显式开启：

```yaml
webChat:
  registrationEnabled: true
```

开放注册默认关闭。开启后，`/chat` 登录卡片会显示“登录 / 注册”切换，用户使用用户名和 8-256 位密码注册，注册成功后自动登录；新用户默认启用，模型、Effort 和 Fast 继承全局配置。每个真实客户端 IP 每小时最多尝试注册 5 次，成功、重名和输入校验失败均计数，登录限流不受影响。该开关支持配置热更新。

本机管理员始终可以在“频道 > Web Chat”中创建、停用、重置密码或删除用户。远程浏览器不能访问用户管理接口。

Web Chat 登录 Session 会保存到项目根目录的 `.codex-gateway/web-chat/auth-sessions.json`，重启服务后保持登录。文件只保存 Session Token 的 SHA-256 哈希，不保存浏览器 Cookie 中的原始 Token；退出登录只撤销当前浏览器，修改密码、管理员重置密码、停用或删除用户会撤销该用户的全部登录。Chat API 返回 `401` 时，页面会清空旧身份和对话缓存并自动返回登录页。

局域网用户访问启动输出中的 `http://<局域网 IP>:18788/chat`，登录后可以：

- 新建、重命名、删除和 Fork Session；桌面端可右键打开会话菜单，移动端可点击省略号或长按；
- 在输入框的模型菜单中切换当前 Session 的模型、Effort 和速度，新 Session 自动继承用户默认值；
- 输入 `/` 打开命令面板，使用 `/model`、`/effort`、`/fast`、`/goal`、`/plan`、`/new`、`/clear`、`/fork`、`/stop`、`/compact`、`/review`、`/permissions`、`/status` 和 `/help`；
- 输入 `@` 引用工作区文件或文件夹，以及当前启用的 Skill、插件、应用；也可以选择、拖拽或粘贴附件；
- 运行期间按时间顺序查看中间回复和工具调用；任务结束后过程自动折叠，最终回复保持展开；
- 上传文件、下载 Codex 生成的文件，并在历史消息中保留附件和引用；
- 重写任意用户消息，从该消息之前的历史创建独立分支；原会话继续保留，原消息的附件和引用会自动继承；
- 停止当前任务，并在断线重连后恢复 Session 与消息。

Web Chat 由 Gateway 进程内一个长驻的 `codex app-server --stdio` 后端处理，复用同一协议连接管理 Thread、Turn、模型目录、命令、引用和实时过程；Gateway 重启后会根据已保存的 Thread ID 恢复会话。飞书频道仍使用 `codex exec --json`，不受 Web Chat 后端切换影响。

所有 Web Chat 用户共享主机当前 Codex 登录和模型额度，但用户记录、Session、文件和工作目录按不可变用户 ID 隔离。Web Chat 强制使用 `workspace-write`，不继承飞书的 `danger-full-access` 或全局 `extraArgs`；联网与实时搜索能力沿用 Gateway 的 Codex 配置。同一 Session 的消息按顺序执行，不同 Session 可以并发，Gateway 不设置应用层并发上限，实际上限取决于主机资源和 Codex 服务。

管理页面、管理 API、完整工具事件、标准输出和标准错误始终只允许本机 loopback 地址访问；Gateway 不信任 `X-Forwarded-For`。远程 Chat 只会收到自己的聊天文本、文件和简化错误。直接使用局域网 IP 的 HTTP 连接没有传输加密，只应在可信局域网或受保护的 VPN 内使用。

开放注册会允许所有能够访问 Chat 地址的人创建账号，因此只应在可信网络中启用；不需要自助注册时应保持 `webChat.registrationEnabled: false`。

## Web UI

管理 Web UI 默认地址是 `http://127.0.0.1:18788/`。即使 `service.host` 设置为 `0.0.0.0`，管理页面和管理 API 仍只允许本机访问；远程仅开放 `/chat` 及其登录后 Chat API。管理 Web UI 包含：

- **概览**：服务 PID、启动时间、端口、频道连接状态、活跃会话和最近配置热更新结果。
- **用量**：读取项目 `.codex-usage/usage.jsonl`，按今日、本周、本月、最近天数或自定义日期统计 Token、模型和工作目录分布。
- **配置**：查看当前项目配置路径、服务参数和 Codex 参数，并编辑全局模型、Effort、Fast 和 Verbosity；Secret 不会出现在通用配置接口中。
- **频道**：管理飞书账号和 Web Chat 用户；支持连接测试、启停、模型、Effort、Fast、Verbosity、飞书实时过程回复和账户专属指令。
- **会话**：从账号卡片打开实时过程抽屉，查看消息、附件、Codex 工具事件、历史归档、AI 总结与强制刷新。
- **日志**：增量查看、搜索、按级别筛选、暂停、复制或下载后台服务日志。
- **服务操作**：使用当前项目的 `config.yaml` 重启服务，或停止后台服务。
- **主题**：使用太阳/月亮按钮切换明暗主题；首次访问跟随系统主题，手动选择会保存在浏览器本地。

配置页和频道页保存后会原子写回项目根目录的 `config.yaml`，后台监听配置文件并按账号热更新。全局模型和账号模型都支持手动输入，或从 Codex CLI 当前账号动态返回的模型列表中选择；模型列表读取失败时仍可直接输入。账号的模型、Effort、Fast 和 Verbosity 留空表示继承全局设置，全局留空表示使用 Codex CLI 默认值。Effort 选项会随模型目录返回的能力变化；已知不支持 Fast 的模型会禁用“开启”选项，自定义模型仍允许配置并提示兼容性未知。

Web UI 中的模型、Effort、Fast 和 Verbosity 变化不会重启服务或重连飞书。已有会话继续使用创建时的运行设置，也可以通过飞书 `/model`、`/effort` 和 `/fast` 为当前 session 单独覆盖；发送 `/new`、`/clear`、`/fork` 或开始新会话后使用最新账号默认设置。账号的启用状态、App ID、App Secret、机器人 `open_id`、域名和 `sendProgressReplies` 也支持热更新；工作目录、历史目录以及历史/摘要策略仍保持只读。单个账号热更新失败不会停止其他账号或整个后台服务，失败信息会显示在概览页。

启用 `sendProgressReplies` 后，Codex 的实时文本输出会按短暂静默窗口合并回复，最终答案不会重复发送。所有请求在处理期间会添加飞书 Typing 状态，结束、失败或停止后自动移除。

## 后台服务

```bash
codex-gateway run
codex-gateway start
codex-gateway restart
codex-gateway status
codex-gateway stop
```

Gateway 的默认数据根目录是当前项目下的 `.codex-gateway/`；服务状态写入 `.codex-gateway/service.json`，日志写入 `.codex-gateway/logs/service.log`，Web Chat 与飞书的频道数据写入 `.codex-gateway/channels/`。可通过环境变量 `CODEX_GATEWAY_HOME` 显式覆盖数据根目录。首次启动时如果默认端口被其他程序占用，会自动顺延到下一个可用端口；执行 `restart` 时会等待原服务释放配置端口并在同一端口恢复监听，避免已打开的 Chat 页面失效。

## 配置

默认读取当前安装的 `codex-gateway` 项目根目录下的 `config.yaml`。项目根目录由 CLI
自身所在位置动态推导，与执行命令时所在目录无关；仓库 clone 到其他电脑或其他路径后，
会自动使用新项目目录中的配置。需要临时使用其他配置时可以显式覆盖：

```bash
codex-gateway doctor --config /path/to/config.yaml
codex-gateway start --config /path/to/config.yaml
```

相对 `--config` 路径仍相对于执行命令时所在目录解析。配置格式参考
[config-example.yaml](config-example.yaml)。

服务监听地址默认只绑定 loopback：

```yaml
service:
  host: 127.0.0.1
  port: 18788
```

只有显式改为 `host: 0.0.0.0` 才会接受局域网连接，并且仍只向远程地址开放 Web Chat。

Web Chat 开放注册默认关闭：

```yaml
webChat:
  registrationEnabled: false
```

设置为 `true` 后允许能够访问 `/chat` 的用户自助注册，注册成功自动登录；本机管理页面仍可管理所有用户。

飞书 headless 任务默认使用完全权限模式，不等待交互审批，并允许 Codex 执行联网命令和实时 Web Search：

```yaml
codex:
  model: gpt-5
  reasoningEffort: high
  fast: true
  verbosity: medium
  sandbox: danger-full-access
  search: true
  dangerouslyBypassApprovalsAndSandbox: true
```

网关会对新会话和恢复会话统一传入 `--dangerously-bypass-approvals-and-sandbox` 和实时搜索配置。这个模式允许 Codex 访问工作目录以外的文件并执行网络请求，仅应在受信任的本机环境和飞书账号中使用。

`reasoningEffort` 控制模型的推理强度，支持值由当前模型决定；`fast: true` 启用 Codex Fast 模式，`fast: false` 明确关闭；`verbosity` 控制最终回答的详略程度，可选 `low`、`medium`、`high`。账号层可使用同名字段覆盖全局配置，删除账号字段则继承全局，删除全局字段则沿用 Codex CLI 默认值。网关生成的参数位于 `extraArgs` 之前，因此 `extraArgs` 可以作为最终覆盖。

每个飞书账号可配置：

```yaml
sendProgressReplies: false
messageDedupeTtlMs: 604800000
history:
  maxMessages: 50
  maxSessions: 100
summary:
  model: gpt-5
  maxMessages: 50
  concurrency: 5
```

飞书事件会在 3 秒内完成确认，Codex 在后台继续处理。已领取的 `message_id` 默认在项目根目录的 `.codex-gateway/channels/feishu/<accountId>/handled-messages.json` 中保留 7 天，服务重启后仍会拦截飞书重投；`messageDedupeTtlMs` 可调整保留时间。

`history.maxSessions` 超限时会删除最旧的非当前归档。会话元信息、索引和摘要使用原子写入；索引或当前指针损坏时会从归档目录自动恢复。

## 频道指令

每个飞书账户启动时都会自动创建固定路径的空文件：

```text
$PROJECT/.codex-gateway/channels/feishu/<accountId>/AGENTS.md
```

文件默认存在但内容为空，空文件不会给 Codex 增加额外指令。可在 Web UI 的频道账户卡片中点击“指令”查看路径、编辑、清空或保存；路径由账户 ID 推导，不能通过 `config.yaml` 修改。文件最大为 32 KiB，保存后从该账户的下一条消息开始生效，已有 Codex session 无需重建。

非空内容会作为 Codex CLI 的 `developer_instructions` 注入，不会拼到飞书用户消息中。`~/.codex/AGENTS.md` 和工作目录中的项目级 `AGENTS.md` 仍由 Codex 原生加载，Gateway 不复制也不重复注入这些全局或项目指令。Gateway 会在账户内容前增加频道作用域说明，使账户专属规则在与通用规则冲突时优先。

## 用量日志

每次 Codex CLI 成功返回真实 token usage 后，网关会追加一行到当前项目目录的 `.codex-usage/usage.jsonl`，可直接供 `codex-usage` 导入。没有真实 usage 时不会估算，也不会记录 prompt、回复正文、密钥或完整请求响应。

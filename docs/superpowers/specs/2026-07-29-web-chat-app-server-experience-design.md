# Web Chat App Server 交互升级设计

## 背景

Codex Gateway 的 Web Chat 当前通过 `codex exec --json` 执行每轮消息。该模式可以恢复
Codex Session 并返回最终回复，但输入以文本和图片为主，无法原生表达 Codex App 使用的
Skill、插件和文件提及，也只能从较粗的 JSONL 事件中提取有限过程信息。

当前页面还存在三类交互缺口：

- 左侧会话列表不能直接重命名或删除。
- 输入框没有 `/` 命令面板和 `@` 引用面板。
- 执行时只公开最终回复，中间回复、推理摘要和工具调用只在管理员日志中可见。

## 目标

- Web Chat 改用 Codex 自带的 `app-server` 协议，飞书继续使用 `codex exec --json`。
- 一个 Gateway 进程共享一个本地 `app-server` 子进程，每个 Web Chat 会话映射到独立
  Codex Thread。
- 支持原生 Skill、插件、应用和工作区文件引用。
- 支持适用于 Web Chat 的 `/` 命令、Goal 和 Plan Mode。
- 实时展示交错的中间回复和工具调用，并在任务结束后折叠、持久化。
- 左侧会话列表支持桌面端右键、移动端长按和 `...` 菜单。
- 将模型、推理强度和速度配置移动到输入框区域，Web Chat 完全移除 Verbosity。
- 保留现有用户、会话、附件和历史数据，不破坏飞书及本地管理页面。

## 非目标

- 不把 `app-server` 端口暴露到局域网或公网。
- 不允许 Web Chat 用户安装、卸载或配置插件、应用和 Skills。
- 不复制 `/ide`、`/keymap`、`/vim` 等仅适用于 Codex TUI 的命令。
- 不允许外部 Web Chat 用户切换到 `danger-full-access`。
- 不迁移飞书执行链路。
- 不把 Codex 原始事件、环境变量或认证信息直接返回给浏览器。

## 总体架构

### App Server 生命周期

新增独立的 App Server 客户端组件，负责：

- 启动 `${codexCommand} app-server --stdio`。
- 完成 JSON-RPC 初始化握手。
- 为并发请求分配请求 ID，并将响应和通知分发给对应 Thread/Turn。
- 提供 Thread、Turn、模型、Skill、插件、应用和文件检索所需的窄接口。
- 检测进程退出、拒绝未完成请求、按退避策略重启并重新初始化。
- Gateway 停止时终止子进程并清理监听器。

App Server 只通过子进程标准输入输出与 Gateway 通信，不新增 HTTP 或 WebSocket 监听端口。
多个 Web Chat 用户共享该进程，但业务层只能通过自己 Session 保存的 Thread ID 操作 Thread。

### Thread 映射

每个 `WebChatSessionRecord` 增加可选 `threadId`。新会话第一次发送消息时调用
`thread/start`，保存返回的 Thread ID；后续按需调用 `thread/resume` 和 `turn/start`。

现有 Web Chat 会话优先使用历史元数据中的 Codex `sessionId` 调用 `thread/resume`。如果
旧 Thread 已不存在或无法恢复，则创建新 Thread，并将 Gateway 保存的近期对话历史作为首轮
上下文继续。页面历史不因恢复失败而删除。

Gateway 启动时不批量恢复全部 Thread。用户打开或发送到某个会话时才按需恢复，从而控制
启动时间和内存占用。

### 用户隔离与权限

- Thread 的 `cwd` 和运行时工作区根目录固定为当前 Web Chat 用户的工作目录。
- `@文件` 搜索只把当前用户工作目录作为 `fuzzyFileSearch` 根目录。
- HTTP API 继续先校验登录 Session 和资源所有权，再访问 Web Chat Session、Trace 或文件。
- App Server 请求中的权限保持 Web Chat 的安全配置，禁止通过 `/permissions` 选择
  `danger-full-access`。
- Skills、插件和应用目录来自本机 Codex，Web Chat 只提供已启用或已安装项目的选择与调用。

### 故障隔离

App Server 不可用时 Web Chat 状态变为不可执行并返回明确错误，飞书和 Gateway 管理页面继续
运行。进程异常退出时，所有未完成 Turn 标记为中断，已持久化消息和 Trace 保留。App Server
重启后，下一次访问按 Thread ID 恢复会话。

## App Server 协议边界

业务层只依赖以下能力，不直接依赖完整生成协议：

- `thread/start`、`thread/resume`、`thread/fork`、`thread/name/set`、`thread/delete`
- `turn/start`、`turn/interrupt`
- `thread/compact/start`
- `thread/goal/get`、`thread/goal/set`、`thread/goal/clear`
- `thread/settings/update` 和 `collaborationMode/list`
- `review/start`
- `model/list`、`permissionProfile/list`
- `skills/list`、`plugin/installed`、`app/installed`
- `fuzzyFileSearch`
- Turn 和 Item 相关通知

生成协议版本变化集中在协议适配层处理。业务层使用 Gateway 自己定义的稳定类型，例如
`WebChatThreadInput`、`WebChatActivity` 和 `WebChatCapabilityReference`。

## 会话列表

### 桌面端

左侧会话项不常驻编辑按钮。用户右键某项后打开上下文菜单，提供：

- 重命名
- 删除

重命名切换为列表内输入框，`Enter` 保存，`Esc` 取消，失焦时保存非空改动。删除前显示二次
确认。正在运行的会话允许重命名但禁止删除。

### 移动端

每个会话项显示 `...` 按钮，同时支持长按。两个入口复用同一个菜单和操作逻辑。长按触发后
阻止随后的普通点击，避免菜单打开后又切换会话。

### 服务端

继续复用现有 Session `PATCH` 和 `DELETE` API。重命名成功时同步调用
`thread/name/set`；Thread 同步失败不回滚 Gateway 标题，但记录警告并在下次恢复时重试。
删除成功时删除 Gateway Session、Trace 和附件引用，并尽力调用 `thread/delete`。

## 输入与命令面板

### `/` 命令

当输入框以 `/` 开头时打开命令面板。面板支持模糊过滤、方向键、`Enter`、`Esc` 和触摸选择。
只展示 Web Chat 中具有真实行为的命令：

- `/model`：打开模型选择。
- `/effort`：打开当前模型支持的推理强度选择。
- `/fast`：查看或切换标准/Fast。
- `/goal`、`/goal <内容>`、`/goal clear`：查看、设置或清除当前 Thread 目标。
- `/plan`、`/plan on`、`/plan off`：查看或切换 Plan Mode。
- `/new`：创建并打开新会话。
- `/clear`：保留页面历史记录，创建空上下文 Thread 并让当前会话从空上下文继续。
- `/fork`：分支当前会话。
- `/stop`：中止当前 Turn。
- `/compact`：调用 Codex 原生上下文压缩。
- `/review`：打开审查范围选择并启动原生 Review。
- `/permissions`：打开 Gateway 允许的权限配置选择。
- `/status`：显示模型、Effort、Fast、Goal、Plan Mode 和上下文状态。
- `/help`：列出可用命令。

选择需要参数的命令时优先打开二级选择面板，不要求用户记忆参数。无效参数在输入框附近显示
错误，不把命令当普通 Prompt 发送。

Web Chat 不提供 `/verbosity`，也不再读取或修改会话的 Verbosity。已有数据字段保持兼容，
避免旧配置解析失败。

### `@` 引用

输入 `@` 时打开分组面板：

- 工作区文件和文件夹
- 已启用 Skills
- 已安装插件和应用

工作区文件使用 App Server 的模糊文件搜索；Skills、插件和应用使用对应目录接口。选中项在
输入框中显示为可移除标签，并在发送时转换为 App Server 原生输入：

- Skill 使用 `type: "skill"`，携带目录返回的名称和 Skill 路径。
- 工作区文件和文件夹使用 `type: "mention"`，服务端校验并填写当前用户工作区内的绝对路径。
- 插件优先映射到其已安装 Skill；只有 App/MCP 能力而没有 Skill 的插件，以及独立应用，
  使用 `additionalContext` 的 `application` 类型携带稳定 ID、名称和能力描述，同时在文本中
  保留对应的 `@名称` 占位。该映射只影响本轮能力提示，不授予安装或配置权限。
- 普通文字继续使用 `type: "text"`。
- 已上传图片和文件继续使用现有上传仓库，并转换为本地图片或文件上下文。

历史消息只保存引用名称、类型和稳定标识，不向浏览器返回服务器完整绝对路径。

### `+` 菜单

输入框左侧 `+` 按钮打开与 `@` 共用的数据和选择组件，额外包含“上传本地文件”。本地上传、
拖拽、粘贴和结构化引用可以在同一条消息中混用。

## 模型配置

顶部栏移除模型、Effort、Fast 和 Verbosity 控件。输入框右下角显示组合按钮，例如
`5.6 Sol · 极高`。点击后打开分层菜单：

- 模型
- 推理强度
- 速度：标准/Fast
- 高级设置入口

模型列表来自 App Server `model/list`。推理强度只显示当前模型支持的选项。Fast 映射为
App Server Thread/Turn 的 `serviceTier`；标准速度使用默认 Tier，Fast 使用 Codex 当前版本
公布的 Fast Tier。模型或账户不支持 Fast 时显示原因并禁止选择。更改立即写入当前 Web Chat
Session 和对应 Thread 设置，新会话仍按用户配置、Gateway 全局配置和 Codex 默认值的既有
优先级继承。

Web Chat 页面和命令面板完全移除 Verbosity；后端保留旧字段的兼容读取，但不再通过 Web
Chat 更新该字段。

## 执行过程

### Trace 数据模型

每条用户消息创建一个 `WebChatTurnTrace`，至少包含：

- Gateway `messageId` 和 `assistantMessageId`
- Codex `threadId` 和 `turnId`
- 状态：运行中、完成、失败或停止
- 开始、更新时间、结束时间和耗时
- 当前步骤、步骤总数、最新活动摘要
- 文件变化统计
- 顺序排列的中间回复和工具组
- 失败信息

Trace 单独保存在当前 Web Chat Session 目录，不写入飞书共用的 `messages.jsonl`。运行中采用
内存构建器并对磁盘快照做节流写入；最终状态立即原子写入。页面获取 Session 时同时返回消息
和对应 Trace。

### 事件标准化

App Server Item 通知转换为白名单内的稳定活动类型：

- 中间回复
- 推理摘要
- 计划更新
- 命令执行
- 文件修改
- Web 搜索
- MCP/插件工具调用
- 动态工具调用
- 图片查看
- 上下文压缩
- 错误

中间回复与最终回复按消息阶段区分。中间回复进入 Trace；最终回复写入正式 Assistant 消息，
不得在两处重复。

工具输入和输出先进行敏感字段过滤，再按长度限制保存。原始事件只进入 Gateway 运行日志，
不通过 Chat API 返回。

### 运行中时间线

过程按实际顺序交错显示：

1. 中间回复直接显示。
2. 紧随其后的一个或多个工具调用合并为一个工具组。
3. 工具组默认折叠为自然语言摘要，用户可展开查看每个调用的状态、耗时、参数和结果。
4. 后续中间回复继续显示在该工具组之后。

最新工具调用实时更新，已完成工具组保留在原位置。输入框上方固定显示运行状态条，例如
“第 8/8 步 · 正在运行浏览器验证 · 已修改 13 个文件”。状态条显示最新活动、步骤和文件
变化，点击后滚动到当前过程位置。

### 完成后的折叠

执行中 Trace 默认展开。Turn 成功、失败或停止后，整段 Trace 自动折叠为摘要，例如
“完成 · 运行 6 个工具 · 42 秒”。最终回复保持展开。用户仍可展开 Trace 查看完整过程，
刷新或重启后内容继续存在。

若执行失败，已发生的过程照常保存，折叠块显示失败状态和经过处理的错误信息。普通 Codex
警告不会被标记为任务失败。

## 实时事件

公开 SSE 增加结构化 `message.activity` 和 Trace 状态事件。事件载荷只包含业务白名单字段，
不允许透传 `stdout`、`stderr`、原始命令对象或未知嵌套数据。

浏览器断线重连时：

1. 若 SSE 缓冲区仍包含缺失事件，则按事件 ID 重放。
2. 若缓冲区已经淘汰事件，则重新读取当前 Session 和 Trace 快照。
3. 客户端按活动稳定 ID 合并，避免重复渲染。

## API 变化

新增或扩展以下 Web Chat API：

- Session 详情返回消息和 Trace。
- 发送消息接收结构化引用列表。
- Capability API 返回命令、Skills、已安装插件/应用。
- 文件搜索 API 只接受查询文本，根目录由服务端根据登录用户决定。
- Goal、Plan、Compact、Review、Permissions 和 Clear 使用窄用途 Session API。

所有 API 继续使用现有 Web Chat 登录 Cookie，并校验 Session、文件和 Thread 映射的用户
所有权。

## 错误处理

- App Server 启动、握手或协议不兼容时，Web Chat 返回可诊断错误并在 Channel 状态中标记
  不可用。
- 请求超时后移除请求关联；迟到响应记录为调试日志但不污染其他请求。
- App Server 退出时拒绝全部未完成请求，并把运行中 Trace 标为中断。
- Thread 恢复失败时只执行一次历史回退，避免循环创建 Thread。
- Capability 目录读取失败时允许普通文字和上传文件继续发送，并在面板中显示对应分类暂不可用。
- Trace 写入失败不丢弃最终回复，但记录错误并在 UI 显示“过程记录未完整保存”。
- 删除和重命名 API 保持幂等语义，重复删除返回资源不存在而不影响其他会话。

## Doctor 与日志

`codex-gateway doctor` 增加：

- App Server 进程可启动和完成握手。
- 模型目录可读取。
- Skill 和插件/应用目录可读取。

运行日志记录 App Server 生命周期、协议错误、Thread 恢复回退和 Trace 写入失败。日志不得
记录认证 Token、用户密码或未过滤的插件凭据。

## 测试策略

### 单元测试

- 使用可控假 App Server 子进程测试握手、并发请求、通知路由、超时、退出和重启。
- 测试 Thread 映射、旧 `codex exec` Session 恢复和历史回退。
- 测试命令解析、Goal、Plan、Clear、Compact、Review 和安全权限过滤。
- 测试 Skill、插件、应用和文件引用转换为结构化 `UserInput`。
- 测试 App Server Item 到 Trace 活动的标准化、工具分组、脱敏、截断和最终消息去重。
- 测试 Trace 节流快照、最终原子写入、重启读取和失败/停止状态。
- 测试 Session 列表右键、长按、重命名和删除所需的页面结构与脚本行为。

### 集成测试

- HTTP API 用户隔离、结构化引用、命令和 Trace 返回。
- SSE 活动实时推送、断线重放、快照回退和去重。
- 多个用户、多个 Thread 并发执行，不设置人为并发上限。
- 旧会话、附件和历史 API 保持兼容。

### 端到端验证

使用本机真实 App Server 验证：

- 新建、恢复、分支、重命名和删除会话。
- 模型、Effort、Fast、Goal 和 Plan Mode。
- `@文件`、Skill、插件/应用及本地上传附件。
- 中间回复、工具组、最新活动状态条和完成后折叠。
- Stop、失败和 Gateway/App Server 重启恢复。
- 桌面端右键与移动端 `...`、长按，以及桌面和移动端响应式布局。

最终运行完整测试、类型检查和构建。

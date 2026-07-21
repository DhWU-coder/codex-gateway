# 飞书 Session 运行参数命令设计

## 目标

允许飞书用户在当前私聊或群聊 session 内查看、列举和切换 Codex 模型、推理强度与 Fast 模式。设置只作用于当前 session，写入 session 归档并在服务重启或 `/resume` 后继续生效，不修改项目 `config.yaml` 或账户默认值。

## 命令

### 模型

- `/model`：显示当前 session 模型。
- `/model list`：列出 Codex 当前可用模型并标记当前模型与 CLI 默认模型。
- `/model <model_id>`：切换为模型目录中的指定模型。
- `/model default`：恢复当前账户继承后的默认模型。

模型 ID 同时接受目录项的 `model` 和 `id`，持久化时统一保存目录项的 `model`。

### Effort

- `/effort`：显示当前 session Effort。
- `/effort list`：列出当前模型支持的 Effort，并标记当前值与模型默认值。
- `/effort <value>`：切换为当前模型支持的 Effort。
- `/effort default`：恢复当前账户继承后的默认 Effort。

如果当前模型不在目录中或目录没有返回可用 Effort，命令返回明确错误，不猜测模型能力。

### Fast

- `/fast`：切换当前 session 的 Fast 开关。
- `/fast on`、`/fast off`：显式开启或关闭。
- `/fast default`：恢复当前账户继承后的默认值。

开启 Fast 前根据模型目录校验当前模型是否支持；关闭 Fast 与恢复默认值不依赖模型能力。

## 数据流

服务启动时创建一份现有 `CodexModelCatalog`，同时传给 Web UI 和 Channel Manager。每个飞书 Channel 通过共享 provider 获取同一份带 TTL 缓存的模型列表，不为每个账户重复启动 app-server。

Channel 解析命令并负责模型能力查询与用户回复。Session Router 提供当前 session 设置更新接口，负责：

- 拒绝执行中的 session 更新；
- 在没有当前归档时创建空归档；
- 更新模型、Effort 或 Fast 字段；
- 将 `runtimeSettingsCaptured` 设为 `true`；
- 原子写回 session 元数据；
- 返回更新后的有效设置。

下一次 Codex 调用继续通过现有 `buildRunnerInput` 读取 session 快照，因此新执行和 `codex exec resume` 都使用更新后的参数。

## 错误处理

- 命令格式无效时返回用法，不发送给 Codex。
- 当前 session 正在执行时拒绝切换，避免运行参数与在途请求竞争。
- 模型目录读取失败时返回原始错误摘要，不修改 session。
- 模型不存在、Effort 不受支持或模型不支持 Fast 时返回可操作提示，不修改 session。
- `/model default`、`/effort default`、`/fast default` 始终恢复账户当前默认值。

## 状态展示

`/status` 增加 Effort 与 Fast 行。无显式值时分别显示 `CLI 默认`，Fast 默认显示为 `开启`、`关闭` 或 `CLI 默认`。

## 测试

- Router 测试当前 session 更新、持久化、恢复和运行中拒绝。
- Channel 测试所有命令分支、动态目录标记、别名归一化与错误回复。
- Daemon 测试 Web 和 Channel 共用同一个模型目录 provider。
- README 测试继续保证用户文档只展示 `codex-gateway` 命令。

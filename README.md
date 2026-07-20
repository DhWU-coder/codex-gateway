# Codex Gateway

把飞书机器人 WebSocket 消息转发到本机 Codex CLI 的独立网关。

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

`run` 和 `start` 都会后台启动服务；`restart`、`stop`、`status` 用于管理后台进程。启动成功后终端会打印 Web UI 地址，默认是 `http://127.0.0.1:18788/`。

## 工作方式

- 私聊消息会直接进入 Codex。
- 群聊消息只有 @ 机器人时才会处理。
- 每个私聊或群聊会维护独立的 Codex session 归档。
- 图片和文件会先保存到账号工作目录下的 `.codex-gateway/`。
- Codex 生成的工作目录内文件会自动上传并回复到原飞书消息。
- `/new` 或 `/clear` 归档当前会话并开启新会话，不会删除旧会话。
- `/stop` 停止当前运行中的会话。
- `/status` 查看当前会话状态。
- `/sessions [数量|all]` 按最近活跃时间查看历史会话。
- `/sessions [数量|all] --summary [数量|all]` 使用 Codex 生成历史会话摘要；省略摘要数量时默认总结 10 个会话。
- `/summary` 总结当前会话，`/summary N` 总结第 N 个历史会话；追加 `--refresh` 会忽略缓存并重新生成。
- `/session` 查看当前会话详情，`/session N` 查看历史列表中第 N 个会话的最近消息。
- `/resume N` 恢复第 N 个已有 Codex 原生 session 的历史会话。
- `/fork N` 复制第 N 个会话的历史，开启一个不复用原生 session 的分支会话。
- `/file 路径` 或 `/sendfile 路径` 手动回传工作目录内的文件。

`/sessions` 返回的编号会随最近活跃时间变化。执行中的会话不能 `/resume` 或 `/fork`，请等待完成或先发送 `/stop`。会话摘要会按消息数、摘要模型和提示词版本缓存；批量总结中单个 session 失败不会影响其他结果。

## 文件回传

Codex 需要回传生成文件时，会在最终回复中单独输出：

```text
[[codex:file:路径]]
```

网关会移除这行指令，先发送正常回复，再上传文件。相对路径以当前飞书账号的 Codex 工作目录为基准；绝对路径也必须位于该目录内。文件必须存在、非空且不超过 30MB。

文件不存在、越过工作目录或不符合大小限制时，机器人会在原消息下回复具体的回传失败原因。

## Web UI

Web UI 仅监听本机 `127.0.0.1`，默认地址是 `http://127.0.0.1:18788/`，包含：

- **概览**：服务 PID、启动时间、端口、频道连接状态、活跃会话和最近配置热更新结果。
- **用量**：读取项目 `.codex-usage/usage.jsonl`，按今日、本周、本月、最近天数或自定义日期统计 Token、模型和工作目录分布。
- **配置**：查看当前项目配置路径、服务参数和 Codex 参数；Secret 不会出现在通用配置接口中。
- **频道**：添加、编辑或删除飞书账号，脱敏显示 App Secret，执行无消息连接测试，并管理账号启用状态和实时过程回复。
- **会话**：从账号卡片打开实时过程抽屉，查看消息、附件、Codex 工具事件、历史归档、AI 总结与强制刷新。
- **日志**：增量查看、搜索、按级别筛选、暂停、复制或下载后台服务日志。
- **服务操作**：使用当前项目的 `config.yaml` 重启服务，或停止后台服务。
- **主题**：使用太阳/月亮按钮切换明暗主题；首次访问跟随系统主题，手动选择会保存在浏览器本地。

频道页保存配置后会原子写回项目根目录的 `config.yaml`，后台监听配置文件并按账号热更新。账号的启用状态、App ID、App Secret、机器人 `open_id`、域名和 `sendProgressReplies` 支持热更新；模型、工作目录、历史目录以及历史/摘要策略在页面中保持只读，需要修改后重启服务。单个账号热更新失败不会停止其他账号或整个后台服务，失败信息会显示在概览页。

启用 `sendProgressReplies` 后，Codex 的实时文本输出会按短暂静默窗口合并回复，最终答案不会重复发送。所有请求在处理期间会添加飞书 Typing 状态，结束、失败或停止后自动移除。

## 后台服务

```bash
codex-gateway run
codex-gateway start
codex-gateway restart
codex-gateway status
codex-gateway stop
```

服务状态写入 `~/.codex-gateway/service.json`，日志写入 `~/.codex-gateway/logs/service.log`。如果默认端口被占用，会自动顺延到下一个可用端口。

## 配置

默认读取项目根目录下的 `config.yaml`。参考 [config-example.yaml](config-example.yaml)。

每个飞书账号可配置：

```yaml
sendProgressReplies: false
messageDedupeTtlMs: 600000
history:
  maxMessages: 50
  maxSessions: 100
summary:
  model: gpt-5
  maxMessages: 50
  concurrency: 5
```

`history.maxSessions` 超限时会删除最旧的非当前归档。会话元信息、索引和摘要使用原子写入；索引或当前指针损坏时会从归档目录自动恢复。

## 用量日志

每次 Codex CLI 成功返回真实 token usage 后，网关会追加一行到当前项目目录的 `.codex-usage/usage.jsonl`，可直接供 `codex-usage` 导入。没有真实 usage 时不会估算，也不会记录 prompt、回复正文、密钥或完整请求响应。

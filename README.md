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
- `/session` 查看当前会话详情，`/session N` 查看历史列表中第 N 个会话的最近消息。
- `/resume N` 恢复第 N 个已有 Codex 原生 session 的历史会话。
- `/fork N` 复制第 N 个会话的历史，开启一个不复用原生 session 的分支会话。
- `/file 路径` 或 `/sendfile 路径` 手动回传工作目录内的文件。

`/sessions` 返回的编号会随最近活跃时间变化。执行中的会话不能 `/resume` 或 `/fork`，请等待完成或先发送 `/stop`。会话摘要按消息数缓存，历史没有变化时不会重复调用 Codex。

## 文件回传

Codex 需要回传生成文件时，会在最终回复中单独输出：

```text
[[codex:file:路径]]
```

网关会移除这行指令，先发送正常回复，再上传文件。相对路径以当前飞书账号的 Codex 工作目录为基准；绝对路径也必须位于该目录内。文件必须存在、非空且不超过 30MB。

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

## 用量日志

每次 Codex CLI 成功返回真实 token usage 后，网关会追加一行到当前项目目录的 `.codex-usage/usage.jsonl`，可直接供 `codex-usage` 导入。没有真实 usage 时不会估算，也不会记录 prompt、回复正文、密钥或完整请求响应。

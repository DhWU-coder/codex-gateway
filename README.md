# Codex Gateway

把飞书机器人 WebSocket 消息转发到本机 Codex CLI 的独立网关。

## 快速使用

```bash
bun install
bun run src/index.ts init-config
```

编辑 `~/.codex-gateway/config.yaml`，填入飞书开放平台应用的 `appId`、`appSecret` 和机器人 `botOpenId`。

```bash
bun run src/index.ts doctor
bun run src/index.ts start
bun run src/index.ts status
```

也可以通过 bin 脚本运行：

```bash
./bin/codex-gateway.cjs start
```

`run` 和 `start` 都会后台启动服务；`restart`、`stop`、`status` 用于管理后台进程。启动成功后终端会打印 Web UI 地址，默认是 `http://127.0.0.1:18788/`。

## 工作方式

- 私聊消息会直接进入 Codex。
- 群聊消息只有 @ 机器人时才会处理。
- 每个私聊或群聊会维护一个当前 Codex session。
- 图片和文件会先保存到账号工作目录下的 `.codex-gateway/`。
- `/new` 或 `/clear` 开启新会话。
- `/stop` 停止当前运行中的会话。
- `/status` 查看当前会话状态。

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

参考 [config-example.yaml](config-example.yaml)。

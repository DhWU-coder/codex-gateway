# 用量待入账状态设计

## 背景

Codex Gateway 已按 `codex-usage/log-README.md` 在成功请求完成后，将 Codex CLI 返回的真实用量追加到项目目录下的 `.codex-usage/usage.jsonl`。长时间运行的任务尚未完成时没有最终用量记录，管理台用量页因此显示全零，容易被理解为日志功能失效。

## 目标

- 用量接口返回当前活跃会话数。
- 用量页明确提示有任务正在执行，用量将在完成后入账。
- 用量页可见期间自动刷新，任务结束后及时展示新写入的记录。
- 成功请求继续写入真实用量；失败、中断或没有真实用量的请求不写入、不估算。

## 方案

`/api/usage` 在原有统计结果上附加 `activeSessions`。该值来自频道管理器已有的运行状态，不进入用量 JSONL，也不参与 Token 汇总。

管理台增加待入账提示区域。当 `activeSessions > 0` 时显示任务数量和结算说明；为零时隐藏。管理台现有两秒状态轮询在用量页可见时同步刷新用量接口，因此任务完成并落盘后，页面无需手工点击刷新即可更新。

## 数据边界

- `.codex-usage/usage.jsonl` 只保存 `turn.completed` 中能够解析出的真实用量。
- 当前 Codex CLI 未返回 `total_tokens` 时，使用其真实 `input_tokens + output_tokens` 生成必填总量；缓存和推理字段不重复计入。
- Codex CLI 非零退出、被中止或没有返回 usage 时不产生记录。
- 不读取 `~/.codex/sessions` 等私有文件，不根据文本长度估算 Token。

## 测试

- Web API 测试验证 `activeSessions` 随用量数据返回。
- 页面测试验证待入账提示及定时刷新逻辑存在。
- Runner 测试验证成功请求写入，非零退出和中断请求均不写入。

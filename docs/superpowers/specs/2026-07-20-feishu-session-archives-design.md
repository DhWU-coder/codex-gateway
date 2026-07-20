# 飞书多 Session 归档设计

## 目标

为 Codex Gateway 补齐与 Claudish 对齐的飞书会话管理能力：保留 `/new`、`/clear`、`/stop` 和 `/status`，新增 `/sessions`、`/session`、`/resume`、`/fork` 及 `--summary`，并保证新建会话不再删除旧历史。

## 方案

采用按飞书 `conversationKey` 隔离的多归档存储。每个归档拥有独立 `archiveId`，Codex 首次执行返回的原生 `sessionId` 作为可选字段写回。会话目录维护 `index.json` 和 `current.json`，每个归档目录保存 `session.json`、`messages.jsonl` 和可选的 `summary.json`。

目录结构：

```text
<historyBaseDir>/<conversationKey-base64url>/
  index.json
  current.json
  session-<uuid>/
    session.json
    messages.jsonl
    summary.json
```

旧版本位于会话目录根部的 `session.json` 与 `messages.jsonl` 会在第一次读取时迁移为首个归档。迁移后保留旧文件作为兼容备份，新逻辑只读写归档目录。

## 会话语义

- `/new`、`/clear`：中止当前执行，创建空归档并切为当前归档，旧归档继续保留。
- `/stop`：只中止并移除内存中的运行队列，不修改当前归档；下一条消息仍可继续当前 Codex session。
- `/sessions [数量|all]`：按最近活跃时间列出归档，默认全部列出。
- `/sessions [数量|all] --summary [数量|all]`：对选中的非空归档生成或读取摘要。
- `/session`：显示当前归档详情。
- `/session N`：显示列表中第 N 个归档的最近历史。
- `/resume N`：将第 N 个已建立 Codex 原生 session 的归档切为当前归档。
- `/fork N`：复制第 N 个归档的消息到一个新归档；新归档首次执行时把复制的历史作为上下文，不复用原生 session ID。

执行中的会话不允许 `/resume` 或 `/fork`，需要等待完成或先 `/stop`。编号始终对应当前 `/sessions` 的排序结果。

## 摘要

摘要通过现有 Codex runner 发起独立请求，要求返回 `topic`、`keyInfo` 和 `recentAction` 三个字段。`summary.json` 记录生成时的消息数；消息数未变化时直接使用缓存，变化后重新生成。并发上限为 5，避免一次 `/sessions --summary all` 拉起过多 Codex 进程。

## 状态与回复

`/status` 返回运行状态、账号、conversation key、模型、工作目录、当前归档、原生 session ID 和消息数。历史列表标识当前/历史、更新时间、消息数、是否可直接 resume、fork 来源及预览或摘要。

## 异常处理

- 损坏或缺失的索引、指针、归档元数据按空数据处理，不让飞书事件处理进程崩溃。
- `/resume` 拒绝空归档或尚未获得原生 session ID 的归档。
- 无效编号返回明确提示，不改变当前归档。
- 摘要不是合法 JSON 时使用纯文本兜底，确保命令仍能返回结果。

## 测试

- 存储测试覆盖创建、归档列表、迁移、恢复、fork、摘要缓存。
- 路由测试覆盖新建不丢历史、恢复原生 session、fork 历史上下文、处理中拒绝切换和摘要缓存。
- 飞书频道测试覆盖所有命令解析、回复格式和无效选择。
- 最后运行完整测试、TypeScript 类型检查和 Bun 构建。

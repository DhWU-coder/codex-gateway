# Codex Gateway 可观测性与 AI 增强设计

## 目标

在现有飞书文件回传和多 session 归档基础上，补齐 Claudish 已有的运行过程可观测性，并增强 AI 总结、长期运行稳定性、飞书交互和 Web UI 管理能力。

## 总体架构

数据流分为四层：Codex runner 按 JSONL 行产生结构化进度事件；session router 把每次请求专属的输出和进度回调绑定到队列；Feishu channel 用消息追踪器记录阶段、事件、附件、输出与错误；Web UI 从 ChannelManager 的结构化 API 获取状态、执行连接测试和更新允许运行时修改的配置。

所有 Web API 继续只监听 `127.0.0.1`。Web UI 不读取或返回 `appSecret` 等凭据，只允许热更新 `sendProgressReplies`。

## Codex 流式事件

`runCodex` 在保留完整 stdout 和最终结果解析的同时，逐行消费 stdout JSONL，并输出以下事件：

- `assistant_text`：Codex 中间或最终文本。
- `tool_start`：命令、MCP、文件修改、搜索等工具开始。
- `tool_result`：工具完成结果与错误状态。
- `stderr`：Codex stderr 片段。

session router 为每条排队消息保留独立 `onProgress` 回调，确保同一飞书会话中的并发请求不会串到错误消息。最终文本与已发送进度文本完全相同时不重复回复。

## 消息追踪与飞书体验

新增最多保留 50 条消息的内存追踪器，记录 `received`、下载附件、排队、模型处理、回复、完成、失败和停止阶段，以及耗时、输出、工具事件和附件。

飞书收到消息后添加 `Typing` reaction，处理结束后移除。`sendProgressReplies` 开启时，assistant 进度经过短暂静默合并后回复到原消息。自动文件回传全部无效时，向用户回复明确错误，不再只写服务日志。

消息防重从无限增长的 `Set` 改为带 10 分钟 TTL 的 Map，每次接收消息时清理过期 ID。

## AI 总结

保留 `/sessions --summary`，新增：

- `/summary`：总结当前归档。
- `/summary N`：总结第 N 个归档。
- `/summary N --refresh`：忽略缓存重新生成。

批量总结按 session 隔离错误，单个失败不会使整条命令失败。摘要缓存记录消息数、摘要模型和 prompt 版本；任一变化都会失效。配置支持摘要模型、读取消息上限和并发数。

## 历史存储

历史配置支持 `maxMessages` 和 `maxSessions`。消息追加直接维护元数据中的消息数与预览，不再每次扫描整个 JSONL。fork 通过一次性复制消息文件完成，避免逐条写入产生平方级开销。

`session.json`、`index.json`、`current.json` 和 `summary.json` 使用同目录临时文件加 rename 原子替换。索引或当前指针缺失、损坏时，从归档目录重建。创建新归档后清理超出保留上限的最旧非当前归档。

## Web UI 与 API

监控页面提供：

- 服务 PID、启动时间、工作目录和日志路径。
- 账号连接状态、活动 session 数、模型、工作目录和进度回复开关。
- 最近 session 列表，展示阶段、耗时、发送人、消息预览和错误。
- session 详情，展示消息时间线、Codex 文本、工具事件和附件。
- 历史归档列表与 AI 摘要，支持刷新单个摘要。
- 飞书连接测试和 `sendProgressReplies` 运行时开关。

新增 Web API 通过 ChannelManager 委托到目标频道，未知频道、非法 JSON 和不支持的操作返回 4xx；内部执行失败返回带错误信息的 5xx。

## 兼容性

现有 `config.yaml` 无需修改。缺失的新字段使用默认值：历史消息 50、历史归档 100、摘要消息 50、摘要并发 5、防重 TTL 10 分钟。旧归档和摘要文件继续读取；旧摘要会因缺少 prompt 版本自动重新生成。

## 测试

- JSON 事件测试覆盖 Codex 实际的 `item.started/item.completed` 形态和分块行读取。
- runner 与 router 测试覆盖流式回调、队列绑定和最终回复去重所需数据。
- tracker、reaction、TTL、防重、连接测试和文件错误反馈各有独立测试。
- 历史测试覆盖原子写、索引恢复、保留策略、批量 fork 和摘要缓存版本。
- Web API 与页面测试覆盖监控数据、运行配置、连接测试、归档和摘要刷新。
- 完成后运行完整 Bun 测试、TypeScript 类型检查、构建和 `git diff --check`。

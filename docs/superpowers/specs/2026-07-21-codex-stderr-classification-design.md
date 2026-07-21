# Codex 标准错误日志分级设计

## 目标

让 Web UI 准确表达 Codex CLI 写入标准错误流的内容，避免把普通警告和运行日志统一显示为“标准错误”，同时消除网关与 Codex App 共用模型缓存时的版本不兼容错误。

## Codex 命令

项目私有 `config.yaml` 的 `codex.command` 改为 `/Applications/ChatGPT.app/Contents/Resources/codex`。该命令与当前写入 `~/.codex/models_cache.json` 的 Codex App 使用同一版本，避免 `0.144.5` CLI 读取 `0.145.0` 缓存时缺少 `supports_reasoning_summaries` 字段。

`config-example.yaml` 继续使用通用的 `codex`，不把本机应用路径写入项目示例。

## 日志分级

底层事件协议保持 `stderr` 不变，Web UI 在渲染时根据日志文本分级：

- 包含独立单词 `ERROR`、`FATAL` 或 `PANIC`：显示“Codex 错误”。
- 包含独立单词 `WARN` 或 `WARNING`：显示“Codex 警告”。
- 其他标准错误输出：显示“Codex 运行日志”。

匹配不区分大小写。错误优先于警告，避免一段混合日志被弱化为警告。

## 展示

日志仍使用可展开详情并保留原始文本。错误使用现有危险色，警告使用现有警告色，普通日志维持中性色。该分级只影响 Web UI 标题和颜色，不改变消息状态、Codex 退出码、飞书回复或日志存储。

## 验证

页面测试覆盖三类标题、分级函数和样式。完成后运行 Web 定向测试、完整测试、类型检查、构建和差异检查，再用项目配置重启后台服务，确认两路飞书频道保持连接。

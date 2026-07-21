# Codex 无害告警展示过滤设计

## 目标

让 Web UI 的实时会话详情聚焦可操作的 Codex 运行信息，不再展示当前已确认无害的插件图标路径告警和技能遥测标签告警，同时完整保留原始事件与服务日志。

## 过滤范围

仅过滤以下两类精确匹配的标准错误行：

- `codex_core_skills::loader` 忽略 `interface.icon_small` 或 `interface.icon_large`，原因是包含 `..` 的图标路径没有落在插件资源目录内。
- `codex_otel::events::session_telemetry` 上报 `codex.skill.injected` 指标失败，非法标签值为 `superpowers:using-superpowers`。

匹配以完整日志语义为准，允许时间戳和空白差异。相似但不完全符合上述来源、字段和原因的警告继续展示，避免误隐藏真实问题。

## 数据流

Codex runner 继续收集完整 `stderr`，飞书消息追踪器继续保存原始进度事件。Web Server 在 `/api/status`、`/api/channels` 和 `/api/overview` 返回频道状态前复制并清理其中的 `stderr` 展示事件：

- 单个事件只包含无害告警时，从 Web 响应中删除该事件。
- 单个事件同时包含无害告警和其他内容时，只删除匹配行，保留其余内容。
- 非 `stderr` 事件和其他标准错误输出保持不变。

`/api/logs` 与 `/api/logs/download` 不经过该过滤器，因此服务日志保持原样。

## 文件职责

- `src/web/stderr-display.ts`：识别无害告警行，并递归生成只供 Web 展示的频道状态副本。
- `src/web-server.ts`：在三个频道状态接口调用展示过滤器。
- `tests/web-stderr-display.test.ts`：覆盖精确过滤、混合文本保留和原始对象不变。
- `tests/web-server.test.ts`：覆盖 Web 频道接口过滤与日志接口不受影响。

## 验证

按测试先行完成定向测试，再运行完整测试、类型检查、构建和差异检查。最后重启后台服务并确认 Web API、服务状态和飞书频道连接正常。

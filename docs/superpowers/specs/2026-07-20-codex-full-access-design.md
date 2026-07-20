# Codex 完全权限模式设计

## 背景

飞书 headless 任务无法通过脚本访问网络。根因是网关示例和当前项目配置显式使用 `workspace-write`，并关闭实时搜索。`claudish` 的飞书 headless runner 固定启用自动批准，且不主动施加工作区沙箱，因此当前 Codex 行为与参考实现不一致。

## 目标

- Codex headless 默认不等待权限确认，也不受文件系统或网络沙箱限制。
- 实时 Web Search 同时作用于新会话和恢复会话。
- 显式关闭完全权限的旧配置仍然可以被解析，保持配置格式兼容。
- 当前项目配置立即切换到完全权限模式，服务重启后已有会话也使用新权限。

## 设计

默认 Codex 配置调整为：

```yaml
codex:
  sandbox: danger-full-access
  search: true
  dangerouslyBypassApprovalsAndSandbox: true
```

当 `dangerouslyBypassApprovalsAndSandbox` 为 `true` 时，runner 不再附加多余的 `--sandbox` 参数，而是对新会话和恢复会话统一传入：

```text
--dangerously-bypass-approvals-and-sandbox
```

当 `search` 为 `true` 时，runner 对两种会话统一传入：

```text
-c web_search="live"
```

使用配置覆盖而不是只传 `--search`，是因为 `codex exec resume` 不提供 `--search` 参数，但支持 `-c`。

## 验证

- 配置测试覆盖完全权限默认值和显式关闭值。
- runner 测试覆盖新会话和恢复会话的 bypass 与实时搜索参数。
- README 测试确保示例不再启用 `workspace-write`。
- 全量测试、类型检查和构建通过。
- 重启后台后，使用同等 Codex 参数执行一次真实网络访问验证。

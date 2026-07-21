# Verbosity 默认值展示设计

## 目标

Web UI 保留“使用 Codex CLI 默认值”的配置语义，同时明确展示该默认当前对应的实际值，避免用户只看到含义不清的“Codex CLI 默认”。

## 数据来源

Codex 模型目录进程完成 app-server 初始化后，除 `model/list` 外同时调用 `config/read`，读取当前工作目录下生效的 `model_verbosity`。

- `config/read` 返回 `low`、`medium` 或 `high` 时，使用该值。
- 返回空值、旧版 CLI 不支持该方法或字段无效时，使用 Codex Responses API 默认值 `medium`。
- 读取结果和模型目录共用同一份短时缓存，避免为一个页面重复启动 Codex 子进程。

## 展示规则

- 全局未配置：`Codex CLI 默认（当前：medium）`。
- 账号未配置且全局未配置：`继承全局（当前：medium）`。
- 账号未配置且全局配置为 `high`：`继承全局（当前：high）`。
- 全局或账号显式配置时：继续直接显示配置值。

编辑态下拉选项与只读状态使用同一套文字。选择默认或继承仍删除对应 YAML 字段，不把解析出的当前值写入项目配置。

## 错误处理

默认值读取失败不能影响模型列表和自由输入。模型目录仍正常返回，并将 Verbosity 默认回退为 `medium`。

## 验证

测试覆盖 app-server `config/read`、空值回退、API 返回、全局与账号展示文字。最终运行完整测试、类型检查、构建和桌面/移动端浏览器验收。

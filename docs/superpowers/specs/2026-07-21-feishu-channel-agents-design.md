# 飞书频道 AGENTS.md 设计

## 目标

为每个飞书账户提供独立的 Markdown 指令文件，并通过 Codex CLI 的 `developer_instructions` 配置注入会话。账户创建或服务启动时必须存在该文件，默认内容为空；空文件不产生额外指令。

## 文件位置

每个账户使用固定路径：

```text
~/.codex-gateway/channels/feishu/<accountId>/AGENTS.md
```

路径由 Gateway 根据账户 ID 推导，不作为 `config.yaml` 的可编辑字段。Web UI 只展示实际路径，不允许修改路径。

## 指令层级

Codex 自身仍按原生规则加载 `~/.codex/AGENTS.md` 和工作目录内的项目级 `AGENTS.md`。Gateway 不读取、不复制这些文件。

飞书账户文件非空时，Gateway 将以下内容作为 `developer_instructions` 传给每次 Codex CLI 调用：

```text
以下是当前飞书频道的专属指令；如与通用指令冲突，以本频道指令为准。

<账户 AGENTS.md 内容>
```

因此最终行为层级为：Codex 内部系统指令、Codex 原生开发者指令与 AGENTS.md、Gateway 注入的飞书账户开发者指令、飞书用户消息。账户文件不会拼入用户消息，也不会伪装成真正的系统提示词。

## 生命周期

- Channel 启动时先创建账户目录和空 `AGENTS.md`，即使账户被禁用也执行。
- 文件创建使用仅当前用户可读写的权限，已存在文件绝不覆盖。
- Session Router 在每次执行前重新读取文件，因此 Web UI 保存后从下一条消息开始生效。
- 空白内容等同于未配置，不向 Codex CLI 添加 `developer_instructions`。
- 文件大小限制为 32 KiB，与 Codex 默认项目文档限制保持一致。

## Web UI

飞书账户卡片提供“指令”入口，打开独立编辑对话框：

- 展示固定且只读的文件路径；
- 编辑 Markdown 原文；
- 显示空文件或字节数状态；
- 支持重新载入、清空编辑区、取消和保存；
- 清空后仍保留磁盘上的空 `AGENTS.md` 文件。

对应接口为：

```text
GET /api/channels/:id/instructions
PUT /api/channels/:id/instructions
```

PUT 请求体为 `{ "content": "..." }`。

## 错误处理

- 非字符串内容返回 400。
- 不存在的频道返回 404。
- 超过 32 KiB 返回清晰错误，不覆盖原文件。
- 读取或保存失败保留原文件，并在 Web UI 显示错误。


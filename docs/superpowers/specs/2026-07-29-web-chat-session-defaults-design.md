# Web Chat 新会话默认参数设计

## 背景

Web Chat 新建会话时，页面只提交标题，不主动提交模型。HTTP 层仍会构造
`model: undefined`，而 `WebChatManager.createSession` 在合并账户默认值后再次展开输入对象，
导致已经解析出的默认模型被 `undefined` 覆盖。最终 Session 保存为空，页面显示“模型”，
实际执行则交给 Codex CLI 自行选择默认模型。

这会造成三个问题：

- 用户误以为每次新会话都必须重新选择模型。
- 页面展示的参数与实际执行参数不一致。
- 项目全局 `codex` 默认配置没有成为 Web Chat 的最终回退值。

## 目标

- 新会话自动继承模型、Effort、Fast 和 Verbosity。
- 新会话页面直接显示实际继承值，不要求用户重复选择。
- 旧的空参数 Session 仍能在运行时获得正确默认值。
- 不修改已经保存的历史 Session 文件，不影响已有原生 Codex 会话。

## 默认值优先级

每项运行参数独立按以下顺序解析：

1. 新建会话请求显式指定的值。
2. 当前 Web Chat 账户配置的默认值。
3. 项目全局 `codex` 配置的默认值。
4. 如果前三层均为空，则不传该参数，由 Codex CLI 使用自身默认值。

`false` 是 Fast 的有效显式值，不能被后续默认值覆盖。

## 实现设计

### 新建会话

`WebChatManager.createSession` 先展开普通输入字段，再在最后写入解析后的运行参数，避免
输入对象中值为 `undefined` 的属性覆盖默认值。解析后的值保存到 Session 记录，因此前端
继续读取 `session.model` 等字段即可显示真实值，不增加前端推断逻辑。

### 旧会话运行时回退

`WebChatManager.routerFor` 创建 Codex Router 时，对旧 Session 中缺失的运行参数使用同一条
回退链：Session 值、账户值、全局 `codex` 值、Codex CLI 默认值。这里只改变送入 Runner
的有效参数，不回写旧 Session 文件，避免悄悄改变历史会话配置。

### 前端

前端无需增加默认模型判断。新会话 API 返回已解析的 Session，现有
`renderCurrentSession` 会把模型和其他参数显示到工具栏。

## 测试

- Manager 测试覆盖显式值、账户默认值、全局默认值的优先级。
- HTTP 测试复现空请求体仍携带 `model: undefined` 的真实入口，确认返回 Session 包含默认值。
- Runner 测试覆盖旧的空参数 Session 在执行时继承账户或全局配置。
- 运行 Web Chat 相关测试、完整测试、类型检查与构建。

## 非目标

- 不迁移或批量重写已有 Session 文件。
- 不改变 Codex CLI 自身默认模型的读取方式。
- 不新增 Web Chat 用户设置页面。

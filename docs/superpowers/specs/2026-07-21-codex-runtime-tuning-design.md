# Codex 运行参数配置设计

## 目标

在 Web UI 的全局 Codex 配置和飞书账号配置中增加 Effort、Fast、Verbosity，并保持现有模型选择、继承、热更新和会话一致性。

## 配置结构

项目根目录 `config.yaml` 使用结构化字段：

```yaml
codex:
  model: gpt-5.6-sol
  reasoningEffort: low
  fast: true
  verbosity: medium

channels:
  feishu:
    accounts:
      - id: wudonghao
        model: gpt-5.6-sol
        reasoningEffort: high
        fast: false
        verbosity: low
```

全局字段缺失时沿用 Codex CLI 自身配置。账号字段缺失时继承 Gateway 全局字段；账号 `fast: false` 是明确关闭，不能与缺失字段混淆。

## 模型能力

扩展 `model/list` 解析结果，保留每个模型的：

- `supportedReasoningEfforts` 和 `defaultReasoningEffort`
- `additionalSpeedTiers` 和 `serviceTiers`

已知模型只显示其支持的 Effort。Fast 仅在模型目录声明 `fast` 或 Fast service tier 时允许开启。自定义模型无法判断能力时仍允许保存 Effort 和 Fast，但页面显示兼容性未知，避免阻断自定义模型。

## CLI 映射

- Effort：`-c model_reasoning_effort="<value>"`
- Verbosity：`-c model_verbosity="<value>"`
- Fast 开启：`--enable fast_mode -c service_tier="fast"`
- Fast 关闭：`--disable fast_mode`
- 未配置：不追加参数，沿用 Codex CLI 配置

Gateway 自己生成的参数放在用户 `extraArgs` 之前，让 `extraArgs` 保持最终覆盖能力。

## 会话语义

模型、Effort、Fast、Verbosity 在创建 Gateway session 时一起写入 session 元数据。配置热更新不会重连飞书，也不会改变已有 session；`/new`、fork 和新会话使用更新后的有效配置。恢复历史 session 时继续使用历史快照。

AI 摘要继续允许单独覆盖摘要模型，其 Effort、Fast、Verbosity跟随当前账号有效配置。

## Web UI

全局 Codex 卡片在同一个编辑操作中保存四项设置。账号卡片增加：

- Effort 下拉：继承、模型支持的级别
- Fast 三态选择：继承、开启、关闭
- Verbosity 下拉：继承、low、medium、high

只读状态显示最终有效值，并标注继承。切换模型时 Effort 与 Fast 控件立即根据模型能力更新；已有但不兼容的值保留并显示警告，不静默删除。

## 错误处理与测试

服务端校验 Effort 和 Verbosity 枚举，Fast 只接受布尔值或缺失。配置写入继续使用 YAML Document API 和原子替换。测试覆盖模型能力解析、配置继承、CLI 参数、会话快照、热更新、API 保存及页面交互；最后运行完整测试、类型检查、构建和 Playwright 桌面/移动验收。

## 非目标

- 不增加 Personality、Reasoning Summary 或更多高级参数。
- 不修改用户 `~/.codex/config.toml`。
- 不为自定义模型维护静态兼容性表。
- 本次不执行 git add、commit 或 push。

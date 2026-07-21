# Codex 标准错误日志分级实施方案

> **For agentic workers:** REQUIRED: 按测试先行方式在当前会话执行；当前项目不使用 sub-agent，未经用户要求不提交或推送。

**Goal:** 对 Web UI 中的 Codex 标准错误输出进行错误、警告和普通日志分级，并让网关使用与 Codex App 一致的 CLI。

**Architecture:** 保留现有 `stderr` 进度事件，在页面渲染层增加纯文本分级函数和对应样式。项目私有配置切换到 Codex App 内置命令，示例配置保持跨机器可用。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、Codex CLI

---

## Task 1: 页面日志分级

**Files:**
- Modify: `tests/web-server.test.ts`
- Modify: `src/web/page.ts`

- [x] 增加失败测试，要求页面包含三类日志标题、分级函数和严重级别样式。
- [x] 运行 `bun test tests/web-server.test.ts`，确认新断言失败。
- [x] 实现错误优先的 `stderr` 文本分级和对应标题。
- [x] 为错误、警告和普通日志增加现有主题变量驱动的样式。
- [x] 再次运行 Web 定向测试并确认通过。

## Task 2: Codex 版本对齐

**Files:**
- Modify: `config.yaml`

- [x] 将项目私有 `codex.command` 改为 Codex App 内置可执行文件。
- [x] 保持 `config-example.yaml` 不变。
- [x] 验证配置解析和命令版本。

## Task 3: 完整验收

- [x] 运行 `bun run typecheck`、`bun test`、`bun run build` 和 `git diff --check`。
- [x] 使用项目内 `config.yaml` 重启服务。
- [x] 验证服务命令、两路飞书连接和 Web UI 日志分级。
- [x] 保持改动未提交，等待用户明确要求后再提交或推送。

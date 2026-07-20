# Web UI Theme Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Codex Gateway Web UI 增加跟随系统、可持久化的太阳/月亮明暗主题切换。

**Architecture:** 主题初始化和界面都继续由 `src/web-server.ts` 输出。首屏脚本在 CSS 前设置根节点主题，主脚本管理用户交互，CSS 变量统一承载明暗配色。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、Bun Test

---

### Task 1: 主题页面契约

**Files:**
- Modify: `tests/web-server.test.ts`

- [ ] 增加主题按钮、系统主题检测、`localStorage` 和暗色 CSS 变量断言。
- [ ] 将脚本语法检查扩展为验证页面中的全部内嵌脚本。
- [ ] 运行 `bun test tests/web-server.test.ts`，确认新断言先失败。

### Task 2: 主题实现

**Files:**
- Modify: `src/web-server.ts`

- [ ] 在 `<head>` 增加防闪主题初始化脚本。
- [ ] 增加完整暗色 CSS 变量并替换硬编码界面颜色。
- [ ] 在顶部工具栏增加固定尺寸太阳/月亮按钮。
- [ ] 增加主题切换、无障碍提示和 `localStorage` 持久化逻辑。
- [ ] 运行聚焦测试，确认通过。

### Task 3: 验证与运行

**Files:**
- Modify: `README.md`

- [ ] 简要记录 Web UI 明暗主题行为。
- [ ] 运行 `bun test && bun run typecheck && bun run build && git diff --check`。
- [ ] 重启 `codex-gateway`，请求运行中页面确认主题标记存在。

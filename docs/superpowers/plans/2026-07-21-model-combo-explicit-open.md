# Model Combo Explicit Open Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让模型下拉菜单只在用户显式操作时展开，同时保留进入编辑状态后的输入框自动焦点。

**Architecture:** 继续复用 `createModelCombo` 处理全局和账号模型选择，仅移除焦点事件与菜单展开之间的绑定。点击、输入、键盘和箭头按钮的既有展开路径保持不变。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、`bun:test`

---

### Task 1: 锁定交互契约

**Files:**
- Modify: `tests/web-server.test.ts`

- [x] 断言编辑模式仍自动聚焦模型输入框。
- [x] 断言模型输入框点击时仍可展开菜单。
- [x] 断言模型输入框不再通过 `focus` 事件展开菜单。
- [x] 运行 `bun test tests/web-server.test.ts` 并确认新增断言先失败。

### Task 2: 实现显式展开

**Files:**
- Modify: `src/web/page.ts`

- [x] 删除模型输入框的 `focus` 展开监听。
- [x] 运行 `bun test tests/web-server.test.ts` 并确认测试通过。

### Task 3: 完整验证

- [x] 运行 `bun test`。
- [x] 运行 `bun run typecheck`。
- [x] 运行 `bun run build`。
- [x] 运行 `git diff --check`。
- [x] 重启服务并确认新页面不包含聚焦展开监听。

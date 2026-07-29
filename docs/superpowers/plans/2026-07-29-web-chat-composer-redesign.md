# Web Chat Composer Redesign Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web Chat 输入框改成上下分层、接近 Codex App 的双层创作区，同时保持现有交互行为。

**Architecture:** 仅调整服务端渲染的 Chat 页面结构和 CSS。页面结构将文本区与底部操作栏分离，脚本继续通过原有元素 ID 操作，因此不改变事件和数据流。

**Tech Stack:** TypeScript、服务端 HTML 模板、原生 CSS、Bun Test

---

## Chunk 1: 输入框结构与视觉

### Task 1: 用页面测试定义双层创作区

**Files:**
- Modify: `tests/web-chat-page.test.ts`
- Test: `tests/web-chat-page.test.ts`

- [x] **Step 1: 写失败测试**

新增断言，要求页面包含 `composer-editor` 和 `composer-toolbar`，并要求样式包含双层布局、统一聚焦态与圆形提交按钮。

- [x] **Step 2: 运行测试确认失败**

Run: `bun test tests/web-chat-page.test.ts`

Expected: FAIL，缺少新结构类名或新样式。

### Task 2: 实现双层输入框

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Test: `tests/web-chat-page.test.ts`

- [x] **Step 1: 调整 HTML 层级**

将文本区放入 `composer-editor`，将附件入口、模型摘要和提交按钮放入 `composer-toolbar`，保留全部现有元素 ID 和无障碍属性。

- [x] **Step 2: 实现桌面样式**

将 `.composer` 改为纵向布局，设置舒展的最小高度、统一聚焦态和底部操作栏；将发送与停止按钮改为固定尺寸圆形按钮。

- [x] **Step 3: 实现移动端样式**

缩小输入区最小高度和内边距，限制模型摘要宽度，保证工具栏和提交按钮不换行或错位。

- [x] **Step 4: 运行页面测试确认通过**

Run: `bun test tests/web-chat-page.test.ts`

Expected: PASS。

### Task 3: 完整验证

**Files:**
- Verify: `src/web/chat/page.ts`
- Verify: `src/web/chat/styles.ts`
- Verify: `tests/web-chat-page.test.ts`

- [x] **Step 1: 运行全量测试**

Run: `bun test`

Expected: PASS。

- [x] **Step 2: 运行类型检查和构建**

Run: `bun run typecheck`

Expected: PASS。

Run: `bun run build`

Expected: PASS。

- [x] **Step 3: 检查格式与视觉**

Run: `git diff --check`

Expected: PASS。启动或重启服务后，在桌面和移动视口检查输入区的高度、对齐、聚焦态、模型菜单和发送或停止状态。

- [x] **Step 4: 核对范围**

确认没有修改消息提交逻辑、后端接口或会话数据。除非用户明确要求，否则不执行 git add、commit 或 push。

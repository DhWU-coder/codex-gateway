# Web Chat Drag And Paste Files Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Web Chat 增加文件拖拽、剪贴板粘贴和纯附件消息支持，并复用现有待发送附件队列。

**Architecture:** 前端以 `addPendingFiles` 统一三个文件入口，并在会话主区域管理拖拽遮罩。HTTP 与 Manager 放宽为空文本的条件，但只有附件经过所有权校验后才允许纯附件消息；用户历史保存原始空文本，Codex Runner 使用内部附件提示。

**Tech Stack:** TypeScript、浏览器原生 Drag and Drop/Clipboard API、Bun、`bun:test`

---

## Chunk 1: 纯附件消息

### Task 1: 用测试定义 Manager 行为

**Files:**
- Modify: `tests/web-chat-manager.test.ts`

- [x] **Step 1: 添加纯附件消息测试**

上传一个文本文件并调用：

```ts
await manager.sendMessage(user.id, session.id, {
  text: "",
  fileIds: [upload.id],
});
```

断言 Runner Prompt 包含内部附件提示和工作区文件路径，Session 标题为附件文件名，用户历史
消息文本为空且包含附件元数据。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test tests/web-chat-manager.test.ts`

Expected: FAIL，错误为“消息内容不能为空”。

### Task 2: 实现 Manager 纯附件支持

**Files:**
- Modify: `src/web-chat/manager.ts`
- Test: `tests/web-chat-manager.test.ts`

- [x] **Step 1: 先解析附件再校验空消息**

只有 `text` 为空且没有合法附件时抛出“消息内容不能为空”。纯附件时将
`请查看并处理用户提供的附件。` 作为 Runner Prompt，并用附件名生成标题和 Tracker 预览。

- [x] **Step 2: 运行 Manager 测试**

Run: `bun test tests/web-chat-manager.test.ts`

Expected: PASS。

### Task 3: 用测试定义 HTTP 行为并实现

**Files:**
- Modify: `tests/web-chat-http.test.ts`
- Modify: `src/web-chat/http.ts`

- [x] **Step 1: 添加 HTTP 纯附件和完全空消息测试**

先上传文件，再以空文本和有效 `fileIds` 提交消息，断言返回 202；另以空文本和空附件提交，
断言返回 400。

- [x] **Step 2: 运行测试并确认纯附件请求失败**

Run: `bun test tests/web-chat-http.test.ts`

Expected: 纯附件请求返回 400。

- [x] **Step 3: 调整 HTTP 空消息校验顺序**

先规范化 `fileIds`，仅在文本和 `fileIds` 均为空时返回 400。

- [x] **Step 4: 运行 HTTP 测试**

Run: `bun test tests/web-chat-http.test.ts`

Expected: PASS。

## Chunk 2: 拖拽与粘贴

### Task 4: 用页面测试定义前端行为

**Files:**
- Modify: `tests/web-chat-page.test.ts`

- [x] **Step 1: 添加附件交互标记测试**

断言页面包含拖拽遮罩、`addPendingFiles`、`dragenter`、`dragleave`、`drop` 和 `paste`
监听器，以及“文本或附件至少存在一个”的发送条件。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test tests/web-chat-page.test.ts`

Expected: FAIL，缺少拖拽遮罩或统一入队函数。

### Task 5: 实现统一附件队列和拖拽遮罩

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/script.ts`
- Modify: `src/web/chat/styles.ts`
- Test: `tests/web-chat-page.test.ts`

- [x] **Step 1: 在页面增加拖拽遮罩**

遮罩放在 Chat 主区域内，默认隐藏，并提供可访问的状态文案。

- [x] **Step 2: 实现 `addPendingFiles`**

统一校验空文件、30MB、重复文件并渲染附件队列；隐藏文件输入框继续调用该函数。

- [x] **Step 3: 实现拖放事件**

仅处理包含文件的 DragEvent，使用进入计数器控制遮罩，Drop 后入队并重置状态。

- [x] **Step 4: 实现粘贴事件**

从剪贴板项目提取文件，不阻止文字默认粘贴。

- [x] **Step 5: 支持纯附件发送**

文本和附件均为空时返回；否则上传并提交。成功后清空队列，失败时保留。

- [x] **Step 6: 运行页面测试**

Run: `bun test tests/web-chat-page.test.ts`

Expected: PASS，内联脚本语法有效。

## Chunk 3: 完整验证

### Task 6: 自动化验证

**Files:**
- Verify: `src/web-chat/manager.ts`
- Verify: `src/web-chat/http.ts`
- Verify: `src/web/chat/page.ts`
- Verify: `src/web/chat/script.ts`
- Verify: `src/web/chat/styles.ts`

- [x] **Step 1: 运行 Web Chat 测试**

Run: `bun test tests/web-chat-*.test.ts`

Expected: 全部通过。

- [x] **Step 2: 运行完整测试**

Run: `bun test`

Expected: 全部通过。

- [x] **Step 3: 运行类型检查和构建**

Run: `bun run typecheck`

Expected: 退出码为 0。

Run: `bun run build`

Expected: 退出码为 0。

### Task 7: 服务与视觉验证

**Files:**
- Verify: `config.yaml`

- [x] **Step 1: 重启 Gateway**

Run: `codex-gateway restart`

Expected: 后台服务启动成功并输出 Chat 地址。

- [x] **Step 2: 验证真实纯附件请求**

创建临时 Web Chat 用户和 Session，上传临时文件，以空文本提交并等待历史中出现纯附件用户
消息；验证后删除临时 Session 和用户。

- [x] **Step 3: 验证桌面与移动端布局**

使用 Playwright 检查桌面和 390px 移动端，确认拖拽遮罩、附件标签和 Composer 不重叠。

- [x] **Step 4: 检查工作区差异**

确认只包含本功能的设计、计划、测试和实现变化；不暂存、提交或推送。

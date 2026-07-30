# Web Chat Trace Assistant Binding Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web Chat 中间过程放入对应的 Codex 回复区域，并在任务结束时可靠地自动折叠。

**Architecture:** 复用 Trace 已持久化的 `messageId` 与 `assistantMessageId`，在浏览器端把用户消息、Codex 消息和 Trace 编排成同一回合。折叠状态同时通过终态转换清理和节点创建态隔离，避免程序触发的 `toggle` 被误判为用户操作。

**Tech Stack:** TypeScript、浏览器原生 JavaScript、HTML/CSS、Bun Test

---

## Chunk 1: 回归测试与实现

### Task 1: 固化回复归属和自动折叠行为

**Files:**
- Modify: `tests/web-chat-page.test.ts`

- [x] **Step 1: 编写失败的页面源码回归测试**

新增断言，要求页面脚本包含：

```ts
expect(page).toContain("traceByAssistantMessage");
expect(page).toContain("createTraceAssistantNode");
expect(page).toContain("var canRememberToggle = trace.status !== \"running\";");
expect(page).toContain("var wasRunning = trace && trace.status === \"running\";");
expect(page).toContain("state.expandedTraceIds.delete(trace.messageId);");
expect(page).toContain(".trace-card.inline");
```

- [x] **Step 2: 运行定向测试并确认失败**

Run: `bun test tests/web-chat-page.test.ts`

Expected: FAIL，缺少新的 Codex 回复绑定和折叠保护标记。

### Task 2: 将 Trace 绑定到 Codex 回复

**Files:**
- Modify: `src/web/chat/script.ts`
- Modify: `src/web/chat/styles.ts`
- Test: `tests/web-chat-page.test.ts`

- [x] **Step 1: 重写消息与 Trace 编排**

在 `renderMessages()` 中建立用户消息和 Codex 消息两套 Trace 索引。优先把 Trace 连同真实
Codex 消息放在对应用户消息后；运行中没有最终消息时创建临时 Codex 回复外壳。

- [x] **Step 2: 让 Codex 消息内部渲染 Trace**

扩展 `createMessageNode(message, trace)`，在 Codex 消息正文之前插入内嵌 Trace。新增
`createTraceAssistantNode(trace)` 负责运行态和孤立 Trace 的 Codex 外壳。

- [x] **Step 3: 修复完成态自动折叠竞态**

创建节点时捕获是否为终态，只允许终态节点的真实用户 `toggle` 更新展开集合。收到
`running` 到终态的 `message.trace` 更新时主动删除对应展开 ID。

- [x] **Step 4: 调整内嵌样式**

为 `.trace-card.inline` 清除独立 Trace 的左侧和底部布局偏移，使其在桌面和移动端都对齐
Codex 回复正文。

- [x] **Step 5: 运行定向测试**

Run: `bun test tests/web-chat-page.test.ts`

Expected: PASS。

## Chunk 2: 全量验证

### Task 3: 验证项目

**Files:**
- Verify: `src/web/chat/script.ts`
- Verify: `src/web/chat/styles.ts`
- Verify: `tests/web-chat-page.test.ts`

- [x] **Step 1: 运行完整测试**

Run: `bun test`

Expected: 全部测试通过。

- [x] **Step 2: 运行类型检查**

Run: `bun run typecheck`

Expected: 退出码 0。

- [x] **Step 3: 运行构建**

Run: `bun run build`

Expected: 退出码 0。

- [x] **Step 4: 检查变更范围**

Run: `git diff --check`

Expected: 退出码 0，且只包含本需求和此前用户未提交变更。未经用户明确要求，不执行暂存、
提交或推送。

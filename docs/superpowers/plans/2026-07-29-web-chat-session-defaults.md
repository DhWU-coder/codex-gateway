# Web Chat Session Defaults Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web Chat 新会话自动保存并显示账户或全局默认运行参数，同时让旧的空参数会话在执行时正确回退。

**Architecture:** 默认值解析集中在 `WebChatManager`。新建 Session 时保存解析后的有效值；为旧 Session 创建 Router 时使用相同回退链，但不回写历史文件。前端继续只渲染服务端返回的 Session。

**Tech Stack:** TypeScript、Bun、`bun:test`

---

## Chunk 1: 默认参数继承

### Task 1: 用测试复现新会话默认值被覆盖

**Files:**
- Modify: `tests/web-chat-manager.test.ts`
- Modify: `tests/web-chat-http.test.ts`

- [x] **Step 1: 添加 Manager 默认值优先级测试**

分别创建以下 Session 并断言：

```ts
manager.createSession(user.id, { model: undefined });
// 继承账户 model，undefined 不能覆盖默认值。

manager.createSession(user.id, {
  model: "gpt-standard",
  reasoningEffort: "low",
  fast: false,
  verbosity: "low",
});
// 显式值完整保留，false 不能被全局 true 覆盖。
```

另创建没有运行参数的账户，断言新 Session 继承 `CodexConfig` 的
`model`、`reasoningEffort`、`fast` 和 `verbosity`。

- [x] **Step 2: 添加 HTTP 空请求体回归测试**

通过 `POST /api/chat/sessions` 发送空对象，断言响应中的模型等运行参数来自默认配置。

- [x] **Step 3: 运行测试并确认按预期失败**

Run: `bun test tests/web-chat-manager.test.ts tests/web-chat-http.test.ts`

Expected: 新增断言失败，显示 Session 的模型或运行参数为 `undefined`。

### Task 2: 修复新会话默认值解析

**Files:**
- Modify: `src/web-chat/manager.ts`
- Test: `tests/web-chat-manager.test.ts`
- Test: `tests/web-chat-http.test.ts`

- [x] **Step 1: 调整 `createSession` 合并顺序**

先保留标题、Fork 来源等输入字段，再在对象末尾按以下形式覆盖运行参数字段：

```ts
model: input.model ?? user.model ?? this.options.codex.model
```

Effort、Fast 和 Verbosity 使用同一优先级。

- [x] **Step 2: 运行定向测试**

Run: `bun test tests/web-chat-manager.test.ts tests/web-chat-http.test.ts`

Expected: 新会话默认值测试通过。

### Task 3: 为旧 Session 增加运行时回退

**Files:**
- Modify: `tests/web-chat-manager.test.ts`
- Modify: `src/web-chat/manager.ts`

- [x] **Step 1: 添加旧 Session 空参数的 Runner 测试**

通过 `manager.sessionStore.create(user.id, {})` 模拟旧版本保存的空参数 Session，
再发送消息并断言 Runner 收到账户模型以及全局 Effort、Fast、Verbosity。

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `bun test tests/web-chat-manager.test.ts`

Expected: Runner 收到的模型或其他运行参数为 `undefined`。

- [x] **Step 3: 在 `routerFor` 使用统一回退链**

创建 Router 时调用与新建 Session 相同的纯解析函数，按“Session > 账户 > 全局”
解析模型、Effort、Fast 和 Verbosity，不修改 Session 文件。

- [x] **Step 4: 运行定向测试**

Run: `bun test tests/web-chat-manager.test.ts`

Expected: 旧 Session 回退测试通过。

## Chunk 2: 完整验证

### Task 4: 自动化验证

**Files:**
- Verify: `src/web-chat/manager.ts`
- Verify: `tests/web-chat-manager.test.ts`
- Verify: `tests/web-chat-http.test.ts`

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

### Task 5: 服务验证

**Files:**
- Verify: `config.yaml`

- [x] **Step 1: 重启 Gateway**

Run: `codex-gateway restart`

Expected: 后台服务成功启动并输出 Chat 地址。

- [x] **Step 2: 通过真实 HTTP 接口创建临时新会话**

使用现有 Web Chat 账户登录并新建 Session，确认返回模型为账户默认模型
`gpt-5.6-sol`，然后删除临时 Session。

- [x] **Step 3: 检查工作区差异**

确认仅新增本功能的文档、测试和实现变化；不暂存、提交或推送。

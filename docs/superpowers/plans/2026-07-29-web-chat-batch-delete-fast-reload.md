# Web Chat 批量删除与 Fast 热更新 Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Web Chat 增加会话选择、全选和停止后批量删除，并让新会话与空白会话及时采用热更新后的 Codex 默认配置。

**Architecture:** `WebChatManager` 统一管理停止后删除和可热更新的 Codex 默认值，HTTP 暴露一次性批量删除接口，Chat 页面只管理选择状态和结果呈现。已有内容会话保持自己的运行配置，空白会话与未来会话使用最新默认值。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、Bun Test

---

## Chunk 1: 后端行为

### Task 1: Fast 默认配置热更新

**Files:**
- Modify: `src/web-chat/manager.ts`
- Modify: `src/channel-manager.ts`
- Test: `tests/web-chat-manager.test.ts`
- Test: `tests/channel-manager.test.ts`

- [ ] **Step 1: 编写失败测试**

在 Manager 测试中验证默认 Fast 从 `true` 更新为 `false` 后，新会话和空白会话变为 `false`，已有消息会话保持原值；在 ChannelManager 测试中验证 `reloadConfig()` 会把最新 Codex 配置传给 Web Chat Manager。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
bun test tests/web-chat-manager.test.ts tests/channel-manager.test.ts
```

Expected: FAIL，原因是 Web Chat Manager 没有默认配置更新方法，ChannelManager 也未传播 `config.codex`。

- [ ] **Step 3: 实现最小修复**

在 `WebChatManager` 中保存当前 Codex 默认配置并提供更新方法；使用消息、Thread、目标、计划、权限、运行状态和 Router 状态判断空白会话。`ChannelManager.reloadConfig()` 在处理频道前更新 Web Chat 默认配置。

- [ ] **Step 4: 运行目标测试**

Run:

```bash
bun test tests/web-chat-manager.test.ts tests/channel-manager.test.ts
```

Expected: PASS。

### Task 2: 停止后批量删除

**Files:**
- Modify: `src/web-chat/manager.ts`
- Modify: `src/web-chat/http.ts`
- Test: `tests/web-chat-manager.test.ts`
- Test: `tests/web-chat-http.test.ts`

- [ ] **Step 1: 编写失败测试**

覆盖运行会话先停止后删除、会话 ID 去重、跨用户失败项、部分成功、HTTP CSRF 校验和批量结果结构。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
bun test tests/web-chat-manager.test.ts tests/web-chat-http.test.ts
```

Expected: FAIL，原因是批量删除方法和 `DELETE /api/chat/sessions` 尚不存在。

- [ ] **Step 3: 实现最小后端能力**

增加批量删除结果类型和 Manager 方法；单会话删除复用停止后删除函数；HTTP 读取 `sessionIds` 并返回批量结果。

- [ ] **Step 4: 运行目标测试**

Run:

```bash
bun test tests/web-chat-manager.test.ts tests/web-chat-http.test.ts
```

Expected: PASS。

## Chunk 2: Chat 选择交互

### Task 3: 左侧会话选择、全选和批量删除

**Files:**
- Modify: `src/web/chat/icons.ts`
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Modify: `src/web/chat/script.ts`
- Test: `tests/web-chat-page.test.ts`

- [ ] **Step 1: 编写失败测试**

验证页面包含选择入口、全选复选框、已选计数、删除与取消按钮；脚本包含选择状态、全选不确定状态、运行数量确认文案、一次批量请求和失败项保留逻辑。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
bun test tests/web-chat-page.test.ts
```

Expected: FAIL，原因是选择模式控件和逻辑尚不存在。

- [ ] **Step 3: 实现选择模式**

增加页面控件和图标；在状态中维护选择模式、选中 ID 和提交状态；选择模式下会话行切换勾选，正常模式保持现有打开和菜单行为。

- [ ] **Step 4: 实现批量删除请求与结果同步**

一次确认后调用 `DELETE /api/chat/sessions`。成功后刷新会话并选择合理的当前会话；部分失败时保留失败项；请求期间禁用操作。

- [ ] **Step 5: 完成响应式样式**

保证桌面和移动端的选择工具栏、复选框、计数与按钮不重叠，使用稳定尺寸和已有色彩变量。

- [ ] **Step 6: 运行页面测试**

Run:

```bash
bun test tests/web-chat-page.test.ts
```

Expected: PASS。

## Chunk 3: 验证与运行

### Task 4: 完整验证

**Files:**
- Verify: `src/web-chat/manager.ts`
- Verify: `src/web-chat/http.ts`
- Verify: `src/channel-manager.ts`
- Verify: `src/web/chat/page.ts`
- Verify: `src/web/chat/styles.ts`
- Verify: `src/web/chat/script.ts`

- [ ] **Step 1: 运行完整测试和类型检查**

Run:

```bash
bun test
bun run typecheck
```

Expected: 全部 PASS。

- [ ] **Step 2: 检查格式并构建**

Run:

```bash
git diff --check
bun run build
```

Expected: 无空白错误，构建成功。

- [ ] **Step 3: 重启服务**

Run:

```bash
codex-gateway restart
codex-gateway status
```

Expected: 服务运行，Chat 地址可访问。

- [ ] **Step 4: 真实页面检查**

检查桌面和移动端的选择模式、全选、批量确认、删除结果、Fast 摘要和按钮布局。不得删除用户现有会话；使用临时测试账户或新建的测试会话完成验证。

- [ ] **Step 5: 核对变更范围**

确认未修改或回滚用户已有无关变更，不执行 `git add`、`git commit` 或 `git push`。

## Plan Review — Chunk 1

**Status:** Approved

**Issues:**
- 无。

**Recommendations:**
- 无。

## Plan Review — Chunk 2

**Status:** Approved

**Issues:**
- 无。

**Recommendations:**
- 无。

## Plan Review — Chunk 3

**Status:** Approved

**Issues:**
- 无。

**Recommendations:**
- 无。

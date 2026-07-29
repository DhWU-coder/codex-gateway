# Web Chat Atomic Refresh Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已登录 Web Chat 在服务端准备完整首屏数据后一次性刷新，避免登录页、加载页和空会话外壳闪烁。

**Architecture:** 新增独立 Bootstrap 聚合模块，由 `/chat` 路由在返回 HTML 前调用。页面以安全 JSON Script 内嵌结果，前端在首次绘制前同步恢复状态；原有异步接口作为登录后流程和降级路径保留。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、bun:test

---

## Chunk 1: Bootstrap 数据

### Task 1: 定义并聚合服务端首屏数据

**Files:**
- Create: `src/web-chat/bootstrap.ts`
- Test: `tests/web-chat-bootstrap.test.ts`

- [x] **Step 1: 编写失败测试**

测试模型、会话、当前消息、Trace、能力和命令被聚合；没有会话时只创建一个默认会话。

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `bun test tests/web-chat-bootstrap.test.ts`

- [x] **Step 3: 实现最小聚合逻辑**

只调用现有 `WebChatManager` 公共方法，不复制 Session 或能力读取逻辑。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test tests/web-chat-bootstrap.test.ts`

## Chunk 2: 原子页面恢复

### Task 2: 安全内嵌 Bootstrap 并同步恢复

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Modify: `src/web/chat/script.ts`
- Modify: `src/web-chat/http.ts`
- Test: `tests/web-chat-page.test.ts`
- Test: `tests/web-chat-http.test.ts`

- [x] **Step 1: 编写失败测试**

测试认证页面包含安全 JSON、待恢复标记和同步恢复入口；HTTP 首屏包含完整 Bootstrap。

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `bun test tests/web-chat-page.test.ts tests/web-chat-http.test.ts`

- [x] **Step 3: 实现安全序列化和同步状态恢复**

服务端等待聚合完成；前端读取 Bootstrap、渲染完整会话并移除待恢复标记。

- [x] **Step 4: 保留异步降级路径**

匿名页面、登录、注册和缺少 Bootstrap 的页面继续使用现有 API。

- [x] **Step 5: 运行相关测试并确认通过**

Run: `bun test tests/web-chat-bootstrap.test.ts tests/web-chat-page.test.ts tests/web-chat-http.test.ts`

## Chunk 3: 完整验证

### Task 3: 构建与真实刷新验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-web-chat-atomic-refresh.md`

- [x] **Step 1: 运行完整测试**

Run: `bun test`

- [x] **Step 2: 运行类型检查、构建和差异检查**

Run: `bun run typecheck`

Run: `bun run build`

Run: `git diff --check`

- [x] **Step 3: 重启服务并验证真实浏览器**

使用已登录账户连续刷新，确认首屏直接出现完整会话且不再发起旧首屏请求。

- [x] **Step 4: 更新计划状态**

仅更新复选框，不执行 `git add`、提交或推送。

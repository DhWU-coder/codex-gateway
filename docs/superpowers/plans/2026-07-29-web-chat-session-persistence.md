# Web Chat Session Persistence Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web Chat 登录 Session 在 Gateway 重启后继续有效，并让失效页面在收到 `401` 时立即返回登录界面。

**Architecture:** 新增独立的认证 Session 文件仓库，使用 SHA-256 Token 哈希、版本化 JSON 和原子写入；`WebChatAuthService` 继续负责生命周期并在每次变更后持久化。前端通用 API 层集中处理未认证响应。

**Tech Stack:** Bun、TypeScript、Node.js crypto/fs、原生 HTML/CSS/JavaScript、Bun Test。

---

## Chunk 1: 服务端持久化

### Task 1: Session 路径与文件仓库

**Files:**
- Modify: `src/paths.ts`
- Create: `src/web-chat/auth-session-store.ts`
- Modify: `tests/paths.test.ts`
- Create: `tests/web-chat-auth-session-store.test.ts`

- [ ] **Step 1: 写入路径和仓库失败测试**

覆盖固定路径、文件缺失、原子写入、`0600` 权限、损坏文件安全返回空集合，以及文件不包含原始 Token。

- [ ] **Step 2: 运行测试并确认失败**

Run: `bun test tests/paths.test.ts tests/web-chat-auth-session-store.test.ts`

Expected: FAIL，路径函数和仓库尚不存在。

- [ ] **Step 3: 实现最小仓库**

仓库只读写 `tokenHash`、`csrfToken`、`userId` 和 `expiresAt`，使用版本 `1` 的 JSON 文件。

- [ ] **Step 4: 运行定向测试**

Run: `bun test tests/paths.test.ts tests/web-chat-auth-session-store.test.ts`

Expected: PASS。

### Task 2: 认证生命周期接入

**Files:**
- Modify: `src/web-chat/auth.ts`
- Modify: `tests/web-chat-auth.test.ts`

- [ ] **Step 1: 把“服务重建后无效”改为“服务重建后有效”并增加安全断言**

覆盖同一用户多 Session、重建恢复、退出持久化撤销、用户级撤销、过期清理和原始 Token 不落盘。

- [ ] **Step 2: 运行认证测试并确认失败**

Run: `bun test tests/web-chat-auth.test.ts`

Expected: FAIL，重建实例无法恢复 Cookie。

- [ ] **Step 3: 接入 Session 仓库**

使用 Cookie Token 的 SHA-256 哈希作为内存和磁盘键；所有新增、删除和批量撤销后同步写回。

- [ ] **Step 4: 运行认证回归**

Run: `bun test tests/web-chat-auth.test.ts tests/web-chat-http.test.ts`

Expected: PASS。

## Chunk 2: 前端恢复与交付

### Task 3: 全局 `401` 恢复登录页

**Files:**
- Modify: `src/web/chat/script.ts`
- Modify: `tests/web-chat-page.test.ts`

- [ ] **Step 1: 写入失败测试**

断言通用 API 对 `401` 调用统一认证状态清理，并清空 EventSource、用户、CSRF、Session、消息和流式文本。

- [ ] **Step 2: 运行页面测试并确认失败**

Run: `bun test tests/web-chat-page.test.ts`

Expected: FAIL，脚本没有统一 `401` 处理。

- [ ] **Step 3: 实现认证状态清理**

抽取可复用的重置函数，供通用 API、退出和启动失败路径使用。

- [ ] **Step 4: 运行页面回归**

Run: `bun test tests/web-chat-page.test.ts tests/web-chat-http.test.ts`

Expected: PASS。

### Task 4: 文档和最终验证

**Files:**
- Modify: `README.md`
- Modify: `tests/readme.test.ts`

- [ ] **Step 1: 更新文档**

说明 Session 在磁盘中以 Token 哈希持久化、服务重启后保持登录，以及升级后的首次重启需要重新登录一次。

- [ ] **Step 2: 执行完整自动化验证**

Run: `bun test && bun run typecheck && bun run build`

Expected: 全部通过。

- [ ] **Step 3: 执行真实后台重启流程**

登录两个临时客户端，记录 Cookie，重启 Gateway，确认两个 Cookie 仍能读取 `/api/chat/me`，随后彻底删除临时用户并确认 Session 失效。

- [ ] **Step 4: 最终状态检查**

确认无临时用户、无测试产物、服务运行正常，且不执行 `git add`、提交或 push。

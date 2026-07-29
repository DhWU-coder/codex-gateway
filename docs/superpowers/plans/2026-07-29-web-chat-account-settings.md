# Web Chat Account Settings Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将左下角账户入口改为设置，并允许登录用户修改密码以及自己的默认模型、Effort 和速度。

**Architecture:** 在 `WebChatManager` 中增加经过模型目录校验的账户运行参数读写边界，并复用空白会话同步逻辑。HTTP 层提供当前用户专用的读写接口，前端设置 Dialog 使用两个独立标签页和表单。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、Bun Test

---

## Chunk 1: 服务端账户默认值

### Task 1: Manager 账户配置读写

**Files:**
- Modify: `src/web-chat/manager.ts`
- Test: `tests/web-chat-manager.test.ts`

- [ ] **Step 1: 编写失败测试**

覆盖读取显式值与实际值、合法保存、非法模型/Effort/Fast 拒绝，以及仅同步空白 Session。

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/web-chat-manager.test.ts`

Expected: FAIL，提示账户配置方法不存在。

- [ ] **Step 3: 实现最小 Manager API**

增加账户配置返回类型、实际值解析、原子校验和保存，并让 `syncBlankSessionRuntime` 支持只同步指定用户。

- [ ] **Step 4: 运行 Manager 测试**

Run: `bun test tests/web-chat-manager.test.ts`

Expected: PASS。

### Task 2: 当前用户 HTTP API

**Files:**
- Modify: `src/web-chat/http.ts`
- Test: `tests/web-chat-http.test.ts`

- [ ] **Step 1: 编写失败测试**

覆盖 GET、PUT、CSRF、非法参数和当前用户隔离。

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/web-chat-http.test.ts`

Expected: FAIL，接口返回 404。

- [ ] **Step 3: 实现 HTTP 路由**

新增 `/api/chat/account-settings` 的 GET 和 PUT，严格读取三个白名单字段并调用 Manager。

- [ ] **Step 4: 运行 HTTP 测试**

Run: `bun test tests/web-chat-http.test.ts`

Expected: PASS。

## Chunk 2: 设置弹窗

### Task 3: 设置界面与交互

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Modify: `src/web/chat/script.ts`
- Test: `tests/web-chat-page.test.ts`

- [ ] **Step 1: 编写失败页面测试**

验证“设置”入口、标签页、模型输入与 datalist、Effort、速度、继承实际值、独立表单及保存逻辑。

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/web-chat-page.test.ts`

Expected: FAIL，缺少设置控件和脚本标记。

- [ ] **Step 3: 实现页面结构和样式**

将账户 Dialog 改为设置 Dialog，加入模型配置和修改密码标签页，保持桌面与移动端尺寸稳定。

- [ ] **Step 4: 实现前端数据流**

打开弹窗时读取账户设置；根据模型目录更新 Effort 和 Fast 可用性；保存后刷新账户、Session 和当前空白会话；密码表单沿用原接口。

- [ ] **Step 5: 运行页面测试**

Run: `bun test tests/web-chat-page.test.ts`

Expected: PASS，内联脚本语法检查通过。

## Chunk 3: 集成验证

### Task 4: 全量验证与服务验收

**Files:**
- Verify: `src/web-chat/manager.ts`
- Verify: `src/web-chat/http.ts`
- Verify: `src/web/chat/page.ts`
- Verify: `src/web/chat/styles.ts`
- Verify: `src/web/chat/script.ts`

- [ ] **Step 1: 运行定向测试与类型检查**

Run: `bun test tests/web-chat-manager.test.ts tests/web-chat-http.test.ts tests/web-chat-page.test.ts && bun run typecheck`

Expected: PASS。

- [ ] **Step 2: 运行全量测试和构建**

Run: `bun test && bun run build && git diff --check`

Expected: PASS。

- [ ] **Step 3: 重启并验收**

Run: `codex-gateway restart && codex-gateway status`

Expected: 服务运行。使用临时账户验证设置弹窗、继承文案、保存后新建空白会话的实际摘要；验收后删除临时账户。

- [ ] **Step 4: 核对范围**

确认未修改 Verbosity、未影响已有内容 Session、未执行 git add、commit 或 push。

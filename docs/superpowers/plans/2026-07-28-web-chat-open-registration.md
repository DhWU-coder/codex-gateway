# Web Chat Open Registration Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为局域网 Web Chat 增加可配置的开放注册页，注册成功后自动登录，并以真实客户端 IP 执行注册限流。

**Architecture:** `GatewayConfig` 保存注册开关，Daemon 维护可热更新的当前值并通过 Web Server provider 传入 Chat HTTP 层。`WebChatAuthService` 负责注册限流、用户创建和 Session 签发；页面根据服务端开关渲染登录或登录/注册双表单。

**Tech Stack:** Bun、TypeScript、Bun.password Argon2id、原生 HTML/CSS/JavaScript、现有 Web Chat 认证和用户存储。

**Approved spec:** `docs/superpowers/specs/2026-07-28-web-chat-open-registration-design.md`

---

## Chunk 1: 服务端注册能力

### Task 1: 注册配置与热更新 provider

**Files:**
- Modify: `src/config.ts`
- Modify: `src/service/daemon.ts`
- Modify: `src/web-server.ts`
- Modify: `config-example.yaml`
- Test: `tests/config.test.ts`
- Test: `tests/service-daemon.test.ts`
- Test: `tests/web-server.test.ts`

- [x] **Step 1: 写入失败测试**

断言 `webChat.registrationEnabled` 默认 `false`，显式布尔值 `true` 生效；Web Server 将 provider 交给 Chat HTTP；配置 watcher 成功读取新配置后更新 provider。

- [x] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
bun test tests/config.test.ts tests/service-daemon.test.ts tests/web-server.test.ts
```

Expected: FAIL，配置类型和 provider 尚不存在。

- [x] **Step 3: 实现最小配置与 provider**

为 `GatewayConfig` 增加：

```ts
webChat: {
  registrationEnabled: boolean;
};
```

Daemon 使用局部布尔值保存当前开关，配置热更新成功读取后立即更新。Web Server options 增加 `webChatRegistrationEnabledProvider`，调用 Chat handler 时传入。

- [x] **Step 4: 运行定向测试**

Run:

```bash
bun test tests/config.test.ts tests/service-daemon.test.ts tests/web-server.test.ts
bun run typecheck
```

Expected: PASS。

### Task 2: 注册认证与 IP 限流

**Files:**
- Modify: `src/web-chat/auth.ts`
- Test: `tests/web-chat-auth.test.ts`

- [x] **Step 1: 写入失败测试**

覆盖注册成功自动签发 Session、默认用户字段、重复用户名、非法密码、同一 IP 一小时最多 5 次、不同 IP 独立以及窗口过期恢复。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-auth.test.ts
```

Expected: FAIL，`register` 不存在。

- [x] **Step 3: 实现注册结果和独立限流器**

增加 `WebChatRegistrationResult` 与：

```ts
register(
  username: string,
  password: string,
  clientAddress: string
): Promise<WebChatRegistrationResult>;
```

注册尝试按客户端地址保留最近一小时记录，默认最多 5 次。成功后复用私有 Session 签发函数，避免复制 Cookie 和 CSRF 逻辑。

- [x] **Step 4: 运行认证测试**

Run:

```bash
bun test tests/web-chat-auth.test.ts tests/web-chat-user-store.test.ts
bun run typecheck
```

Expected: PASS。

### Task 3: 公开注册 HTTP

**Files:**
- Modify: `src/web-chat/http.ts`
- Test: `tests/web-chat-http.test.ts`
- Test: `tests/web-access-control.test.ts`

- [x] **Step 1: 写入失败测试**

验证关闭返回 `403`；开启后远程注册返回 `201`、Session Cookie 和 CSRF；重复用户名返回 `409`；注册请求不需要登录或 CSRF；远程管理 API 仍为 `403`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-http.test.ts tests/web-access-control.test.ts
```

Expected: FAIL，注册路由不存在。

- [x] **Step 3: 实现注册路由**

在认证检查之前处理 `/api/chat/auth/register`。开关关闭直接拒绝；开启时调用认证服务并映射状态、Cookie 和 `Retry-After`。

- [x] **Step 4: 运行服务端回归**

Run:

```bash
bun test tests/web-chat-http.test.ts tests/web-chat-auth.test.ts tests/web-server.test.ts tests/web-access-control.test.ts
bun run typecheck
```

Expected: PASS。

## Chunk 2: 注册页面与交付

### Task 4: 登录/注册双表单

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/script.ts`
- Modify: `src/web/chat/styles.ts`
- Test: `tests/web-chat-page.test.ts`

- [x] **Step 1: 写入失败测试**

开启注册时断言存在标签、注册表单、确认密码和注册 API；关闭时不存在注册入口；所有内联脚本语法有效，页面仍不包含管理 API。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
bun test tests/web-chat-page.test.ts
```

Expected: FAIL，页面只有登录表单。

- [x] **Step 3: 实现响应式认证卡片**

`renderWebChatPage` 接收 `registrationEnabled`。开启时渲染双标签和注册表单，脚本增加表单切换、确认密码校验、注册请求、自动登录；关闭时不绑定不存在的控件。

- [x] **Step 4: 运行页面与 HTTP 回归**

Run:

```bash
bun test tests/web-chat-page.test.ts tests/web-chat-http.test.ts
bun run typecheck
```

Expected: PASS。

### Task 5: 文档、当前配置和最终验证

**Files:**
- Modify: `README.md`
- Modify: `config-example.yaml`
- Modify ignored runtime file: `config.yaml`
- Test: `tests/readme.test.ts`

- [x] **Step 1: 更新文档测试并确认失败**

README 必须说明开放注册开关、默认关闭、注册成功自动登录和管理员仍可管理用户。

- [x] **Step 2: 更新文档和配置**

示例配置使用安全默认值 `false`，当前项目 `config.yaml` 设置为 `true`。

- [x] **Step 3: 执行完整自动化验证**

Run:

```bash
bun test
bun run typecheck
bun run build
git diff --check
```

Expected: 全部退出码为 0。

- [x] **Step 4: 重启并执行真实局域网流程**

Run:

```bash
codex-gateway restart
codex-gateway status
```

通过局域网地址完成注册、自动认证、创建 Session、退出，并从本机管理 API 彻底删除临时用户。验证关闭开关时注册 API 为 `403`，但不改动用户已有账号。

- [x] **Step 5: 最终状态检查**

Run:

```bash
git status --short
```

Expected: 不执行 `git add`、提交或 push，保留用户原有 `.DS_Store`。

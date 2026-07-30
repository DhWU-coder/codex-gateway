# Feishu Event Idempotency Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让飞书长连接快速确认事件，并通过跨重启的 `message_id` 去重阻止重复 Codex 执行和回复。

**Architecture:** SDK 事件回调与耗时业务解耦，回调立即返回，后台 Promise 独立捕获异常。新增按账户落盘的消息去重存储，Channel 在任何异步业务开始前原子领取消息 ID。

**Tech Stack:** Bun、TypeScript、Node 文件系统 API、飞书 Node SDK、Bun Test。

---

## Chunk 1: 快速确认事件

### Task 1: SDK 回调异步派发

**Files:**
- Modify: `src/feishu/client.ts`
- Test: `tests/feishu-client.test.ts`

- [x] **Step 1: 写入失败测试**

验证 SDK 注册的回调在业务 Promise 未完成时已经结束，并验证业务拒绝会交给错误处理器。

- [x] **Step 2: 运行测试确认失败**

Run: `bun test tests/feishu-client.test.ts`

Expected: FAIL，现有回调仍等待业务 Promise，且没有后台错误处理入口。

- [x] **Step 3: 实现最小改动**

在 `createFeishuEventClient` 中异步派发 `onEvent`，立即结束 SDK 回调，并把后台错误交给可注入的 logger。

- [x] **Step 4: 运行测试确认通过**

Run: `bun test tests/feishu-client.test.ts`

Expected: PASS。

## Chunk 2: 持久化消息去重

### Task 2: 新增去重存储

**Files:**
- Create: `src/feishu/message-dedupe-store.ts`
- Create: `tests/feishu-message-dedupe-store.test.ts`

- [x] **Step 1: 写入失败测试**

覆盖首次领取、同实例重复、跨实例重复、过期清理、数量上限和损坏文件恢复。

- [x] **Step 2: 运行测试确认失败**

Run: `bun test tests/feishu-message-dedupe-store.test.ts`

Expected: FAIL，模块尚不存在。

- [x] **Step 3: 实现最小存储**

实现启动加载、同步领取、保留期清理、数量限制和原子 JSON 写入。

- [x] **Step 4: 运行测试确认通过**

Run: `bun test tests/feishu-message-dedupe-store.test.ts`

Expected: PASS。

## Chunk 3: Channel 接入

### Task 3: 使用持久化存储领取消息

**Files:**
- Modify: `src/feishu/channel.ts`
- Modify: `tests/feishu-channel.test.ts`

- [x] **Step 1: 写入失败测试**

重建 Channel 后再次投递同一 `message_id`，验证 Router 只执行一次；同时验证持久化失败不会进入业务执行。

- [x] **Step 2: 运行测试确认失败**

Run: `bun test tests/feishu-channel.test.ts`

Expected: FAIL，现有内存 Map 无法跨实例去重。

- [x] **Step 3: 实现接入**

从 `historyBaseDir` 推导记录路径，替换实例内 Map，并为重复丢弃和存储失败补充中文日志。

- [x] **Step 4: 运行测试确认通过**

Run: `bun test tests/feishu-channel.test.ts tests/feishu-message-dedupe-store.test.ts`

Expected: PASS。

## Chunk 4: 回归验证

### Task 4: 全量检查

**Files:**
- Verify: `src/feishu/client.ts`
- Verify: `src/feishu/message-dedupe-store.ts`
- Verify: `src/feishu/channel.ts`

- [x] **Step 1: 运行飞书测试**

Run: `bun test tests/feishu-*.test.ts`

Expected: PASS。

- [x] **Step 2: 运行类型检查和构建**

Run: `bun run typecheck && bun run build`

Expected: PASS。

- [x] **Step 3: 运行全量测试**

Run: `bun test`

Expected: PASS。

- [x] **Step 4: 检查工作区**

Run: `git diff --check && git status --short`

Expected: 无空白错误；仅出现本次修改和用户已有的未跟踪 `.DS_Store`。

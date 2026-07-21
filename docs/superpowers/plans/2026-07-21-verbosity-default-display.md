# Verbosity 默认值展示实施方案

## Task 1: Codex 默认值读取

**Files:**
- Modify: `src/codex/model-catalog.ts`
- Modify: `tests/codex-model-catalog.test.ts`

- [x] 扩展 app-server 协议测试，覆盖 `config/read` 和空值回退。
- [x] 让模型目录缓存同时提供模型列表和 Verbosity 默认值。
- [x] 验证模型目录测试通过。

## Task 2: API 与页面展示

**Files:**
- Modify: `src/service/daemon.ts`
- Modify: `src/web-server.ts`
- Modify: `src/web/page.ts`
- Modify: `tests/service-daemon.test.ts`
- Modify: `tests/web-server.test.ts`

- [x] 编写 API 和页面失败测试。
- [x] 在 `/api/models` 返回 Codex 默认设置。
- [x] 更新全局默认和账号继承的编辑态、只读态文字。
- [x] 验证相关测试通过。

## Task 3: 完整验收

- [x] 运行 `bun test`、`bun run typecheck`、`bun run build` 和 `git diff --check`。
- [x] 重启服务并验证桌面、移动端以及明暗主题。
- [x] 保持改动未提交，等待用户明确要求后再提交或推送。

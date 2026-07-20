# Codex Gateway Web 管理后台重构 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Project policy forbids subagents, worktrees, and Git commits unless the user explicitly requests them. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有调试式 Web UI 重构为参考 Claudish 的完整 Codex Gateway 管理后台，覆盖概览、用量、配置、频道、会话归档和日志。

**Architecture:** 保留 Bun 原生 HTTP 服务，将页面模板、用量聚合、日志读取和配置编辑拆入 `src/web/`。Daemon 监听项目配置文件并让 Map 化的 ChannelManager 执行账号级热更新，浏览器按模块按需请求数据。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、yaml、Bun test、Playwright CLI。

---

## Chunk 1: 后端数据服务

### Task 1: 用量聚合服务

**Files:**
- Create: `src/web/usage-service.ts`
- Create: `tests/web-usage-service.test.ts`
- Reference: `src/codex/usage-log.ts`
- Reference: `/Users/wudonghao/python_program/claudish/packages/cli/src/web-usage-service.ts`

- [ ] **Step 1: 写失败测试**

覆盖空文件、损坏 JSONL、今日/本周/本月/全部/最近/自定义范围、日/周/月时间桶、Token 合计、按模型与 cwd 分组和最近请求排序。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/web-usage-service.test.ts`

Expected: FAIL，因为 `src/web/usage-service.ts` 尚不存在。

- [ ] **Step 3: 实现聚合服务**

导出 `getUsageDashboard(options)`，只读取 `<projectRoot>/.codex-usage/usage.jsonl`，只接受 `codex-usage.project-log.v1`。将 `input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens` 归一化为稳定计数结构。

- [ ] **Step 4: 验证通过**

Run: `bun test tests/web-usage-service.test.ts`

Expected: PASS。

### Task 2: 受限日志服务

**Files:**
- Create: `src/web/log-service.ts`
- Create: `tests/web-log-service.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖不存在文件、读取文件尾部、游标增量读取、文件截断或轮转、最大字节限制、日志级别识别和下载响应所需元数据。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/web-log-service.test.ts`

Expected: FAIL，因为日志服务尚不存在。

- [ ] **Step 3: 实现日志服务**

导出 `readServiceLogTail({ logPath, cursor, maxBytes })`。`logPath` 只能由服务端注入，客户端不能指定。返回 `content`、`cursor`、`reset`、`size` 和 `updatedAt`。

- [ ] **Step 4: 验证通过**

Run: `bun test tests/web-log-service.test.ts`

Expected: PASS。

### Task 3: 飞书配置编辑器

**Files:**
- Create: `src/web/config-editor.ts`
- Create: `tests/web-config-editor.test.ts`
- Reference: `src/config.ts`
- Reference: `/Users/wudonghao/python_program/claudish/packages/cli/src/service/feishu-config-editor.ts`

- [ ] **Step 1: 写失败测试**

覆盖账号读取、Secret 脱敏、按 ID 读取 Secret、保留未修改字段与 YAML 注释、原子替换、重复 ID、空 App ID、缺少 Secret、非法域名和旧值 Secret 复用。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/web-config-editor.test.ts`

Expected: FAIL，因为配置编辑器尚不存在。

- [ ] **Step 3: 实现配置编辑器**

使用 `parseDocument` 修改 `channels.feishu.accounts`。公共状态中的 `appSecret` 必须为空，只返回 `hasAppSecret`。保存仅接受 `id`、`enabled`、`appId`、`appSecret`、`botOpenId`、`domain` 和 `sendProgressReplies`；`model`、`cwd`、`historyBaseDir`、`history`、`summary` 等字段从原账号保留。

写入流程使用同目录临时文件、`chmod 0600` 和 `renameSync`，失败时清理临时文件。

- [ ] **Step 4: 验证通过**

Run: `bun test tests/web-config-editor.test.ts`

Expected: PASS。

## Chunk 2: 配置热更新与服务生命周期

### Task 4: ChannelManager Map 化和账号级重载

**Files:**
- Modify: `src/channel-manager.ts`
- Modify: `tests/channel-manager.test.ts`

- [ ] **Step 1: 写失败测试**

新增 `reloadConfig` 测试：账号新增、删除、凭据变化重建、过程回复原地更新、非热字段保留、未知账号操作和重建失败恢复旧 Channel。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/channel-manager.test.ts`

Expected: FAIL，因为现有 manager 使用固定数组且没有 `reloadConfig`。

- [ ] **Step 3: 实现最小重载能力**

使用 `Map<string, ManagedChannel>` 和 `Map<string, FeishuAccountConfig>` 保存频道及有效配置。新增 `ChannelReloadResult`、`reloadConfig`、`restartChannel` 和私有 add/remove/replace/update 辅助方法。

凭据、启用和域名变化时重建单个 Channel；`sendProgressReplies` 原地更新；非热字段使用旧值。重建失败时尝试重新启动旧 Channel，再向上抛出带账号上下文的错误。

- [ ] **Step 4: 验证通过**

Run: `bun test tests/channel-manager.test.ts`

Expected: PASS。

### Task 5: Daemon 配置监听与重载状态

**Files:**
- Modify: `src/service/daemon.ts`
- Modify: `tests/service-daemon.test.ts`
- Modify: `src/service/state.ts`

- [ ] **Step 1: 写失败测试**

覆盖监听实际 `configPath`、500ms 防抖、成功调用 `reloadConfig`、解析失败隔离、关闭 watcher 和公开最近重载结果。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/service-daemon.test.ts`

Expected: FAIL，因为 daemon 尚未监听配置文件。

- [ ] **Step 3: 实现配置 watcher**

新增可注入的 `createConfigWatcher`。每次变化重新执行 `loadGatewayConfig({ configPath })` 并调用 `channelManager.reloadConfig`。错误写入内存 `configReloadState`，不停止 Web 服务和现有频道。

- [ ] **Step 4: 验证通过**

Run: `bun test tests/service-daemon.test.ts`

Expected: PASS。

### Task 6: Web 触发服务重启

**Files:**
- Modify: `src/service/process.ts`
- Modify: `tests/service-process.test.ts`
- Modify: `src/service/daemon.ts`

- [ ] **Step 1: 写失败测试**

覆盖构造 `restart --config <path>` 参数、分离启动辅助进程、日志文件描述符处理和缺少 PID 错误。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/service-process.test.ts`

Expected: FAIL，因为辅助重启函数尚不存在。

- [ ] **Step 3: 实现重启调度**

新增 `scheduleDetachedServiceRestart`，使用当前 Bun runtime 和入口执行 `restart` 命令。Web API 返回后延迟几十毫秒调用，避免连接在响应前中断。

- [ ] **Step 4: 验证通过**

Run: `bun test tests/service-process.test.ts tests/service-daemon.test.ts`

Expected: PASS。

## Chunk 3: Web API 与页面

### Task 7: 扩展 Web API 并保持兼容

**Files:**
- Modify: `src/web-server.ts`
- Create: `src/web/types.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: 写失败 API 测试**

覆盖 `/api/overview`、`/api/usage`、`/api/config`、`/api/feishu-config`、Secret、日志尾部、日志下载和服务重启。覆盖非法 JSON、校验错误、未知账号、方法不允许和 Secret 不出现在普通响应中。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/web-server.test.ts`

Expected: FAIL，因为新 API 尚不存在。

- [ ] **Step 3: 实现路由依赖注入**

扩展 `WebServerOptions`，注入 `projectRoot`、`configPath`、`logPath`、`configReloadStateProvider` 和 `restartService`。路由只负责编排，聚合、日志和配置逻辑调用对应服务模块。

- [ ] **Step 4: 验证通过**

Run: `bun test tests/web-server.test.ts`

Expected: PASS，现有 API 测试继续通过。

### Task 8: 提取并重构管理后台页面

**Files:**
- Create: `src/web/page.ts`
- Modify: `src/web-server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: 写失败页面测试**

断言页面包含概览、用量、配置、频道、日志五个顶层模块，主题预加载脚本位于样式前，存在账号编辑、会话抽屉、归档、AI 总结、日志控制和危险操作确认入口，且不包含 Web Chat。

- [ ] **Step 2: 验证测试失败**

Run: `bun test tests/web-server.test.ts`

Expected: FAIL，因为当前页面仍是三标签调试布局。

- [ ] **Step 3: 实现页面骨架和视觉系统**

将 HTML、CSS 和浏览器脚本移动到 `src/web/page.ts`。参考 Claudish 的顶栏、标签、双栏频道工作区、账号重复项和抽屉；保持 6 至 8 像素圆角、语义色、稳定尺寸和桌面/移动响应式约束。

- [ ] **Step 4: 实现模块交互**

实现：

- 概览状态与服务操作。
- 用量筛选、指标、趋势 SVG、分组和最近调用。
- 公共配置展示。
- 飞书账号添加、编辑、删除、Secret 按需显示和连接测试。
- 会话详情抽屉、工具事件、附件、归档和 AI 总结。
- 日志增量刷新、暂停、筛选、搜索、复制和下载。
- 2 秒状态轮询、过期响应丢弃和选择状态保持。

- [ ] **Step 5: 验证页面测试通过**

Run: `bun test tests/web-server.test.ts`

Expected: PASS。

### Task 9: Daemon 集成所有 Web 依赖

**Files:**
- Modify: `src/service/daemon.ts`
- Modify: `tests/service-daemon.test.ts`

- [ ] **Step 1: 写失败集成测试**

断言 Web server 收到实际 `projectRoot`、`configPath`、`logPath`、重载状态和重启回调。

- [ ] **Step 2: 验证失败并实现集成**

Run: `bun test tests/service-daemon.test.ts`

Expected: 先 FAIL；完成注入后 PASS。

## Chunk 4: 验证与文档

### Task 10: 完整自动化验证

**Files:**
- Modify as needed: `README.md`
- Modify as needed: relevant tests

- [ ] **Step 1: 运行目标测试**

Run: `bun test tests/web-usage-service.test.ts tests/web-log-service.test.ts tests/web-config-editor.test.ts tests/channel-manager.test.ts tests/service-daemon.test.ts tests/service-process.test.ts tests/web-server.test.ts`

Expected: PASS。

- [ ] **Step 2: 运行完整验证**

Run: `bun test`

Run: `bun run typecheck`

Run: `bun run build`

Run: `git diff --check`

Expected: 全部成功。

- [ ] **Step 3: 更新 README**

补充 Web 管理后台模块、配置热更新边界、用量日志路径和日志页说明。README 中的启动命令继续只使用 `codex-gateway`。

### Task 11: 浏览器视觉验证

**Files:**
- No repository files unless fixes are required

- [ ] **Step 1: 重启本地服务**

Run: `codex-gateway restart`

Expected: 输出 Web UI 地址，服务在后台运行。

- [ ] **Step 2: Playwright 桌面检查**

在 `1440x1000` 检查五个模块、深浅主题、账号编辑、会话抽屉、日志和无重叠。

- [ ] **Step 3: Playwright 移动检查**

在 `390x844` 检查标签横向滚动、单栏账号、全屏抽屉、按钮与长文本不溢出。

- [ ] **Step 4: 最终回归**

修复视觉问题后重新运行 `bun test`、`bun run typecheck`、`bun run build` 和 `git diff --check`。

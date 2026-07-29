# Web Chat Status And Action Buttons Implementation Plan

> **For implementation:** REQUIRED: Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web Chat 运行状态保持单行可读，并用 Lucide 图标、中文标签和 Tooltip 明确表达分支、删除、账户、主题与退出操作。

**Architecture:** 新增一个只负责把 Lucide `IconNode` 安全渲染为内联 SVG 的小模块，页面模板只组合图标与中文标签。现有客户端脚本继续处理业务事件，但运行状态改为更新独立标签，主题切换只更新属性，不再覆盖按钮 DOM。

**Tech Stack:** Bun、TypeScript、原生 HTML/CSS/JavaScript、Lucide、Bun Test、Playwright

---

## Chunk 1: 图标渲染与页面结构

### Task 1: 添加本地图标渲染器

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/web/chat/icons.ts`
- Create: `tests/web-chat-icons.test.ts`

- [ ] **Step 1: 编写失败测试**

测试 `renderWebChatIcon` 能渲染 Lucide `GitFork`，包含固定的 SVG 可访问属性，并转义自定义节点中的危险属性值。

```ts
import { GitFork, type IconNode } from "lucide";
import { renderWebChatIcon } from "../src/web/chat/icons.js";

expect(renderWebChatIcon(GitFork)).toContain('aria-hidden="true"');
expect(renderWebChatIcon(GitFork)).toContain('focusable="false"');
expect(
  renderWebChatIcon([["path", { d: '"><script>' }]] as IconNode)
).not.toContain("<script>");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/web-chat-icons.test.ts`

Expected: FAIL，因为 `lucide` 依赖和 `src/web/chat/icons.ts` 尚不存在。

- [ ] **Step 3: 安装 Lucide 并实现最小渲染器**

Run: `bun add lucide@^1.27.0`

渲染器只允许 Lucide 使用的 SVG 子元素标签，转义类名与属性值，并输出固定根节点：

```ts
export function renderWebChatIcon(
  icon: IconNode,
  className = "button-icon"
): string {
  const children = icon.map(renderNode).join("");
  return `<svg class="${escapeAttribute(className)}" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
}
```

- [ ] **Step 4: 运行图标测试和类型检查**

Run: `bun test tests/web-chat-icons.test.ts && bun run typecheck`

Expected: PASS。

### Task 2: 重构状态与操作按钮结构

**Files:**
- Modify: `src/web/chat/page.ts`
- Modify: `src/web/chat/styles.ts`
- Modify: `src/web/chat/script.ts`
- Modify: `tests/web-chat-page.test.ts`

- [ ] **Step 1: 编写失败页面测试**

增加以下断言：

```ts
expect(html).toContain('class="run-status" id="runStatus"');
expect(html).toContain('class="run-status-label">就绪</span>');
expect(html).not.toContain('class="status-dot" id="runStatus"');
expect(html).toContain('class="button-label">分支</span>');
expect(html).toContain('class="button-label">删除</span>');
expect(html).toContain('class="button-label">账户</span>');
expect(html).toContain('class="button-label">主题</span>');
expect(html).toContain('class="button-label">退出</span>');
expect(html).toContain("danger-action");
expect(html).toContain("data-tooltip=");
expect(html).toContain("<svg");
expect(html).not.toContain('byId("runStatus").textContent =');
expect(html).not.toContain('byId("themeButton").textContent =');
```

- [ ] **Step 2: 运行页面测试确认失败**

Run: `bun test tests/web-chat-page.test.ts`

Expected: FAIL，指出旧状态圆点、字符图标和脚本覆盖行为仍存在。

- [ ] **Step 3: 修改页面模板**

在 `page.ts` 中导入选定 Lucide 图标和 `renderWebChatIcon`：

- 状态使用 `.run-status`、`.run-status-dot` 和 `.run-status-label`；
- 分支、删除、账户、主题、退出使用 `.action-button`、内联 SVG 和 `.button-label`；
- 删除增加 `.danger-action`；
- 所有操作设置准确的 `title`、`aria-label` 和 `data-tooltip`；
- 主题按钮同时包含 Moon 与 Sun，由主题 CSS 控制显示；
- 侧栏底部改为用户名行和三列操作行。

- [ ] **Step 4: 修改样式与响应式规则**

在 `styles.ts` 中：

- 保留 `.status-dot` 给会话列表；
- 新增不会换行的 `.run-status`；
- 新增固定高度的 `.action-button`、`.button-icon`、危险态、禁用态和 Tooltip；
- 侧栏底部使用两行布局，三个按钮等宽；
- 宽屏显示按钮文字，中等宽度隐藏顶部文字，移动端隐藏侧栏操作文字；
- 移动端保持标题、状态、运行参数入口和两个会话操作不重叠。

- [ ] **Step 5: 修改状态与主题脚本**

`updateRunControls` 只更新 `.run-status-label`、`.running` 和 `aria-label`：

```js
var status = byId("runStatus");
status.querySelector(".run-status-label").textContent = running ? "运行中" : "就绪";
status.classList.toggle("running", running);
status.setAttribute("aria-label", running ? "运行状态：运行中" : "运行状态：就绪");
```

`applyTheme` 只同步 `data-theme` 和主题按钮的 `title`、`aria-label`、`data-tooltip`，不得修改 `textContent`。

- [ ] **Step 6: 运行页面测试与类型检查**

Run: `bun test tests/web-chat-page.test.ts tests/web-chat-icons.test.ts && bun run typecheck`

Expected: PASS。

## Chunk 2: 回归与视觉验证

### Task 3: 完成全量验证并加载新页面

**Files:**
- Verify: `src/web/chat/page.ts`
- Verify: `src/web/chat/styles.ts`
- Verify: `src/web/chat/script.ts`

- [ ] **Step 1: 执行全量自动化验证**

Run: `bun test`

Expected: 所有测试通过。

Run: `bun run typecheck && bun run build`

Expected: 类型检查和生产构建通过。

- [ ] **Step 2: 重启 Gateway**

Run: `codex-gateway restart`

Expected: 服务成功启动，并打印本机管理地址和局域网 Chat 地址。

- [ ] **Step 3: 使用临时用户执行浏览器视觉检查**

通过本机管理 API 创建临时用户；使用 Playwright 登录 `/chat`，分别截图：

- 桌面深色主题；
- 桌面浅色主题；
- 390x844 移动视口。

检查状态保持单行、按钮标签清晰、Tooltip 与主题图标正确、按钮和运行参数不重叠。完成后删除临时用户和截图临时文件。

- [ ] **Step 4: 检查最终变更范围**

Run: `git diff --check`

Expected: 无空白错误。确认没有修改 Chat 业务、Session、认证或飞书行为，不执行 `git add`、提交或推送。

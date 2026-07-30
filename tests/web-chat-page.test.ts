import { describe, expect, test } from "bun:test";
import { renderWebChatPage } from "../src/web/chat/page.js";
import { WEB_CHAT_MARKDOWN_SCRIPT } from "../src/web/chat/markdown.js";

describe("Web Chat 页面", () => {
  test("仅在开放注册时显示登录与注册切换表单", () => {
    const disabled = renderWebChatPage();
    const enabled = renderWebChatPage({ registrationEnabled: true });

    expect(disabled).not.toContain('id="authRegisterTab"');
    expect(disabled).not.toContain('id="registerForm"');
    expect(enabled).toContain('id="authLoginTab"');
    expect(enabled).toContain('id="authRegisterTab"');
    expect(enabled).toContain('id="registerForm"');
    expect(enabled).toContain('id="registerUsernameInput"');
    expect(enabled).toContain('id="registerPasswordInput"');
    expect(enabled).toContain('id="registerConfirmPasswordInput"');
    expect(enabled).toContain('minlength="8"');
    expect(enabled).toContain("/api/chat/auth/register");
    expect(enabled).toContain('if (password !== confirmation)');
    expect(enabled).toContain('byId("registerError").textContent');
  });

  test("包含完整 Chat 工作区和响应式控件", () => {
    const html = renderWebChatPage();

    for (const marker of [
      'id="loginView"',
      'id="chatApp"',
      'id="sessionSidebar"',
      'id="sessionList"',
      'id="sessionContextMenu"',
      'id="newSessionButton"',
      'id="messageList"',
      'id="fileInput"',
      'id="composerInput"',
      'id="commandPalette"',
      'id="referencePalette"',
      'id="selectedReferences"',
      'id="runtimeSummaryButton"',
      'id="runtimeMenu"',
      'id="latestActivityBar"',
      'id="sendButton"',
      'id="stopButton"',
      'id="mobileMenuButton"',
      'id="themeButton"',
      'id="errorToast"',
    ]) {
      expect(html).toContain(marker);
    }
    expect(html).toContain("@media (max-width: 760px)");
    expect(html).toContain("env(safe-area-inset-bottom)");
  });

  test("认证首屏安全内嵌 Bootstrap 并在同步恢复前禁止绘制", () => {
    const html = renderWebChatPage({
      initiallyAuthenticated: true,
      bootstrapData: {
        version: 1,
        identity: {
          user: {
            id: "user-test",
            username: "</script><script>globalThis.attacked=true</script>",
            enabled: true,
            createdAt: "2026-07-29T09:00:00.000Z",
            updatedAt: "2026-07-29T09:00:00.000Z",
            workspacePath: "/private/workspace",
            sessionsPath: "/private/sessions",
          },
          csrfToken: "csrf-test",
          expiresAt: 1_800_000_000_000,
        },
        models: [],
        sessions: [],
        current: null,
        commands: [],
      },
    });

    expect(html).toContain(
      '<html lang="zh-CN" data-chat-bootstrap="pending">'
    );
    expect(html).toContain(
      '<script type="application/json" id="webChatBootstrap">'
    );
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain(
      "</script><script>globalThis.attacked=true</script>"
    );
    expect(html).toContain(
      ':root[data-chat-bootstrap="pending"] body'
    );
    expect(html).toContain("function readServerBootstrap()");
    expect(html).toContain("function restoreServerBootstrap(data)");
    expect(html).toContain(
      'document.documentElement.removeAttribute("data-chat-bootstrap")'
    );
  });

  test("会话菜单和主要操作使用清晰标签与 Lucide 图标", () => {
    const html = renderWebChatPage();

    expect(html).toContain('class="latest-activity" id="latestActivityBar"');
    for (const label of ["重命名", "删除", "设置", "主题", "退出"]) {
      expect(html).toContain(`class="button-label">${label}</span>`);
    }
    for (const legacyIcon of ["⑂", "⌫", "◎", "↪", "⚙"]) {
      expect(html).not.toContain(legacyIcon);
    }
    expect(html).toContain("session-menu-icon");
    expect(html).toContain("session-rename-icon");
    expect(html).toContain("danger-action");
    expect(html).toContain("data-tooltip=");
    expect(html).toContain('class="button-icon"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain(".latest-activity");
    expect(html).toContain(".tooltip-button");
    expect(html).not.toContain('byId("themeButton").textContent =');
  });

  test("账户设置支持默认模型配置和独立修改密码页签", () => {
    const html = renderWebChatPage();

    for (const marker of [
      'id="accountDialog"',
      'id="accountSettingsModelTab"',
      'id="accountSettingsPasswordTab"',
      'id="accountModelPanel"',
      'id="accountPasswordPanel"',
      'id="accountModelForm"',
      'id="accountModelInput"',
      'id="accountModelOptions"',
      'id="accountEffortSelect"',
      'id="accountSpeedSelect"',
      'id="passwordForm"',
    ]) {
      expect(html).toContain(marker);
    }
    expect(html).toContain("/api/chat/account-settings");
    expect(html).toContain("function switchAccountSettingsTab(tab)");
    expect(html).toContain("async function openAccountSettings()");
    expect(html).toContain("function renderAccountSettings()");
    expect(html).toContain("async function saveAccountSettings(event)");
    expect(html).toContain("accountSettings.effective");
    expect(html).toContain("accountSettings.inherited");
    expect(html).toContain("accountSettings.defaults");
    expect(html).toContain('value="">继承全局');
    expect(html).not.toContain('id="accountVerbosity');
  });

  test("会话列表支持右键、移动端省略号、长按、行内重命名和删除", () => {
    const html = renderWebChatPage();

    expect(html).toContain('id="sessionContextRename"');
    expect(html).toContain('id="sessionContextDelete"');
    expect(html).toContain('addEventListener("contextmenu"');
    expect(html).toContain('className = "session-more"');
    expect(html).toContain("startSessionLongPress");
    expect(html).toContain("550");
    expect(html).toContain("beginSessionRename");
    expect(html).toContain('event.key === "Escape"');
    expect(html).toContain('method: "PATCH"');
    expect(html).toContain('method: "DELETE"');
  });

  test("会话列表支持选择、全选和一次性批量删除", () => {
    const html = renderWebChatPage();

    for (const marker of [
      'id="sessionSelectionToolbar"',
      'id="sessionSelectionButton"',
      'id="sessionSelectAll"',
      'id="sessionSelectionCount"',
      'id="sessionBulkDelete"',
      'id="sessionSelectionCancel"',
    ]) {
      expect(html).toContain(marker);
    }
    expect(html).toContain("state.selectedSessionIds");
    expect(html).toContain("function enterSessionSelection()");
    expect(html).toContain("function toggleAllSessions()");
    expect(html).toContain("async function batchDeleteSessions()");
    expect(html).toContain("\\u6B63\\u5728\\u8FD0\\u884C\\uFF0C\\u5C06\\u5148\\u505C\\u6B62\\u4EFB\\u52A1");
    expect(html).toContain('method: "DELETE"');
    expect(html).toContain('body: { sessionIds: selectedIds }');
    expect(html).toContain("selectAll.indeterminate");
    expect(html).toContain(".session-selection-toolbar");
    expect(html).toContain(".session-select-box");
  });

  test("模型配置位于 Composer，命令和引用面板不包含 Verbosity", () => {
    const html = renderWebChatPage();

    for (const removed of [
      'id="modelInput"',
      'id="effortSelect"',
      'id="fastToggle"',
      'id="verbositySelect"',
      'id="runtimeControls"',
      'id="runtimeMenuButton"',
    ]) {
      expect(html).not.toContain(removed);
    }
    expect(html).toContain("renderRuntimeMenu");
    expect(html).toContain("renderCommandPalette");
    expect(html).toContain("renderReferencePalette");
    expect(html).toContain("/api/chat/capabilities");
    expect(html).toContain("/api/chat/files/search");
    expect(html).toContain("/commands");
    expect(html).toContain("state.selectedReferences");
    expect(html).not.toContain("/verbosity");
    expect(html).not.toContain("Verbosity 默认");
  });

  test("引用面板按类型排序并在每项右侧显示类型", () => {
    const html = renderWebChatPage();
    const order = [
      "plugin: 0",
      "skill: 1",
      "app: 2",
      "file: 3",
      "directory: 4",
    ].map((value) => html.indexOf(value));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(html).toContain(
      "unique.sort(function (left, right) {\n      return referenceKindRank(left.kind) - referenceKindRank(right.kind);"
    );
    expect(html).toContain('meta: referenceKindLabel(item.kind)');
    expect(html).toContain('meta: "\\u6587\\u4EF6"');
    expect(html).toContain('meta.className = "palette-meta"');
    expect(html).toContain(
      ".palette-meta { color: var(--muted); font-size: 11px; font-weight: 700; white-space: nowrap; }"
    );
  });

  test("新建与发送按钮稳定居中且模型摘要显示实际生效配置", () => {
    const html = renderWebChatPage();

    expect(html).toContain(
      ".new-session { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }"
    );
    expect(html).toContain(
      ".composer-submit { width: 44px; height: 44px; min-height: 44px; display: grid; place-items: center; flex: 0 0 auto; padding: 0; border-radius: 50%; }"
    );
    expect(html).toContain(
      ".composer-submit .button-icon { margin: 0; }"
    );
    expect(html).toContain("function effectiveModel()");
    expect(html).toContain("model.isDefault");
    expect(html).toContain("model.defaultReasoningEffort");
    expect(html).toContain('session.fast ? "Fast" : "\\u6807\\u51C6"');
    expect(html).toContain('join(" \\u00B7 ")');
    expect(html).toContain(
      "effectiveReasoningEffort(null, selectedModel)"
    );
    expect(html).not.toContain(
      '<span id="runtimeSummaryText">模型默认</span>'
    );
    expect(html).not.toContain("\\u6A21\\u578B\\u9ED8\\u8BA4");
  });

  test("Composer 使用上下分层创作区并由外壳统一显示聚焦状态", () => {
    const html = renderWebChatPage();

    expect(html).toContain('class="composer-editor"');
    expect(html).toContain('class="composer-toolbar"');
    expect(html).toContain('class="composer-toolbar-start"');
    expect(html).toContain(
      ".composer { display: flex; min-height: 116px; flex-direction: column;"
    );
    expect(html).toContain(".composer:focus-within");
    expect(html).toContain(
      ".composer-toolbar { display: flex; min-height: 44px; align-items: center; justify-content: space-between;"
    );
    expect(html).toContain(
      "#sendButton.composer-submit { border-color: var(--composer-submit-bg); background: var(--composer-submit-bg); color: var(--composer-submit-fg); }"
    );
    expect(html).toContain(
      ".composer { min-height: 104px; padding: 12px; border-radius: 16px; }"
    );
  });

  test("Composer 在输入法组合期间不触发发送或面板快捷键", () => {
    const html = renderWebChatPage();
    const guard = 'if (event.isComposing || composerIsComposing || event.keyCode === 229) return;';
    const guardIndex = html.indexOf(guard);
    const sendIndex = html.indexOf(
      'if (event.key === "Enter" && !event.shiftKey)',
      guardIndex
    );

    expect(html).toContain("var composerIsComposing = false;");
    expect(html).toContain('addEventListener("compositionstart"');
    expect(html).toContain('addEventListener("compositionend"');
    expect(html).toContain(guard);
    expect(html).toContain("var composerCompositionEndedAt = 0;");
    expect(html).toContain("composerCompositionEndedAt = Date.now();");
    expect(html).toContain(
      'event.key === "Enter" && Date.now() - composerCompositionEndedAt < 200'
    );
    expect(guardIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(guardIndex);
  });

  test("CSRF 失配时同步当前身份并且最多重试一次", () => {
    const html = renderWebChatPage();

    expect(html).toContain("async function refreshCsrfIdentity()");
    expect(html).toContain('fetch("/api/chat/me")');
    expect(html).toContain(
      'response.status === 403 && body && body.error === "CSRF \\u6821\\u9A8C\\u5931\\u8D25\\u3002"'
    );
    expect(html).toContain("&& csrfRetried !== true");
    expect(html).toContain("return api(path, options, true);");
    expect(html).toContain("previousUserId !== body.user.id");
    expect(html).toContain(
      "\\u767B\\u5F55\\u8D26\\u6237\\u5DF2\\u53D8\\u5316\\uFF0C\\u8BF7\\u91CD\\u8BD5\\u5F53\\u524D\\u64CD\\u4F5C\\u3002"
    );
  });

  test("Trace 归入对应 Codex 回复，完成后自动折叠并保留手动展开能力", () => {
    const html = renderWebChatPage();

    expect(html).toContain("traceByAssistantMessage");
    expect(html).toContain("createTraceAssistantNode");
    expect(html).toContain("createMessageNode(message, trace)");
    expect(html).toContain("function createTraceNode(trace, inline)");
    expect(html).toContain("(trace.entries || []).forEach");
    expect(html).toContain('entry.type === "tool_group"');
    expect(html).toContain("createToolGroupNode");
    expect(html).toContain("trace.status === \"running\"");
    expect(html).toContain('var canRememberToggle = trace.status !== "running";');
    expect(html).toContain('var wasRunning = trace && trace.status === "running";');
    expect(html).toContain("state.expandedTraceIds.delete(trace.messageId);");
    expect(html).toContain("state.expandedTraceIds");
    expect(html).toContain("state.activities.set");
    expect(html).toContain("scheduleTraceRefresh");
    expect(html).toContain("scrollIntoView");
    expect(html).toContain("message.activity");
    expect(html).toContain("message.trace");
    expect(html).toContain(".trace-card.inline");
    expect(html).toContain('content: "›"');
    expect(html).not.toContain('content: "\\u203A"');
  });

  test("已接收的用户消息在服务端历史落盘前保持显示", () => {
    const html = renderWebChatPage();

    expect(html).toContain("pendingAcceptedMessages: new Map()");
    expect(html).toContain("function rememberAcceptedMessage(message)");
    expect(html).toContain("function mergePendingAcceptedMessages(serverMessages)");
    expect(html).toContain("state.pendingAcceptedMessages.set(message.id, message)");
    expect(html).toContain(
      "state.messages = mergePendingAcceptedMessages(serverMessages);"
    );
    expect(html).toContain("state.pendingAcceptedMessages.delete(message.id)");
  });

  test("失败 Trace 展开后显示具体错误", () => {
    const html = renderWebChatPage();

    expect(html).toContain('trace.status === "failed" && trace.error');
    expect(html).toContain('error.className = "trace-error"');
    expect(html).toContain("error.textContent = trace.error");
    expect(html).toContain(".trace-error");
  });

  test("只包含 Chat API，不暴露管理导航和完整日志能力", () => {
    const html = renderWebChatPage();

    expect(html).toContain("/api/chat/");
    expect(html).not.toContain("/api/config");
    expect(html).not.toContain("/api/logs");
    expect(html).not.toContain("/api/web-chat");
    expect(html).not.toContain("标准错误");
    expect(html).not.toContain("stderr");
    expect(html).not.toContain("管理后台");
  });

  test("任意 Chat API 返回 401 时统一清理旧状态并返回登录页", () => {
    const html = renderWebChatPage();

    expect(html).toContain('if (response.status === 401) resetAuthenticationState();');
    expect(html).toContain("function resetAuthenticationState()");
    expect(html).toContain("state.eventSource?.close();");
    expect(html).toContain("state.streamText.clear();");
    expect(html).toContain("state.pendingFiles = [];");
    expect(html).toContain("state.selectedReferences = [];");
    expect(html).toContain('byId("currentUserName").textContent = "";');
    expect(html).toContain('switchAuthMode("login");');
    expect(html).toContain("setAuthenticated(false);");
    expect(html).toContain("async function restoreAuthenticatedPage()");
    expect(html).toContain("await loadInitialData().catch(showError);");
  });

  test("文件选择、拖拽和粘贴共用附件队列并允许纯附件发送", () => {
    const html = renderWebChatPage();

    expect(html).toContain('id="fileDropOverlay"');
    expect(html).toContain("松开以添加文件");
    expect(html).toContain("function addPendingFiles(files)");
    expect(html).toContain('addEventListener("dragenter"');
    expect(html).toContain('addEventListener("dragleave"');
    expect(html).toContain('addEventListener("drop"');
    expect(html).toContain('addEventListener("paste"');
    expect(html).toContain("clipboardData.items");
    expect(html).toContain("MAX_PENDING_FILE_BYTES");
    expect(html).toContain("state.selectedReferences.length === 0");
  });

  test("消息附件使用带元信息和独立下载按钮的紧凑文件条", () => {
    const html = renderWebChatPage();

    expect(html).toContain('id="fileIconTemplate"');
    expect(html).toContain('id="downloadIconTemplate"');
    expect(html).toContain("function formatAttachmentType(file)");
    expect(html).toContain("function formatFileSize(value)");
    expect(html).toContain('container.className = "attachments file-attachments"');
    expect(html).toContain('item.className = "attachment-file"');
    expect(html).toContain('name.className = "attachment-name"');
    expect(html).toContain('meta.className = "attachment-meta"');
    expect(html).toContain('download.className = "attachment-download tooltip-button"');
    expect(html).toContain('download.setAttribute("download", file.name)');
    expect(html).toContain(
      'download.setAttribute("data-tooltip", "\\u4E0B\\u8F7D\\u6587\\u4EF6")'
    );
    expect(html).toContain(
      ".attachment-file {"
    );
    expect(html).toContain(
      ".attachment-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }"
    );
    expect(html).toContain(
      ".attachment-file { width: 100%; max-width: 100%; }"
    );
    expect(html).not.toContain('link.textContent = "↓ " + file.name');
  });

  test("图片附件显示缩略图并支持弹窗查看大图", () => {
    const html = renderWebChatPage();

    expect(html).toContain('id="imagePreviewDialog"');
    expect(html).toContain('id="imagePreviewImage"');
    expect(html).toContain('id="imagePreviewDownload"');
    expect(html).toContain("function isPreviewableImage(file)");
    expect(html).toContain("function createImageAttachment(file)");
    expect(html).toContain("function createFileAttachment(file)");
    expect(html).toContain("function openImagePreview(file)");
    expect(html).toContain('preview.searchParams.set("preview", "1")');
    expect(html).toContain('image.className = "attachment-thumbnail-image"');
    expect(html).toContain('item.className = "attachment-image"');
    expect(html).toContain('image.addEventListener("error"');
    expect(html).toContain('imagePreviewDialog.addEventListener("click"');
    expect(html).toContain('imagePreviewDialog.addEventListener("close"');
    expect(html).toContain(".image-preview-dialog {");
    expect(html).toContain(".attachment-image {");
  });

  test("所有内联脚本语法有效且 Markdown 不使用 innerHTML", () => {
    const html = renderWebChatPage();
    const scripts = Array.from(
      html.matchAll(/<script>([\s\S]*?)<\/script>/g),
      (match) => match[1]
    );

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
    expect(WEB_CHAT_MARKDOWN_SCRIPT).not.toContain("innerHTML");
    expect(WEB_CHAT_MARKDOWN_SCRIPT).toContain("textContent");
    expect(WEB_CHAT_MARKDOWN_SCRIPT).toContain('protocol === "https:"');
    expect(WEB_CHAT_MARKDOWN_SCRIPT).toContain('protocol === "http:"');
  });
});

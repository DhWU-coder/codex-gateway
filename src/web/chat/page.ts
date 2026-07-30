import {
  Download,
  Ellipsis,
  FileText,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Settings2,
  Square,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide";
import { renderWebChatIcon } from "./icons.js";
import { WEB_CHAT_MARKDOWN_SCRIPT } from "./markdown.js";
import { WEB_CHAT_APP_SCRIPT } from "./script.js";
import { WEB_CHAT_STYLES } from "./styles.js";
import type { WebChatBootstrapData } from "../../web-chat/bootstrap.js";

export interface WebChatPageOptions {
  registrationEnabled?: boolean;
  initiallyAuthenticated?: boolean;
  bootstrapData?: WebChatBootstrapData;
}

const WEB_CHAT_ICONS = {
  add: renderWebChatIcon(Plus),
  attachment: renderWebChatIcon(Paperclip),
  download: renderWebChatIcon(Download),
  file: renderWebChatIcon(FileText, "attachment-file-icon"),
  logout: renderWebChatIcon(LogOut),
  multiSelect: renderWebChatIcon(ListChecks),
  menu: renderWebChatIcon(Menu),
  more: renderWebChatIcon(Ellipsis, "button-icon session-menu-icon"),
  moon: renderWebChatIcon(
    Moon,
    "button-icon theme-icon theme-icon-light"
  ),
  pencil: renderWebChatIcon(Pencil, "button-icon session-rename-icon"),
  send: renderWebChatIcon(Send),
  settings: renderWebChatIcon(Settings2),
  stop: renderWebChatIcon(Square),
  sun: renderWebChatIcon(
    Sun,
    "button-icon theme-icon theme-icon-dark"
  ),
  trash: renderWebChatIcon(Trash2),
  upload: renderWebChatIcon(Upload, "drop-icon"),
  close: renderWebChatIcon(X),
};

export function renderWebChatPage(options: WebChatPageOptions = {}): string {
  const registrationEnabled = options.registrationEnabled === true;
  const initiallyAuthenticated = options.initiallyAuthenticated === true;
  const bootstrapData = options.bootstrapData;
  const bootstrapAttribute =
    initiallyAuthenticated && bootstrapData
      ? ' data-chat-bootstrap="pending"'
      : "";
  const bootstrapScript = bootstrapData
    ? `<script type="application/json" id="webChatBootstrap">${serializeWebChatBootstrap(bootstrapData)}</script>`
    : "";
  return `<!doctype html>
<html lang="zh-CN"${bootstrapAttribute}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Codex Web Chat</title>
  <style>${WEB_CHAT_STYLES}</style>
</head>
<body>
  <section class="login-view" id="loginView"${initiallyAuthenticated ? " hidden" : ""}>
    <div class="login-panel">
      <div class="brand">
        <span class="brand-mark">CG</span>
        <h1>Codex Web Chat</h1>
      </div>
      ${
        registrationEnabled
          ? `<div class="auth-tabs" role="tablist" aria-label="账户认证">
        <button class="auth-tab active" id="authLoginTab" type="button" role="tab" aria-selected="true" aria-controls="loginForm">登录</button>
        <button class="auth-tab" id="authRegisterTab" type="button" role="tab" aria-selected="false" aria-controls="registerForm">注册</button>
      </div>`
          : ""
      }
      <form id="loginForm">
        <label class="field">用户名
          <input class="control" id="usernameInput" name="username" autocomplete="username" required>
        </label>
        <label class="field">密码
          <input class="control" id="passwordInput" name="password" type="password" autocomplete="current-password" required>
        </label>
        <button class="primary-button" id="loginButton" type="submit">登录</button>
        <p class="form-error" id="loginError" aria-live="polite"></p>
      </form>
      ${
        registrationEnabled
          ? `<form id="registerForm" hidden>
        <label class="field">用户名
          <input class="control" id="registerUsernameInput" name="username" autocomplete="username" maxlength="64" required>
        </label>
        <label class="field">密码
          <input class="control" id="registerPasswordInput" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required>
        </label>
        <label class="field">确认密码
          <input class="control" id="registerConfirmPasswordInput" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="256" required>
        </label>
        <button class="primary-button" id="registerButton" type="submit">创建账户</button>
        <p class="form-error" id="registerError" aria-live="polite"></p>
      </form>`
          : ""
      }
    </div>
  </section>

  <div class="chat-app" id="chatApp"${initiallyAuthenticated ? "" : " hidden"}>
    <aside class="sidebar" id="sessionSidebar">
      <div class="sidebar-head">
        <div class="brand">
          <span class="brand-mark">CG</span>
          <h1>Codex</h1>
        </div>
        <button class="primary-button new-session" id="newSessionButton" type="button">${WEB_CHAT_ICONS.add}<span>新对话</span></button>
        <div class="session-selection-toolbar" id="sessionSelectionToolbar">
          <button class="action-button session-selection-button" id="sessionSelectionButton" type="button">
            ${WEB_CHAT_ICONS.multiSelect}
            <span class="button-label">选择</span>
          </button>
          <div class="session-selection-actions" id="sessionSelectionActions" hidden>
            <label class="session-select-all">
              <input id="sessionSelectAll" type="checkbox">
              <span>全选</span>
            </label>
            <span class="session-selection-count" id="sessionSelectionCount">已选 0 项</span>
            <button class="session-selection-delete" id="sessionBulkDelete" type="button">${WEB_CHAT_ICONS.trash}<span>删除</span></button>
            <button class="session-selection-cancel" id="sessionSelectionCancel" type="button">取消</button>
          </div>
        </div>
      </div>
      <nav class="session-list" id="sessionList" aria-label="对话列表"></nav>
      <div class="sidebar-foot">
        <div class="sidebar-user">
          <span class="user-name" id="currentUserName"></span>
        </div>
        <div class="sidebar-actions">
          <button class="action-button sidebar-action tooltip-button" id="accountButton" type="button" title="设置" aria-label="设置" data-tooltip="设置">
            ${WEB_CHAT_ICONS.settings}
            <span class="button-label">设置</span>
          </button>
          <button class="action-button sidebar-action tooltip-button" id="themeButton" type="button" title="切换到深色主题" aria-label="切换到深色主题" data-tooltip="切换到深色主题">
            ${WEB_CHAT_ICONS.moon}
            ${WEB_CHAT_ICONS.sun}
            <span class="button-label">主题</span>
          </button>
          <button class="action-button sidebar-action tooltip-button" id="logoutButton" type="button" title="退出登录" aria-label="退出登录" data-tooltip="退出登录">
            ${WEB_CHAT_ICONS.logout}
            <span class="button-label">退出</span>
          </button>
        </div>
      </div>
    </aside>
    <div class="context-menu" id="sessionContextMenu" role="menu" hidden>
      <button class="context-menu-item" id="sessionContextRename" type="button" role="menuitem">
        ${WEB_CHAT_ICONS.pencil}
        <span class="button-label">重命名</span>
      </button>
      <button class="context-menu-item danger-action" id="sessionContextDelete" type="button" role="menuitem">
        ${WEB_CHAT_ICONS.trash}
        <span class="button-label">删除</span>
      </button>
    </div>
    <template id="sessionMoreIconTemplate">${WEB_CHAT_ICONS.more}</template>
    <template id="fileIconTemplate">${WEB_CHAT_ICONS.file}</template>
    <template id="downloadIconTemplate">${WEB_CHAT_ICONS.download}</template>
    <button class="drawer-backdrop" id="drawerBackdrop" type="button" aria-label="关闭对话列表"></button>

    <main class="workspace" id="chatWorkspace">
      <div class="file-drop-overlay" id="fileDropOverlay" role="status" aria-live="polite" hidden>
        <div class="file-drop-message">
          ${WEB_CHAT_ICONS.upload}
          <strong>松开以添加文件</strong>
        </div>
      </div>
      <header class="chat-header">
        <button class="icon-button mobile-only" id="mobileMenuButton" type="button" title="对话列表" aria-label="对话列表">${WEB_CHAT_ICONS.menu}</button>
        <div class="title-wrap">
          <input class="title-input" id="sessionTitleInput" aria-label="对话标题" maxlength="100">
        </div>
      </header>

      <section class="message-list" id="messageList" aria-live="polite"></section>

      <footer class="composer-shell">
        <button class="latest-activity" id="latestActivityBar" type="button" hidden>
          <span class="activity-spinner" aria-hidden="true"></span>
          <span class="latest-activity-text" id="latestActivityText"></span>
        </button>
        <div class="pending-files" id="pendingFiles"></div>
        <div class="selected-references" id="selectedReferences"></div>
        <div class="composer-stack">
          <div class="composer-popover palette" id="commandPalette" role="listbox" aria-label="命令" hidden></div>
          <div class="composer-popover palette" id="referencePalette" role="listbox" aria-label="引用" hidden></div>
          <div class="composer-popover runtime-menu" id="runtimeMenu" role="menu" aria-label="模型配置" hidden></div>
          <div class="composer">
            <div class="composer-editor">
              <textarea id="composerInput" rows="1" maxlength="100000" placeholder="输入消息，/ 使用命令，@ 引用上下文" aria-label="消息"></textarea>
            </div>
            <div class="composer-toolbar">
              <div class="composer-toolbar-start">
                <input id="fileInput" type="file" multiple hidden>
                <button class="icon-button composer-add" id="fileButton" type="button" title="添加上下文" aria-label="添加上下文">${WEB_CHAT_ICONS.add}</button>
              </div>
              <div class="composer-actions">
                <button class="runtime-summary" id="runtimeSummaryButton" type="button" aria-haspopup="menu" aria-expanded="false">
                  ${WEB_CHAT_ICONS.settings}
                  <span id="runtimeSummaryText">读取配置</span>
                </button>
                <button class="danger-button composer-submit" id="stopButton" type="button" title="停止" aria-label="停止" hidden>${WEB_CHAT_ICONS.stop}</button>
                <button class="primary-button composer-submit" id="sendButton" type="button" title="发送" aria-label="发送">${WEB_CHAT_ICONS.send}</button>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </main>
  </div>

  <dialog class="account-dialog settings-dialog" id="accountDialog">
    <div class="settings-dialog-shell">
      <header class="settings-dialog-header">
        <div>
          <h2>设置</h2>
          <p>管理当前账户的默认配置与登录密码</p>
        </div>
        <button class="secondary-button" id="accountDialogClose" type="button">关闭</button>
      </header>
      <div class="settings-tabs" role="tablist" aria-label="账户设置">
        <button class="settings-tab active" id="accountSettingsModelTab" type="button" role="tab" aria-selected="true" aria-controls="accountModelPanel">模型配置</button>
        <button class="settings-tab" id="accountSettingsPasswordTab" type="button" role="tab" aria-selected="false" aria-controls="accountPasswordPanel">修改密码</button>
      </div>
      <section class="settings-panel" id="accountModelPanel" role="tabpanel" aria-labelledby="accountSettingsModelTab">
        <form id="accountModelForm">
          <div class="settings-form-grid">
            <label class="field settings-field settings-field-wide">默认模型
              <input class="control" id="accountModelInput" list="accountModelOptions" autocomplete="off" placeholder="留空以继承全局配置">
              <datalist id="accountModelOptions">
                <option value="">继承全局</option>
              </datalist>
              <span class="field-help" id="accountModelEffective"></span>
            </label>
            <label class="field settings-field">默认推理强度
              <select class="control" id="accountEffortSelect">
                <option value="">继承全局</option>
              </select>
              <span class="field-help" id="accountEffortEffective"></span>
            </label>
            <label class="field settings-field">默认速度
              <select class="control" id="accountSpeedSelect">
                <option value="">继承全局</option>
                <option value="false">标准</option>
                <option value="true">Fast</option>
              </select>
              <span class="field-help" id="accountSpeedEffective"></span>
            </label>
          </div>
          <p class="form-error" id="accountModelError" aria-live="polite"></p>
          <div class="dialog-actions">
            <button class="primary-button" id="accountModelSave" type="submit">保存模型配置</button>
          </div>
        </form>
      </section>
      <section class="settings-panel" id="accountPasswordPanel" role="tabpanel" aria-labelledby="accountSettingsPasswordTab" hidden>
        <form id="passwordForm">
          <label class="field">当前密码
            <input class="control" id="currentPasswordInput" type="password" autocomplete="current-password" maxlength="256" required>
          </label>
          <label class="field">新密码
            <input class="control" id="newPasswordInput" type="password" autocomplete="new-password" minlength="8" maxlength="256" required>
          </label>
          <p class="form-error" id="passwordError" aria-live="polite"></p>
          <div class="dialog-actions">
            <button class="primary-button" id="passwordSave" type="submit">修改密码</button>
          </div>
        </form>
      </section>
    </div>
  </dialog>
  <dialog class="image-preview-dialog" id="imagePreviewDialog" aria-labelledby="imagePreviewName">
    <div class="image-preview-shell">
      <header class="image-preview-header">
        <h2 id="imagePreviewName">图片预览</h2>
        <div class="image-preview-actions">
          <a class="icon-button tooltip-button tooltip-below" id="imagePreviewDownload" href="#" title="下载图片" aria-label="下载图片" data-tooltip="下载图片">
            ${WEB_CHAT_ICONS.download}
          </a>
          <button class="icon-button tooltip-button tooltip-below" id="imagePreviewClose" type="button" title="关闭图片预览" aria-label="关闭图片预览" data-tooltip="关闭">
            ${WEB_CHAT_ICONS.close}
          </button>
        </div>
      </header>
      <div class="image-preview-stage">
        <img id="imagePreviewImage" alt="">
      </div>
    </div>
  </dialog>
  <div class="error-toast" id="errorToast" role="alert" hidden></div>

  ${bootstrapScript}
  <script>${WEB_CHAT_MARKDOWN_SCRIPT}</script>
  <script>${WEB_CHAT_APP_SCRIPT}</script>
</body>
</html>`;
}

function serializeWebChatBootstrap(data: WebChatBootstrapData): string {
  return JSON.stringify(data)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

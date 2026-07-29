export const WEB_CHAT_STYLES = `
:root {
  color-scheme: light;
  --bg: #f5f7fa;
  --surface: #ffffff;
  --surface-2: #eef2f5;
  --surface-3: #e4e9ee;
  --text: #17202a;
  --muted: #66717d;
  --line: #d7dee5;
  --line-strong: #b9c4cf;
  --accent: #087f6a;
  --accent-soft: #d8f2eb;
  --danger: #c53f3f;
  --danger-soft: #fde6e5;
  --focus: #2677d9;
  --code: #18212b;
  --code-text: #e8edf2;
  --composer-submit-bg: #17202a;
  --composer-submit-fg: #ffffff;
  --shadow: 0 14px 36px rgba(28, 39, 51, 0.14);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #101417;
  --surface: #171c21;
  --surface-2: #1f252b;
  --surface-3: #293139;
  --text: #edf1f4;
  --muted: #9ca7b1;
  --line: #313a43;
  --line-strong: #46515c;
  --accent: #34b99f;
  --accent-soft: #173c35;
  --danger: #ff7770;
  --danger-soft: #422523;
  --focus: #6aaeff;
  --code: #0c1014;
  --code-text: #e9eef2;
  --composer-submit-bg: #f4f6f8;
  --composer-submit-fg: #101417;
  --shadow: 0 16px 42px rgba(0, 0, 0, 0.36);
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; }
body {
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
button, input, textarea, select { font: inherit; color: inherit; letter-spacing: 0; }
button, input, textarea, select { outline: none; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 30%, transparent);
  border-color: var(--focus);
}
button { cursor: pointer; }
[hidden] { display: none !important; }
:root[data-chat-bootstrap="pending"] body { visibility: hidden; }
.login-view {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
}
.login-panel {
  width: min(400px, 100%);
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 6px;
  background: var(--text);
  color: var(--surface);
  font-weight: 800;
}
.brand h1 { margin: 0; font-size: 20px; line-height: 1.2; }
.login-panel .brand { margin-bottom: 28px; }
.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin: -8px 0 22px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-2);
}
.auth-tab {
  min-height: 36px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
}
.auth-tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(28, 39, 51, 0.12);
}
.field { display: grid; gap: 7px; margin-bottom: 16px; color: var(--muted); font-weight: 600; }
.control {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
}
.primary-button, .secondary-button, .danger-button {
  min-height: 40px;
  padding: 0 15px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  font-weight: 700;
}
.primary-button { border-color: var(--accent); background: var(--accent); color: #fff; }
.danger-button { border-color: var(--danger); color: var(--danger); background: var(--surface); }
.login-panel .primary-button { width: 100%; margin-top: 4px; }
.form-error { min-height: 22px; margin: 12px 0 0; color: var(--danger); }
.chat-app { display: grid; grid-template-columns: 280px minmax(0, 1fr); width: 100%; height: 100%; }
.sidebar {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--surface);
}
.sidebar-head { padding: 18px 16px 14px; border-bottom: 1px solid var(--line); }
.sidebar-head .brand { margin-bottom: 16px; }
.new-session { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.new-session .button-icon { margin: 0; }
.session-selection-toolbar { margin-top: 8px; }
.session-selection-button { width: 100%; min-height: 34px; color: var(--muted); }
.session-selection-actions {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 5px;
  align-items: center;
}
.session-select-all {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.session-select-all input,
.session-select-box {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent);
}
.session-selection-count {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-selection-delete,
.session-selection-cancel {
  min-height: 32px;
  padding: 0 7px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: var(--surface);
  font-weight: 700;
}
.session-selection-delete {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-color: var(--danger);
  color: var(--danger);
}
.session-selection-delete .button-icon { width: 15px; height: 15px; }
.session-selection-delete:hover { background: var(--danger-soft); }
.session-selection-delete:disabled,
.session-selection-cancel:disabled { cursor: not-allowed; opacity: .45; }
.session-list { min-height: 0; flex: 1; overflow-y: auto; padding: 10px; }
.session-item {
  width: 100%;
  min-height: 58px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
  margin-bottom: 4px;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
}
.session-item:hover { background: var(--surface-2); }
.session-item.active { border-color: var(--accent); background: var(--accent-soft); }
.session-item.selecting { grid-template-columns: auto minmax(0, 1fr); }
.session-item.selecting.selected { border-color: var(--accent); background: var(--accent-soft); }
.session-select-box { margin-left: 4px; }
.session-open {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
  padding: 5px 6px;
  border: 0;
  background: transparent;
  text-align: left;
}
.session-title { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.session-time { color: var(--muted); font-size: 12px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.status-dot.running { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.session-more {
  display: none;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
}
.session-more:hover { background: var(--surface-3); }
.session-rename-input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 8px;
  border: 1px solid var(--focus);
  border-radius: 5px;
  background: var(--surface);
}
.context-menu {
  position: fixed;
  z-index: 90;
  min-width: 156px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.context-menu-item {
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  text-align: left;
}
.context-menu-item:hover,
.context-menu-item:focus-visible { background: var(--surface-2); }
.context-menu-item:disabled { cursor: not-allowed; opacity: .45; }
.sidebar-foot {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid var(--line);
}
.sidebar-user { display: flex; min-width: 0; min-height: 24px; align-items: center; }
.user-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.sidebar-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.icon-button {
  display: inline-grid;
  width: 40px;
  height: 40px;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
}
.icon-button.small { width: 30px; height: 30px; }
.action-button {
  position: relative;
  display: inline-flex;
  height: 38px;
  min-width: 38px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-weight: 700;
  white-space: nowrap;
}
.action-button:hover { background: var(--surface-2); }
.action-button:disabled { cursor: not-allowed; opacity: .45; }
.button-icon { display: block; width: 18px; height: 18px; flex: 0 0 auto; }
.button-label { display: inline-block; }
.danger-action { border-color: color-mix(in srgb, var(--danger) 65%, var(--line)); color: var(--danger); }
.danger-action:hover { background: var(--danger-soft); }
.theme-icon-dark { display: none; }
:root[data-theme="dark"] .theme-icon-light { display: none; }
:root[data-theme="dark"] .theme-icon-dark { display: block; }
.tooltip-button::after {
  position: absolute;
  z-index: 110;
  left: 50%;
  bottom: calc(100% + 8px);
  max-width: 180px;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: var(--code);
  color: var(--code-text);
  content: attr(data-tooltip);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 4px);
  transition: opacity .15s ease, transform .15s ease;
  white-space: nowrap;
}
.tooltip-button:hover::after,
.tooltip-button:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }
.tooltip-below::after {
  top: calc(100% + 8px);
  right: 0;
  bottom: auto;
  left: auto;
  transform: translateY(-4px);
}
.tooltip-below:hover::after,
.tooltip-below:focus-visible::after { transform: translateY(0); }
.workspace { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
.file-drop-overlay {
  position: absolute;
  z-index: 40;
  inset: 10px;
  display: grid;
  place-items: center;
  pointer-events: none;
  border: 2px dashed var(--accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  color: var(--accent);
}
.file-drop-message { display: grid; justify-items: center; gap: 10px; font-size: 16px; }
.drop-icon { width: 30px; height: 30px; }
.chat-header {
  min-height: 70px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.mobile-only { display: none; }
.title-wrap { min-width: 140px; flex: 1; }
.title-input {
  width: 100%;
  border: 0;
  background: transparent;
  font-size: 16px;
  font-weight: 750;
}
.message-list {
  min-height: 0;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 30px max(24px, calc((100% - 880px) / 2)) 44px;
}
.empty-chat { display: grid; min-height: 100%; place-items: center; color: var(--muted); }
.message { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; margin: 0 0 26px; }
.message-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 6px;
  background: var(--surface-3);
  font-size: 12px;
  font-weight: 800;
}
.message.user .message-avatar { background: var(--accent-soft); color: var(--accent); }
.message-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
.message-author { font-weight: 800; }
.message-time { color: var(--muted); font-size: 12px; }
.message-body { min-width: 0; overflow-wrap: anywhere; }
.message-body p { margin: 0 0 10px; white-space: pre-wrap; }
.message-body h1, .message-body h2, .message-body h3, .message-body h4 { margin: 18px 0 8px; font-size: 16px; }
.message-body ul { margin: 8px 0; padding-left: 22px; }
.message-body blockquote { margin: 10px 0; padding: 6px 12px; border-left: 3px solid var(--accent); color: var(--muted); }
.message-body a { color: var(--focus); }
.message-body code { padding: 2px 5px; border-radius: 4px; background: var(--surface-3); }
.code-block { margin: 12px 0; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: var(--code); color: var(--code-text); }
.code-bar { min-height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 4px 7px 4px 12px; border-bottom: 1px solid #3b4650; color: #aeb9c3; font-size: 12px; }
.code-bar .icon-button { border-color: #46515c; background: transparent; color: #dbe2e8; }
.code-block pre { margin: 0; overflow-x: auto; padding: 14px; }
.code-block code { padding: 0; background: transparent; color: inherit; white-space: pre; }
.attachments { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.attachment {
  display: inline-flex;
  max-width: 260px;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.attachment span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.streaming::after { content: ""; display: inline-block; width: 7px; height: 15px; margin-left: 3px; vertical-align: -2px; background: var(--accent); animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.trace-card {
  margin: -12px 0 24px 46px;
  border-left: 1px solid var(--line);
  color: var(--muted);
}
.trace-card > details > summary {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  list-style: none;
  font-weight: 700;
}
.trace-card > details > summary::-webkit-details-marker,
.tool-group > summary::-webkit-details-marker { display: none; }
.trace-card > details > summary::before,
.tool-group > summary::before { content: "›"; transition: transform .15s ease; }
.trace-card details[open] > summary::before { transform: rotate(90deg); }
.trace-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.trace-card.running .trace-status-dot { background: var(--accent); animation: pulse 1.3s ease-in-out infinite; }
.trace-card.failed .trace-status-dot { background: var(--danger); }
@keyframes pulse { 50% { opacity: .35; } }
.trace-body { display: grid; gap: 12px; padding: 4px 10px 14px 25px; }
.trace-message { color: var(--text); }
.trace-message .message-body { opacity: .9; }
.trace-entry-label { margin-bottom: 4px; color: var(--muted); font-size: 12px; font-weight: 700; }
.tool-group {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-2);
}
.tool-group > summary {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  list-style: none;
}
.tool-group-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-group-state { font-size: 12px; }
.tool-activities { display: grid; gap: 7px; padding: 0 10px 10px 28px; }
.tool-activity { padding-top: 7px; border-top: 1px solid var(--line); }
.tool-activity-head { display: flex; justify-content: space-between; gap: 8px; color: var(--text); }
.tool-detail { margin: 7px 0 0; overflow: auto; padding: 9px; border-radius: 5px; background: var(--code); color: var(--code-text); font-size: 12px; white-space: pre-wrap; }
.trace-context { padding: 7px 10px; border: 1px dashed var(--line); border-radius: 6px; }
.composer-shell {
  padding: 10px max(18px, calc((100% - 900px) / 2)) calc(14px + env(safe-area-inset-bottom));
  background: linear-gradient(to bottom, transparent, var(--bg) 16%);
}
.latest-activity {
  min-height: 34px;
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto 7px;
  padding: 5px 11px;
  border: 1px solid var(--line);
  border-radius: 17px;
  background: var(--surface-2);
  color: var(--muted);
  box-shadow: 0 4px 14px rgba(20, 30, 40, .08);
}
.latest-activity-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-spinner {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border: 2px solid var(--line-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.pending-files,
.selected-references { display: flex; min-height: 0; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
.pending-file,
.reference-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 250px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.pending-file span,
.reference-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reference-kind { color: var(--accent); font-size: 11px; font-weight: 800; text-transform: uppercase; }
.composer-stack { position: relative; }
.composer-popover {
  position: absolute;
  z-index: 35;
  right: 0;
  bottom: calc(100% + 8px);
  width: min(620px, 100%);
  max-height: min(440px, calc(100vh - 180px));
  overflow-y: auto;
  padding: 7px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.palette-section { padding: 7px 9px 4px; color: var(--muted); font-size: 12px; font-weight: 800; }
.palette-item,
.runtime-row {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 12px;
  align-items: center;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
}
.palette-item:hover,
.palette-item.selected,
.runtime-row:hover,
.runtime-row.selected { background: var(--surface-2); }
.palette-item:disabled,
.runtime-row:disabled { cursor: not-allowed; opacity: .45; }
.palette-name,
.runtime-row-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 750; }
.palette-description,
.runtime-row-description { grid-column: 1 / -1; color: var(--muted); font-size: 12px; }
.runtime-menu { width: min(430px, 100%); }
.runtime-menu-head { display: flex; min-height: 36px; align-items: center; justify-content: space-between; padding: 2px 8px 7px; color: var(--muted); font-weight: 700; }
.runtime-current { color: var(--muted); }
.composer { display: flex; min-height: 116px; flex-direction: column;
  gap: 10px;
  padding: 16px 16px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 20px;
  background: var(--surface);
  box-shadow: 0 10px 28px rgba(20, 30, 40, .1);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.composer:focus-within {
  border-color: var(--focus);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent), 0 12px 30px rgba(20, 30, 40, .12);
}
.composer-editor { display: flex; min-width: 0; flex: 1; }
.composer textarea {
  width: 100%;
  min-height: 48px;
  max-height: 180px;
  resize: none;
  padding: 0;
  border: 0;
  background: transparent;
  line-height: 1.55;
}
.composer textarea:focus-visible {
  border-color: transparent;
  box-shadow: none;
}
.composer-toolbar { display: flex; min-height: 44px; align-items: center; justify-content: space-between;
  gap: 10px;
}
.composer-toolbar-start { display: flex; min-width: 0; align-items: center; }
.composer-add { border-color: transparent; background: transparent; }
.composer-add:hover { background: var(--surface-2); }
.composer-actions { display: flex; align-items: center; gap: 6px; }
.runtime-summary {
  min-height: 38px;
  display: inline-flex;
  max-width: 240px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
}
.runtime-summary:hover { background: var(--surface-2); color: var(--text); }
.runtime-summary span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-submit { width: 44px; height: 44px; min-height: 44px; display: grid; place-items: center; flex: 0 0 auto; padding: 0; border-radius: 50%; }
.composer-submit .button-icon { margin: 0; }
#sendButton.composer-submit { border-color: var(--composer-submit-bg); background: var(--composer-submit-bg); color: var(--composer-submit-fg); }
#sendButton.composer-submit:hover { filter: brightness(.92); }
#sendButton.composer-submit:disabled { cursor: not-allowed; opacity: .42; }
#stopButton.composer-submit { background: var(--danger-soft); }
.error-toast {
  position: fixed;
  z-index: 100;
  right: 18px;
  bottom: 18px;
  max-width: min(420px, calc(100vw - 36px));
  padding: 11px 14px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  background: var(--danger-soft);
  color: var(--danger);
  box-shadow: var(--shadow);
}
.drawer-backdrop { display: none; }
.account-dialog {
  width: min(620px, calc(100% - 28px));
  max-height: min(720px, calc(100dvh - 28px));
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}
.account-dialog::backdrop { background: rgba(0, 0, 0, .48); }
.settings-dialog-shell { display: grid; grid-template-rows: auto auto minmax(0, 1fr); max-height: inherit; }
.settings-dialog-header {
  display: flex;
  min-height: 78px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}
.settings-dialog-header h2 { margin: 0; font-size: 18px; }
.settings-dialog-header p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
.settings-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 20px 0;
  border-bottom: 1px solid var(--line);
}
.settings-tab {
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
}
.settings-tab.active { border-bottom-color: var(--accent); color: var(--text); }
.settings-panel { min-height: 0; overflow-y: auto; padding: 20px; }
.settings-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}
.settings-field-wide { grid-column: 1 / -1; }
.field-help { min-height: 18px; color: var(--muted); font-size: 12px; font-weight: 500; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 760px) {
  .chat-app { grid-template-columns: minmax(0, 1fr); }
  .mobile-only { display: inline-grid; }
  .sidebar { position: fixed; z-index: 50; inset: 0 auto 0 0; width: min(310px, 88vw); transform: translateX(-102%); transition: transform .2s ease; box-shadow: var(--shadow); }
  .sidebar.open { transform: translateX(0); }
  .drawer-backdrop { position: fixed; z-index: 45; inset: 0; display: none; background: rgba(0, 0, 0, .45); }
  .drawer-backdrop.open { display: block; }
  .chat-header { min-height: 60px; gap: 6px; padding: 8px 10px; }
  .title-wrap { min-width: 0; }
  .chat-header .icon-button { width: 36px; height: 36px; min-width: 36px; }
  .session-more { display: grid; }
  .sidebar-action .button-label { display: none; }
  .message-list { padding: 22px 14px 34px; }
  .message { grid-template-columns: 30px minmax(0, 1fr); gap: 9px; margin-bottom: 22px; }
  .message-avatar { width: 30px; height: 30px; }
  .trace-card { margin-left: 39px; }
  .trace-body { padding-left: 14px; }
  .composer-shell { padding: 8px 8px calc(8px + env(safe-area-inset-bottom)); }
  .composer { min-height: 104px; padding: 12px; border-radius: 16px; }
  .composer textarea { min-height: 42px; }
  .composer-toolbar { gap: 6px; }
  .composer-actions { gap: 4px; }
  .runtime-summary { max-width: min(190px, 52vw); padding: 0 8px; }
  .runtime-summary .button-icon { display: none; }
  .composer-popover { width: 100%; max-height: min(380px, calc(100vh - 160px)); }
  .latest-activity { width: 100%; justify-content: flex-start; }
  .account-dialog { width: calc(100% - 18px); max-height: calc(100dvh - 18px); }
  .settings-dialog-header { padding: 14px; }
  .settings-dialog-header p { display: none; }
  .settings-tabs { padding: 8px 14px 0; }
  .settings-panel { padding: 16px 14px; }
  .settings-form-grid { grid-template-columns: minmax(0, 1fr); }
  .settings-field-wide { grid-column: auto; }
}
`;

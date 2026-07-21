export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Gateway</title>
  <script id="themeBootstrap">
    (() => {
      const key = "codex-gateway-theme";
      let theme;
      try {
        const stored = localStorage.getItem(key);
        if (stored === "light" || stored === "dark") theme = stored;
      } catch {}
      if (!theme) {
        const prefersDark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
        theme = prefersDark ? "dark" : "light";
      }
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    })();
  </script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f8;
      --panel: #ffffff;
      --panel-2: #f9fafb;
      --field: #fbfcfd;
      --text: #18212a;
      --muted: #697583;
      --line: #d8dee5;
      --line-strong: #bfc8d1;
      --accent: #167c6b;
      --accent-strong: #0f6256;
      --accent-soft: #e2f4ef;
      --warning: #9b6418;
      --warning-soft: #fff4dc;
      --danger: #b64040;
      --danger-soft: #fae9e9;
      --code-bg: #111820;
      --code-text: #dce5ed;
      --shadow: 0 12px 28px rgba(24, 33, 42, 0.08);
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #101214;
      --panel: #171a1f;
      --panel-2: #20242a;
      --field: #121519;
      --text: #edf1f5;
      --muted: #9aa6b5;
      --line: #303640;
      --line-strong: #46505c;
      --accent: #22a991;
      --accent-strong: #43c7b0;
      --accent-soft: #183931;
      --warning: #e2a34d;
      --warning-soft: #392d1b;
      --danger: #ff8179;
      --danger-soft: #3f2222;
      --code-bg: #0b0f12;
      --code-text: #dce5ed;
      --shadow: 0 14px 30px rgba(0, 0, 0, 0.34);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { min-width: 320px; min-height: 100%; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    body.drawer-open { overflow: hidden; }
    button, input, select { font: inherit; letter-spacing: 0; }
    button, .button-link { min-height: 36px; border: 1px solid var(--line-strong); border-radius: 6px; background: transparent; color: var(--text); padding: 7px 12px; font-weight: 620; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    button:hover, .button-link:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
    button:disabled { cursor: not-allowed; opacity: .5; }
    button.primary { border-color: var(--accent); background: var(--accent); color: #ffffff; }
    button.primary:hover { background: var(--accent-strong); }
    button.danger { border-color: var(--danger); color: var(--danger); }
    button.icon-button { width: 38px; height: 38px; min-height: 38px; padding: 0; font-size: 18px; }
    input, select { width: 100%; height: 38px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--text); padding: 8px 10px; }
    input:disabled, input:read-only, select:disabled { color: var(--muted); opacity: 1; }
    input[type="checkbox"] { width: 16px; height: 16px; padding: 0; accent-color: var(--accent); }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 18px; }
    h2 { font-size: 15px; }
    h3 { font-size: 13px; }
    code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
    .app-header { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 24px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 6px; background: var(--text); color: var(--panel); font-size: 12px; font-weight: 800; }
    .header-actions, .button-row, .section-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .service-indicator { display: flex; align-items: center; gap: 7px; color: var(--muted); white-space: nowrap; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
    .status-dot.online { background: var(--accent); }
    main { width: 100%; padding: 18px 28px 34px; }
    .tabs { display: flex; gap: 8px; margin-bottom: 14px; overflow-x: auto; }
    .tab { min-width: 88px; color: var(--muted); white-space: nowrap; }
    .tab.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
    .status-banner { min-height: 0; margin-bottom: 12px; padding: 10px 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent-soft); color: var(--accent-strong); }
    .status-banner.error { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
    .panel { display: none; }
    .panel.active { display: grid; gap: 16px; }
    .surface { min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: var(--shadow); }
    .surface-head { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--line); }
    .surface-body { min-width: 0; padding: 16px; }
    .source { color: var(--muted); font-size: 12px; }
    .empty { padding: 14px; border: 1px dashed var(--line); border-radius: 6px; color: var(--muted); }
    .metric-grid { display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--panel); }
    .metric { min-width: 0; padding: 13px 14px; border-right: 1px solid var(--line); }
    .metric:last-child { border-right: 0; }
    .metric-label { margin-bottom: 4px; color: var(--muted); font-size: 11px; }
    .metric-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 700; }
    .overview-grid { display: grid; grid-template-columns: minmax(300px, .85fr) minmax(0, 1.4fr); gap: 16px; align-items: start; }
    .list { display: grid; gap: 8px; }
    .list-row { min-width: 0; display: grid; gap: 4px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-2); }
    button.list-row { width: 100%; height: auto; text-align: left; align-items: stretch; justify-content: flex-start; }
    button.list-row.active { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    .row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
    .row-title, .row-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-title { font-weight: 680; }
    .row-meta { color: var(--muted); font-size: 12px; }
    .badge { display: inline-flex; align-items: center; min-height: 24px; max-width: 100%; padding: 0 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel-2); color: var(--muted); font-size: 11px; font-weight: 680; white-space: nowrap; }
    .badge.ok, .badge.completed, .badge.connected { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
    .badge.busy, .badge.queued, .badge.model_processing, .badge.replying { border-color: var(--warning); background: var(--warning-soft); color: var(--warning); }
    .badge.error, .badge.failed { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
    .reload-state { padding: 12px; border-top: 1px solid var(--line); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    .usage-filter { display: grid; grid-template-columns: minmax(420px, 1.4fr) 150px 150px 150px 130px auto; gap: 10px; align-items: end; }
    .usage-pending { padding: 11px 14px; border: 1px solid var(--warning); border-radius: 6px; background: var(--warning-soft); color: var(--warning); }
    .field { display: grid; gap: 6px; min-width: 0; color: var(--muted); font-size: 12px; }
    .segmented { display: flex; gap: 6px; flex-wrap: wrap; }
    .segmented button { min-width: 62px; }
    .segmented button.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
    .usage-main { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, .8fr); gap: 16px; }
    .chart-frame { min-width: 0; height: 330px; overflow-x: auto; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-2); }
    #usageChart { display: block; width: 100%; height: 100%; }
    .usage-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .usage-group-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .usage-group-row:last-child { border-bottom: 0; }
    .bar { grid-column: 1 / -1; height: 5px; overflow: hidden; border-radius: 3px; background: var(--line); }
    .bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; min-width: 760px; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th { background: var(--panel-2); color: var(--muted); font-size: 11px; }
    tr:last-child td { border-bottom: 0; }
    .config-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .definition-list { display: grid; grid-template-columns: minmax(130px, .5fr) minmax(0, 1fr); gap: 0; }
    .definition-list dt, .definition-list dd { margin: 0; padding: 9px 0; border-bottom: 1px solid var(--line); }
    .definition-list dt { color: var(--muted); }
    .definition-list dd { overflow-wrap: anywhere; }
    .definition-list dd .model-combo { max-width: 520px; }
    .definition-control { max-width: 520px; display: grid; gap: 5px; }
    .runtime-setting-value { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--muted); word-break: keep-all; overflow-wrap: anywhere; }
    .runtime-fields { display: contents; }
    .field-note { min-height: 17px; color: var(--muted); font-size: 11px; }
    .field-note.warning { color: var(--warning); }
    .model-combo { position: relative; min-width: 0; color: var(--text); }
    .model-combo input { padding-right: 42px; }
    .model-combo-toggle { position: absolute; top: 1px; right: 1px; width: 38px; height: 36px; min-height: 36px; padding: 0; border: 0; border-left: 1px solid var(--line); border-radius: 0 5px 5px 0; }
    .model-combo-toggle::after { width: 8px; height: 8px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; content: ""; transform: translateY(-2px) rotate(45deg); }
    .model-combo.open .model-combo-toggle::after { transform: translateY(2px) rotate(225deg); }
    .model-combo-menu { position: absolute; z-index: 60; top: calc(100% + 4px); left: 0; right: 0; display: none; max-height: 300px; overflow: auto; padding: 5px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--panel); box-shadow: var(--shadow); }
    .model-combo.open .model-combo-menu { display: grid; gap: 3px; }
    .model-combo-option { width: 100%; height: auto; min-height: 44px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; justify-items: start; padding: 7px 8px; border-color: transparent; text-align: left; }
    .model-combo-option.active { border-color: var(--accent); background: var(--accent-soft); }
    .model-combo-option strong, .model-combo-option code, .model-combo-option .source { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-combo-option code, .model-combo-option .source { grid-column: 1 / -1; }
    .model-combo-empty { padding: 10px; color: var(--muted); font-size: 12px; }
    .channels-grid { display: grid; grid-template-columns: minmax(270px, 360px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .channel-card { width: 100%; height: auto; display: grid; gap: 8px; padding: 12px; text-align: left; }
    .channel-card.active { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    .metric-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .metric-chip { min-height: 23px; display: inline-flex; align-items: center; padding: 0 7px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font-size: 11px; }
    .account-list { display: grid; gap: 12px; }
    .account-card { display: grid; gap: 12px; min-width: 0; padding: 14px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel-2); }
    .account-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .account-title { display: grid; gap: 4px; min-width: 0; }
    .account-title strong, .account-title .source { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 7px; }
    .account-fields { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 10px; }
    .secret-field { position: relative; }
    .secret-field input { padding-right: 68px; }
    .secret-toggle { position: absolute; top: 1px; right: 1px; width: 64px; height: 36px; min-height: 36px; border: 0; border-left: 1px solid var(--line); border-radius: 0 5px 5px 0; }
    .flags { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .check-row { display: inline-flex; align-items: center; gap: 7px; color: var(--text); font-size: 12px; }
    .session-list { display: grid; gap: 8px; }
    .session-row { display: grid; grid-template-columns: minmax(80px, .7fr) minmax(0, 1.7fr) minmax(100px, .7fr) minmax(72px, .55fr) 74px; gap: 8px; align-items: center; min-width: 0; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); }
    .session-cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .connection-result { min-height: 18px; color: var(--muted); font-size: 12px; white-space: pre-wrap; }
    .connection-result.ok { color: var(--accent-strong); }
    .connection-result.error { color: var(--danger); }
    .logs-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 150px auto auto auto; gap: 8px; align-items: center; }
    .log-output { height: min(620px, calc(100vh - 250px)); min-height: 360px; margin: 0; overflow: auto; padding: 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--code-bg); color: var(--code-text); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
    .drawer { position: fixed; inset: 0; z-index: 80; display: flex; justify-content: flex-end; }
    .drawer-backdrop { position: absolute; inset: 0; height: auto; border: 0; border-radius: 0; background: rgba(0, 0, 0, .5); }
    .drawer-backdrop:hover { background: rgba(0, 0, 0, .5); }
    .drawer-panel { position: relative; z-index: 1; width: 86vw; height: 100vh; min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); border-left: 1px solid var(--line); background: var(--panel); box-shadow: -18px 0 48px rgba(0, 0, 0, .32); }
    .drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--line); }
    .drawer-title { min-width: 0; display: grid; gap: 4px; }
    .drawer-title h2, .drawer-title .source { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .drawer-tabs { display: flex; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel-2); }
    .drawer-tab.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
    .drawer-body { min-height: 0; overflow: auto; padding: 16px; }
    .drawer-view { display: none; }
    .drawer-view.active { display: block; }
    .message-thread { display: grid; gap: 12px; }
    .message-turn { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; }
    .turn-meta { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; color: var(--muted); font-size: 11px; }
    .bubble { display: grid; gap: 5px; min-width: 0; padding: 9px 11px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); white-space: pre-wrap; overflow-wrap: anywhere; }
    .bubble.user { max-width: min(760px, 100%); border-color: var(--accent); background: var(--accent-soft); }
    .bubble.error { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
    .bubble-label { color: var(--muted); font-size: 11px; font-weight: 700; }
    .attachment-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .attachment { display: inline-flex; align-items: center; max-width: 360px; min-height: 23px; padding: 0 7px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    details.event { border: 1px solid var(--line); border-radius: 6px; background: var(--panel-2); }
    details.event summary { cursor: pointer; padding: 8px 10px; color: var(--muted); font-size: 12px; font-weight: 650; }
    details.event pre { max-height: 240px; margin: 0; overflow: auto; padding: 10px; border-top: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
    details.event.stderr-error { border-color: var(--danger); }
    details.event.stderr-error summary { color: var(--danger); }
    details.event.stderr-warning { border-color: var(--warning); }
    details.event.stderr-warning summary { color: var(--warning); }
    details.event.stderr-log summary { color: var(--muted); }
    .archive-toolbar { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 12px; flex-wrap: wrap; }
    .archive-grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 12px; min-height: 480px; }
    .archive-list { display: grid; align-content: start; gap: 8px; }
    .archive-detail { min-width: 0; padding-left: 12px; border-left: 1px solid var(--line); }
    .summary-box { margin-bottom: 12px; padding: 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent-soft); }
    .summary-box p { margin: 6px 0 0; }
    @media (max-width: 1100px) {
      .metric-grid { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
      .metric:nth-child(3) { border-right: 0; }
      .metric:nth-child(-n+3) { border-bottom: 1px solid var(--line); }
      .usage-filter { grid-template-columns: 1fr 1fr 1fr; }
      .account-fields { grid-template-columns: repeat(2, minmax(150px, 1fr)); }
    }
    @media (max-width: 820px) {
      .app-header { padding: 0 14px; }
      main { padding: 14px; }
      .service-indicator { display: none; }
      .overview-grid, .usage-main, .usage-groups, .config-grid, .channels-grid, .archive-grid { grid-template-columns: 1fr; }
      .archive-detail { padding-left: 0; border-left: 0; border-top: 1px solid var(--line); padding-top: 12px; }
      .drawer-panel { width: 100vw; }
      .logs-toolbar { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 560px) {
      .brand-mark { display: none; }
      .header-actions #refreshButton { display: none; }
      .metric-grid { grid-template-columns: 1fr 1fr; }
      .metric, .metric:nth-child(3) { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
      .metric:nth-child(even) { border-right: 0; }
      .metric:nth-last-child(-n+2) { border-bottom: 0; }
      .usage-filter, .account-fields, .logs-toolbar { grid-template-columns: 1fr; }
      .session-row { grid-template-columns: minmax(0, 1fr) auto; }
      .session-row .session-cell:nth-child(1), .session-row .session-cell:nth-child(4) { display: none; }
      .account-head { align-items: stretch; flex-direction: column; }
      .account-actions { justify-content: flex-start; }
      .drawer-head { align-items: flex-start; }
      .archive-toolbar { justify-content: stretch; }
      .archive-toolbar button { flex: 1 1 auto; }
    }
  </style>
</head>
<body>
  <header class="app-header">
    <div class="brand"><div class="brand-mark">CG</div><h1>Codex Gateway</h1></div>
    <div class="header-actions">
      <div class="service-indicator"><span class="status-dot" id="stateDot"></span><span id="serviceState">加载中</span></div>
      <button class="icon-button" id="themeToggle" type="button" aria-label="切换到深色主题" title="切换到深色主题"><span id="themeIcon" aria-hidden="true">☾</span></button>
      <button id="refreshButton" type="button">刷新</button>
      <span class="source">127.0.0.1</span>
    </div>
  </header>
  <main>
    <nav class="tabs" aria-label="管理后台模块">
      <button class="tab active" data-tab="overview" type="button">概览</button>
      <button class="tab" data-tab="usage" type="button">用量</button>
      <button class="tab" data-tab="config" type="button">配置</button>
      <button class="tab" data-tab="channels" type="button">频道</button>
      <button class="tab" data-tab="logs" type="button">日志</button>
    </nav>
    <div class="status-banner" id="statusBanner" hidden></div>

    <section class="panel active" id="panel-overview">
      <div class="metric-grid" id="overviewMetrics"></div>
      <div class="overview-grid">
        <section class="surface">
          <div class="surface-head"><h2>频道状态</h2><span class="source" id="overviewChannelCount">0 个频道</span></div>
          <div class="surface-body list" id="overviewChannels"></div>
          <div class="reload-state" id="reloadState">尚未发生配置热更新</div>
        </section>
        <section class="surface">
          <div class="surface-head"><h2>最近会话</h2><span class="source">自动刷新</span></div>
          <div class="surface-body list" id="recentSessions"></div>
        </section>
      </div>
      <section class="surface">
        <div class="surface-head">
          <div><h2>服务操作</h2><div class="source">重启会继续使用当前项目配置</div></div>
          <div class="section-actions">
            <button id="restartService" type="button">重启服务</button>
            <button class="danger" id="stopService" type="button">停止服务</button>
          </div>
        </div>
        <div class="surface-body"><details><summary>原始状态</summary><pre id="rawState"></pre></details></div>
      </section>
    </section>

    <section class="panel" id="panel-usage">
      <section class="surface">
        <div class="surface-head"><h2>Codex 用量</h2><span class="source" id="usageRangeLabel"></span></div>
        <div class="surface-body usage-filter">
          <div class="field"><span>范围</span><div class="segmented" id="usagePresets"><button data-preset="today">今日</button><button data-preset="week">本周</button><button data-preset="month">本月</button><button data-preset="all" class="active">全部</button><button data-preset="recent">最近</button><button data-preset="custom">自定义</button></div></div>
          <label class="field"><span>开始日期</span><input id="usageStart" type="date" /></label>
          <label class="field"><span>结束日期</span><input id="usageEnd" type="date" /></label>
          <label class="field"><span>最近天数</span><select id="usageRecent"><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select></label>
          <label class="field"><span>时间桶</span><select id="usageBucket"><option value="day">按天</option><option value="week">按周</option><option value="month">按月</option></select></label>
          <button id="usageRefresh" type="button">刷新</button>
        </div>
      </section>
      <div class="usage-pending" id="usagePending" role="status" hidden></div>
      <div class="metric-grid" id="usageSummary"></div>
      <div class="usage-main">
        <section class="surface"><div class="surface-head"><h2>Token 趋势</h2><span class="source" id="usageInvalid"></span></div><div class="surface-body"><div class="chart-frame"><svg id="usageChart" role="img" aria-label="Token 使用趋势"></svg></div></div></section>
        <section class="surface"><div class="surface-head"><h2>模型分布</h2></div><div class="surface-body" id="usageModels"></div></section>
      </div>
      <div class="usage-groups">
        <section class="surface"><div class="surface-head"><h2>工作目录</h2></div><div class="surface-body" id="usageCwds"></div></section>
        <section class="surface"><div class="surface-head"><h2>最近调用</h2></div><div class="surface-body table-wrap"><table><thead><tr><th>时间</th><th>模型</th><th>目录</th><th>Token</th></tr></thead><tbody id="usageRecentRows"></tbody></table></div></section>
      </div>
    </section>

    <section class="panel" id="panel-config">
      <div class="config-grid">
        <section class="surface"><div class="surface-head"><h2>服务配置</h2></div><div class="surface-body"><dl class="definition-list" id="serviceConfig"></dl></div></section>
        <section class="surface"><div class="surface-head"><h2>Codex 配置</h2><div class="section-actions"><button id="editCodexModel" type="button">编辑配置</button><button id="cancelCodexModel" type="button" hidden>取消</button><button id="saveCodexModel" class="primary" type="button" hidden>保存</button></div></div><div class="surface-body"><dl class="definition-list" id="codexConfig"></dl></div></section>
      </div>
      <section class="surface"><div class="surface-head"><div><h2>飞书频道</h2><div class="source">账号运行设置可配置，工作目录与历史目录保持只读</div></div><button id="openChannels" type="button">打开频道管理</button></div><div class="surface-body" id="configChannelSummary"></div></section>
    </section>

    <section class="panel" id="panel-channels">
      <div class="channels-grid">
        <section class="surface">
          <div class="surface-head"><h2>频道</h2><button id="channelsRefresh" type="button">刷新</button></div>
          <div class="surface-body list" id="channelOverviewList"></div>
        </section>
        <section class="surface">
          <div class="surface-head">
            <div><h2>飞书</h2><div class="source" id="feishuSessionCount">0 个会话</div></div>
            <div class="section-actions"><button id="editAllAccounts" type="button">编辑全部</button><button id="cancelAllAccounts" type="button" hidden>取消</button><button id="saveAllAccounts" class="primary" type="button" hidden>保存全部</button><button id="addAccount" type="button">添加账号</button></div>
          </div>
          <div class="surface-body account-list" id="feishuAccountList"></div>
        </section>
      </div>
    </section>

    <section class="panel" id="panel-logs">
      <section class="surface">
        <div class="surface-head"><div><h2>服务日志</h2><div class="source" id="logMeta">等待加载</div></div></div>
        <div class="surface-body">
          <div class="logs-toolbar">
            <input id="logSearch" type="search" placeholder="搜索日志" aria-label="搜索日志" />
            <select id="logLevel" aria-label="日志级别"><option value="all">全部级别</option><option value="info">信息</option><option value="warn">警告</option><option value="error">错误</option></select>
            <button id="logPause" type="button">暂停</button>
            <button id="logCopy" type="button">复制</button>
            <a class="button-link" href="/api/logs/download" download="service.log">下载</a>
          </div>
          <pre class="log-output" id="logOutput">等待日志...</pre>
        </div>
      </section>
    </section>
  </main>

  <div class="drawer" id="sessionDrawer" hidden>
    <button class="drawer-backdrop" id="drawerBackdrop" type="button" aria-label="关闭会话详情"></button>
    <aside class="drawer-panel" aria-label="会话详情">
      <div class="drawer-head"><div class="drawer-title"><h2 id="drawerTitle">会话详情</h2><div class="source" id="drawerMeta"></div></div><button id="drawerClose" type="button">关闭</button></div>
      <div class="drawer-tabs"><button class="drawer-tab active" data-drawer-tab="realtime" type="button">实时过程</button><button class="drawer-tab" data-drawer-tab="archives" type="button">历史归档</button></div>
      <div class="drawer-body">
        <div class="drawer-view active" id="drawer-realtime"><div class="message-thread" id="drawerMessages"></div></div>
        <div class="drawer-view" id="drawer-archives">
          <div class="archive-toolbar"><button class="primary" id="summarizeArchive" type="button" disabled>AI 总结</button><button id="refreshSummary" type="button" disabled>刷新总结</button></div>
          <div class="archive-grid"><div class="archive-list" id="archiveList"></div><div class="archive-detail" id="archiveDetail"><div class="empty">选择一个历史归档</div></div></div>
        </div>
      </div>
    </aside>
  </div>

  <script>
    const THEME_STORAGE_KEY = "codex-gateway-theme";
    const TAB_STORAGE_KEY = "codex-gateway-admin-tab";
    const byId = (id) => document.getElementById(id);
    const make = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = String(text);
      return element;
    };
    const view = {
      activeTab: "overview",
      overview: null,
      overviewRequest: 0,
      publicConfig: null,
      editingCodexModel: false,
      codexModelDraft: "",
      codexReasoningEffortDraft: "",
      codexFastDraft: null,
      codexVerbosityDraft: "",
      modelOptions: [],
      codexRuntimeDefaults: { fast: false, verbosity: "medium" },
      modelCatalogError: "",
      accounts: { accounts: [] },
      editingAccounts: new Set(),
      newAccounts: new Set(),
      connectionTests: new Map(),
      usagePreset: "all",
      usageRequest: 0,
      usage: null,
      session: null,
      sessionChannelId: null,
      drawerTab: "realtime",
      archives: [],
      archiveSelection: undefined,
      logCursor: undefined,
      logText: "",
      logPaused: false
    };
    const systemThemeQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    function readStoredTheme() {
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        return stored === "light" || stored === "dark" ? stored : null;
      } catch { return null; }
    }
    function applyTheme(theme, persist) {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      if (persist) {
        try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
      }
      renderThemeToggle();
    }
    function renderThemeToggle() {
      const dark = document.documentElement.dataset.theme === "dark";
      const label = dark ? "切换到浅色主题" : "切换到深色主题";
      byId("themeIcon").textContent = dark ? "☀" : "☾";
      byId("themeToggle").setAttribute("aria-label", label);
      byId("themeToggle").title = label;
    }
    async function api(path, options) {
      const response = await fetch(path, options);
      const text = await response.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text || "响应格式无效" }; }
      if (!response.ok) throw new Error(body.error || ("HTTP " + response.status));
      return body;
    }
    function setStatus(message, error) {
      const banner = byId("statusBanner");
      if (!message) { banner.hidden = true; return; }
      banner.hidden = false;
      banner.classList.toggle("error", Boolean(error));
      banner.textContent = message;
      clearTimeout(setStatus.timer);
      setStatus.timer = setTimeout(() => { banner.hidden = true; }, error ? 8000 : 3500);
    }
    function activateTab(name) {
      view.activeTab = name;
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
      document.querySelectorAll(".panel").forEach((item) => item.classList.toggle("active", item.id === "panel-" + name));
      try { localStorage.setItem(TAB_STORAGE_KEY, name); } catch {}
      if (name === "usage") loadUsage().catch(showError);
      if (name === "config" && !view.publicConfig) loadPublicConfig().catch(showError);
      if (name === "logs" && view.logCursor === undefined) loadLogs(true).catch(showError);
    }
    function showError(error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
    function formatTime(value) {
      if (!value) return "-";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
    }
    function formatElapsed(value) {
      const ms = Number(value || 0);
      return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s";
    }
    function formatNumber(value) {
      return Number(value || 0).toLocaleString("zh-CN");
    }
    function stageText(stage) {
      return ({ received: "已接收", downloading_images: "下载图片", downloading_files: "下载文件", queued: "排队中", model_processing: "Codex 处理中", replying: "回复中", completed: "已完成", failed: "失败", stopped: "已停止", connected: "已连接", connecting: "连接中", not_configured: "未配置" })[stage] || stage || "未知";
    }
    function badge(text, state) {
      return make("span", "badge " + (state || ""), text);
    }
    function addMetric(container, label, value) {
      const metric = make("div", "metric");
      metric.append(make("div", "metric-label", label), make("div", "metric-value", value === undefined || value === null || value === "" ? "-" : value));
      container.append(metric);
    }
    function currentChannels() {
      return view.overview && view.overview.channels ? view.overview.channels.channels || [] : [];
    }
    function allSessions() {
      return currentChannels().flatMap((channel) => (channel.recentSessions || []).map((session) => ({ channel, session })));
    }
    async function loadOverview() {
      const request = ++view.overviewRequest;
      const overview = await api("/api/overview");
      if (request !== view.overviewRequest) return;
      view.overview = overview;
      renderOverview();
      if (!view.editingAccounts.size) renderAccounts();
    }
    function renderOverview() {
      const state = view.overview && view.overview.state ? view.overview.state : {};
      const stats = view.overview && view.overview.stats ? view.overview.stats : {};
      byId("stateDot").classList.toggle("online", Boolean(state.pid));
      byId("serviceState").textContent = state.pid ? "服务运行中 · PID " + state.pid : "服务未运行";
      const metrics = byId("overviewMetrics");
      metrics.replaceChildren();
      addMetric(metrics, "PID", state.pid);
      addMetric(metrics, "启动时间", formatTime(state.startedAt));
      addMetric(metrics, "监听端口", state.port);
      addMetric(metrics, "频道", stats.channels || 0);
      addMetric(metrics, "已连接", stats.connectedChannels || 0);
      addMetric(metrics, "活跃会话", stats.activeSessions || 0);
      const channels = currentChannels();
      byId("overviewChannelCount").textContent = channels.length + " 个频道";
      const channelList = byId("overviewChannels");
      channelList.replaceChildren();
      if (!channels.length) channelList.append(make("div", "empty", "暂无频道"));
      channels.forEach((channel) => {
        const row = make("div", "list-row");
        const head = make("div", "row-head");
        head.append(make("span", "row-title", channel.id), badge(stageText(channel.status), channel.status));
        row.append(head, make("div", "row-meta", (channel.model || "默认模型") + " · " + (channel.cwd || "-") + " · " + (channel.activeSessions || 0) + " 个活跃会话"));
        channelList.append(row);
      });
      const sessions = allSessions().sort((a, b) => Number(b.session.updatedAt || 0) - Number(a.session.updatedAt || 0)).slice(0, 8);
      const recent = byId("recentSessions");
      recent.replaceChildren();
      if (!sessions.length) recent.append(make("div", "empty", "暂无实时会话"));
      sessions.forEach(({ channel, session }) => {
        const row = make("button", "list-row");
        row.type = "button";
        const head = make("div", "row-head");
        head.append(make("span", "row-title", session.senderName || session.conversationKey), badge(stageText(session.stage), session.stage));
        row.append(head, make("div", "row-meta", (session.preview || "-") + " · " + formatElapsed(session.elapsedMs)));
        row.addEventListener("click", () => openSessionDrawer(channel.id, session));
        recent.append(row);
      });
      const reload = view.overview.reload || { status: "idle" };
      byId("reloadState").textContent = reload.status === "idle" ? "尚未发生配置热更新" : reload.status === "success" ? "最近配置热更新成功 · " + formatTime(reload.updatedAt) : "最近配置热更新失败 · " + formatTime(reload.updatedAt) + "\\n" + (reload.error || "未知错误");
      byId("rawState").textContent = JSON.stringify(view.overview, null, 2);
      renderChannelOverview();
    }
    function renderChannelOverview() {
      const channels = currentChannels();
      const sessions = allSessions();
      const configured = view.accounts.accounts.length;
      const enabled = view.accounts.accounts.filter((account) => account.enabled !== false).length;
      const active = channels.reduce((total, channel) => total + Number(channel.activeSessions || 0), 0);
      const list = byId("channelOverviewList");
      list.replaceChildren();
      const button = make("button", "channel-card active");
      button.type = "button";
      button.append(make("strong", "", "飞书"));
      const chips = make("div", "metric-chips");
      ["配置 " + configured, "启用 " + enabled, "会话 " + sessions.length, "处理中 " + active].forEach((text) => chips.append(make("span", "metric-chip", text)));
      button.append(chips);
      list.append(button);
      byId("feishuSessionCount").textContent = sessions.length + " 个会话";
    }
    async function loadPublicConfig() {
      view.publicConfig = await api("/api/config");
      renderPublicConfig();
    }
    async function loadModelCatalog() {
      try {
        const result = await api("/api/models");
        view.modelOptions = result.models || [];
        view.codexRuntimeDefaults = result.defaults || { fast: false, verbosity: "medium" };
        view.modelCatalogError = "";
      } catch (error) {
        view.modelOptions = [];
        view.codexRuntimeDefaults = { fast: false, verbosity: "medium" };
        view.modelCatalogError = error instanceof Error ? error.message : String(error);
      }
      if (view.publicConfig && !view.editingCodexModel) renderPublicConfig();
      if (!view.editingAccounts.size) renderAccounts();
    }
    function renderPublicConfig() {
      if (!view.publicConfig) return;
      renderDefinitions(byId("serviceConfig"), [
        ["配置文件", view.publicConfig.configPath],
        ["监听端口", view.publicConfig.service.port],
        ["工作目录", view.publicConfig.service.cwd]
      ]);
      const codex = view.publicConfig.codex || {};
      renderCodexConfig(codex);
      const summary = byId("configChannelSummary");
      summary.replaceChildren();
      const feishu = view.publicConfig.channels.feishu;
      const chips = make("div", "metric-chips");
      chips.append(make("span", "metric-chip", "配置账号 " + feishu.configuredAccounts), make("span", "metric-chip", "启用账号 " + feishu.enabledAccounts));
      summary.append(chips);
    }
    function renderDefinitions(target, entries) {
      target.replaceChildren();
      entries.forEach(([label, value]) => {
        appendDefinition(target, label, value);
      });
    }
    function appendDefinition(target, label, value) {
      target.append(make("dt", "", label), make("dd", "", value === undefined || value === null || value === "" ? "-" : value));
    }
    function renderCodexConfig(codex) {
      const target = byId("codexConfig");
      target.replaceChildren();
      appendDefinition(target, "命令", codex.command);
      const modelLabel = make("dt", "", "模型");
      const modelValue = make("dd");
      if (view.editingCodexModel) {
        modelValue.append(createModelCombo(view.codexModelDraft, {
          id: "codexModelInput",
          placeholder: "使用 Codex CLI 默认模型",
          onChange: (model) => {
            view.codexModelDraft = model;
            syncRuntimeTuningControls(target, model);
          }
        }));
      } else {
        modelValue.textContent = codex.model || defaultModelName() || "Codex CLI 默认";
      }
      target.append(modelLabel, modelValue);
      const tuning = view.editingCodexModel ? {
        reasoningEffort: view.codexReasoningEffortDraft,
        fast: view.codexFastDraft,
        verbosity: view.codexVerbosityDraft
      } : {
        reasoningEffort: codex.reasoningEffort || "",
        fast: typeof codex.fast === "boolean" ? codex.fast : null,
        verbosity: codex.verbosity || ""
      };
      target.append(createRuntimeTuningFields(view.editingCodexModel ? view.codexModelDraft : codex.model, tuning, {
        scope: "global",
        editing: view.editingCodexModel,
        effective: tuning
      }));
      [
        ["Sandbox", codex.sandbox || "默认"],
        ["Profile", codex.profile || "-"],
        ["Search", codex.search ? "开启" : "关闭"],
        ["跳过 Git 检查", codex.skipGitRepoCheck ? "是" : "否"],
        ["附加参数", (codex.extraArgs || []).join(" ") || "-"]
      ].forEach(([label, value]) => appendDefinition(target, label, value));
      byId("editCodexModel").hidden = view.editingCodexModel;
      byId("cancelCodexModel").hidden = !view.editingCodexModel;
      byId("saveCodexModel").hidden = !view.editingCodexModel;
    }
    function defaultModelName() {
      const item = view.modelOptions.find((model) => model.isDefault);
      return item ? item.model : "";
    }
    function modelCatalogItem(model) {
      const modelId = String(model || defaultModelName()).trim();
      return view.modelOptions.find((item) => item.model === modelId) || null;
    }
    async function editCodexModel() {
      const state = await api("/api/codex-config");
      view.codexModelDraft = state.model || "";
      view.codexReasoningEffortDraft = state.reasoningEffort || "";
      view.codexFastDraft = typeof state.fast === "boolean" ? state.fast : null;
      view.codexVerbosityDraft = state.verbosity || "";
      view.editingCodexModel = true;
      renderPublicConfig();
      byId("codexModelInput")?.focus();
    }
    function cancelCodexModel() {
      view.editingCodexModel = false;
      view.codexModelDraft = "";
      view.codexReasoningEffortDraft = "";
      view.codexFastDraft = null;
      view.codexVerbosityDraft = "";
      renderPublicConfig();
    }
    async function saveCodexModel() {
      const modelInput = byId("codexModelInput");
      const reasoningEffortInput = byId("codexReasoningEffortInput");
      const fastInput = byId("codexFastInput");
      const verbosityInput = byId("codexVerbosityInput");
      const state = await api("/api/codex-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelInput ? modelInput.value : "",
          reasoningEffort: reasoningEffortInput ? reasoningEffortInput.value : "",
          fast: fastInput ? parseFastValue(fastInput.value) : null,
          verbosity: verbosityInput ? verbosityInput.value : ""
        })
      });
      view.editingCodexModel = false;
      view.codexModelDraft = "";
      view.codexReasoningEffortDraft = "";
      view.codexFastDraft = null;
      view.codexVerbosityDraft = "";
      await loadPublicConfig();
      setStatus(state.model ? "全局 Codex 配置已保存，新会话将使用 " + state.model : "全局 Codex 配置已保存，模型沿用 CLI 默认值");
      setTimeout(() => loadOverview().catch(showError), 700);
    }
    async function loadAccounts() {
      view.accounts = await api("/api/feishu-config");
      view.editingAccounts.clear();
      view.newAccounts.clear();
      renderAccounts();
      renderChannelOverview();
    }
    function channelIdForAccount(accountId) {
      return !accountId || accountId === "default" ? "feishu" : "feishu:" + accountId;
    }
    function channelForAccount(account) {
      const id = channelIdForAccount(account.id);
      return currentChannels().find((channel) => channel.id === id) || null;
    }
    function renderAccounts() {
      const target = byId("feishuAccountList");
      if (!target) return;
      target.replaceChildren();
      const accounts = view.accounts.accounts || [];
      updateBulkActions();
      if (!accounts.length) { target.append(make("div", "empty", "暂无飞书账号")); return; }
      accounts.forEach((account, index) => target.append(createAccountCard(account, index)));
    }
    function createAccountCard(account, index) {
      const editing = view.editingAccounts.has(index);
      const channel = channelForAccount(account);
      const sessions = channel && channel.recentSessions ? channel.recentSessions : [];
      const card = make("div", "account-card");
      card.dataset.accountIndex = String(index);
      const head = make("div", "account-head");
      const title = make("div", "account-title");
      const effectiveModel = account.model || (channel && channel.model) || (view.publicConfig && view.publicConfig.codex && view.publicConfig.codex.model) || defaultModelName() || "默认模型";
      const modelText = account.model ? effectiveModel : effectiveModel + "（继承）";
      title.append(make("strong", "", account.id || "default"), make("span", "source", (account.enabled === false ? "disabled" : "enabled") + " · " + modelText + " · " + (account.cwd || "-")));
      const testState = view.connectionTests.get(channelIdForAccount(account.id));
      const connection = make("span", "connection-result" + (testState && testState.result ? (testState.result.ok ? " ok" : " error") : ""), connectionText(testState));
      title.append(connection);
      const actions = make("div", "account-actions");
      if (editing) {
        actions.append(accountButton("取消", () => cancelAccount(index)), accountButton("保存", () => saveAccounts()), accountButton("删除", () => removeAccount(index), "danger"));
      } else {
        actions.append(accountButton("连接测试", () => testConnection(account)), accountButton("编辑", () => editAccount(index)), accountButton("删除", () => removeAccount(index), "danger"));
      }
      head.append(title, actions);
      const fields = make("div", "account-fields");
      const globalCodex = view.publicConfig && view.publicConfig.codex ? view.publicConfig.codex : {};
      const inheritedModel = (channel && channel.model) || globalCodex.model || defaultModelName() || "";
      const runtimeModel = account.model || inheritedModel;
      const effectiveTuning = {
        reasoningEffort: account.reasoningEffort || (channel && channel.reasoningEffort) || globalCodex.reasoningEffort || "",
        fast: typeof account.fast === "boolean" ? account.fast : channel && typeof channel.fast === "boolean" ? channel.fast : typeof globalCodex.fast === "boolean" ? globalCodex.fast : null,
        verbosity: account.verbosity || (channel && channel.verbosity) || globalCodex.verbosity || ""
      };
      fields.append(
        createField("ID", "id", account.id || "default", { disabled: !editing }),
        createField("App ID", "appId", account.appId || "", { disabled: !editing }),
        createSecretField(account, editing),
        createField("机器人 open_id", "botOpenId", account.botOpenId || "", { disabled: !editing }),
        createDomainField(account.domain || "feishu", !editing),
        createModelField("模型", "model", account.model || "", editing, (model) => syncRuntimeTuningControls(card, model || inheritedModel)),
        createRuntimeTuningFields(runtimeModel, {
          reasoningEffort: account.reasoningEffort || "",
          fast: typeof account.fast === "boolean" ? account.fast : null,
          verbosity: account.verbosity || ""
        }, {
          scope: "account",
          editing,
          effective: effectiveTuning
        }),
        createField("工作目录", "cwd", account.cwd || "", { readonly: true }),
        createField("历史目录", "historyBaseDir", account.historyBaseDir || "", { readonly: true })
      );
      const original = document.createElement("input");
      original.type = "hidden";
      original.dataset.field = "originalId";
      original.value = account.originalId || account.id || "default";
      card.append(original);
      const flags = make("div", "flags");
      flags.append(createCheckbox("启用", "enabled", account.enabled !== false, !editing), createCheckbox("实时过程回复", "sendProgressReplies", account.sendProgressReplies === true, !editing));
      const sessionSection = make("div", "session-list");
      sessionSection.append(make("div", "source", sessions.length + " 个会话"));
      if (!sessions.length) sessionSection.append(make("div", "empty", "暂无实时会话"));
      sessions.forEach((session) => sessionSection.append(createSessionRow(channel.id, session)));
      card.append(head, fields, flags, sessionSection);
      return card;
    }
    function accountButton(text, handler, className) {
      const button = make("button", className || "", text);
      button.type = "button";
      button.addEventListener("click", () => Promise.resolve(handler()).catch(showError));
      return button;
    }
    function createField(labelText, key, value, options) {
      const label = make("label", "field");
      label.append(make("span", "", labelText));
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.field = key;
      input.value = value;
      input.disabled = Boolean(options && options.disabled);
      input.readOnly = Boolean(options && options.readonly);
      label.append(input);
      return label;
    }
    const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
    const VERBOSITIES = ["low", "medium", "high"];
    const RUNTIME_TUNING_SETTINGS = [
      { key: "reasoningEffort", label: "Effort" },
      { key: "fast", label: "Fast" },
      { key: "verbosity", label: "Verbosity" }
    ];
    function createRuntimeTuningFields(model, values, options) {
      const fragment = document.createDocumentFragment();
      RUNTIME_TUNING_SETTINGS.forEach((setting) => {
        if (options.scope === "global") {
          const term = make("dt", "runtime-setting", setting.label);
          const definition = make("dd", "runtime-setting");
          if (options.editing) definition.append(createRuntimeSettingControl(setting.key, values[setting.key], options.scope, model));
          else definition.append(createRuntimeSettingDisplay(setting.key, values[setting.key], options.effective[setting.key], options.scope, model));
          fragment.append(term, definition);
          return;
        }
        const field = make("label", "field runtime-setting");
        field.append(make("span", "", setting.label));
        if (options.editing) field.append(createRuntimeSettingControl(setting.key, values[setting.key], options.scope, model));
        else field.append(createRuntimeSettingDisplay(setting.key, values[setting.key], options.effective[setting.key], options.scope, model));
        fragment.append(field);
      });
      return fragment;
    }
    function createRuntimeSettingControl(key, value, scope, model) {
      const wrapper = make("div", "definition-control");
      const select = document.createElement("select");
      select.dataset.runtimeKey = key;
      select.dataset.runtimeScope = scope;
      if (scope === "account") select.dataset.field = key;
      if (scope === "global") {
        const ids = { reasoningEffort: "codexReasoningEffortInput", fast: "codexFastInput", verbosity: "codexVerbosityInput" };
        select.id = ids[key];
      }
      populateRuntimeSettingSelect(select, model, runtimeInputValue(key, value));
      wrapper.append(select);
      const note = make("span", "field-note");
      note.dataset.runtimeNote = key;
      wrapper.append(note);
      updateRuntimeSettingNote(wrapper, key, model);
      return wrapper;
    }
    function createRuntimeSettingDisplay(key, value, effectiveValue, scope, model) {
      const wrapper = make("div", "definition-control");
      wrapper.append(make("div", "runtime-setting-value", formatRuntimeSetting(key, value, effectiveValue, scope, model)));
      const note = make("span", "field-note");
      note.dataset.runtimeNote = key;
      wrapper.append(note);
      updateRuntimeSettingNote(wrapper, key, model);
      return wrapper;
    }
    function runtimeInputValue(key, value) {
      if (key === "fast") return typeof value === "boolean" ? String(value) : "";
      return typeof value === "string" ? value : "";
    }
    function runtimeSettingOptions(key, scope, model, currentValue) {
      const inheritedLabel = runtimeDefaultLabel(key, scope);
      if (key === "reasoningEffort") {
        const item = modelCatalogItem(model);
        const supported = item && Array.isArray(item.supportedReasoningEfforts) && item.supportedReasoningEfforts.length ? item.supportedReasoningEfforts.map((option) => option.reasoningEffort) : REASONING_EFFORTS;
        const efforts = Array.from(new Set(supported));
        if (currentValue && !efforts.includes(currentValue)) efforts.push(currentValue);
        return [{ value: "", label: inheritedLabel }].concat(efforts.map((effort) => ({
          value: effort,
          label: item && effort === item.defaultReasoningEffort ? effort + "（模型默认）" : effort
        })));
      }
      if (key === "fast") {
        const item = modelCatalogItem(model);
        return [
          { value: "", label: inheritedLabel },
          { value: "true", label: item && item.supportsFast === false ? "开启（当前模型不支持）" : "开启", disabled: Boolean(item && item.supportsFast === false) },
          { value: "false", label: "关闭" }
        ];
      }
      return [{ value: "", label: inheritedLabel }].concat(VERBOSITIES.map((verbosity) => ({ value: verbosity, label: verbosity })));
    }
    function runtimeDefaultLabel(key, scope) {
      if (key !== "fast" && key !== "verbosity") return scope === "account" ? "继承全局" : "Codex CLI 默认";
      if (key === "fast") {
        const cliDefault = view.codexRuntimeDefaults && view.codexRuntimeDefaults.fast === true;
        const configured = view.publicConfig && view.publicConfig.codex && view.publicConfig.codex.fast;
        const globalDefault = typeof configured === "boolean" ? configured : cliDefault;
        const current = scope === "account" ? globalDefault : cliDefault;
        return (scope === "account" ? "继承全局（当前：" : "Codex CLI 默认（当前：") + formatFastState(current) + "）";
      }
      const cliDefault = VERBOSITIES.includes(view.codexRuntimeDefaults && view.codexRuntimeDefaults.verbosity) ? view.codexRuntimeDefaults.verbosity : "medium";
      const globalVerbosity = view.publicConfig && view.publicConfig.codex && view.publicConfig.codex.verbosity;
      if (scope === "account") return "继承全局（当前：" + (globalVerbosity || cliDefault) + "）";
      return "Codex CLI 默认（当前：" + cliDefault + "）";
    }
    function populateRuntimeSettingSelect(select, model, value) {
      const options = runtimeSettingOptions(select.dataset.runtimeKey, select.dataset.runtimeScope, model, value);
      select.replaceChildren();
      options.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        option.disabled = Boolean(item.disabled);
        select.append(option);
      });
      select.value = value;
    }
    function syncRuntimeTuningControls(root, model) {
      root.querySelectorAll("select[data-runtime-key]").forEach((select) => {
        const value = select.value;
        populateRuntimeSettingSelect(select, model, value);
        updateRuntimeSettingNote(select.parentElement, select.dataset.runtimeKey, model);
      });
    }
    function updateRuntimeSettingNote(wrapper, key, model) {
      const note = wrapper && wrapper.querySelector ? wrapper.querySelector('[data-runtime-note="' + key + '"]') : null;
      if (!note) return;
      const item = modelCatalogItem(model);
      const unsupportedFast = key === "fast" && item && item.supportsFast === false;
      note.textContent = unsupportedFast ? "模型不支持 Fast" : key === "reasoningEffort" && !item ? "自定义模型，Effort 兼容性未知" : "";
      note.classList.toggle("warning", Boolean(unsupportedFast));
    }
    function formatRuntimeSetting(key, value, effectiveValue, scope, model) {
      const inherited = scope === "account" && (value === "" || value === null || value === undefined);
      const unset = value === "" || value === null || value === undefined;
      if ((key === "fast" || key === "verbosity") && unset) return runtimeDefaultLabel(key, scope);
      let resolved = inherited ? effectiveValue : value;
      let text;
      if (key === "fast") text = typeof resolved === "boolean" ? formatFastState(resolved) : "Codex CLI 默认";
      else if (resolved) text = String(resolved);
      else if (key === "reasoningEffort" && modelCatalogItem(model)?.defaultReasoningEffort) text = modelCatalogItem(model).defaultReasoningEffort + "（模型默认）";
      else text = "Codex CLI 默认";
      return inherited ? text + "（继承）" : text;
    }
    function formatFastState(value) {
      return value ? "开启" : "关闭";
    }
    function parseFastValue(value) {
      if (value === "true") return true;
      if (value === "false") return false;
      return null;
    }
    function createModelField(labelText, key, value, editing, onChange) {
      if (!editing) return createField(labelText, key, value, { readonly: true });
      const label = make("label", "field");
      label.append(make("span", "", labelText));
      label.append(createModelCombo(value, {
        field: key,
        placeholder: "继承全局模型",
        onChange
      }));
      return label;
    }
    function createModelCombo(value, options) {
      const wrapper = make("div", "model-combo");
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.value = value || "";
      input.placeholder = options.placeholder || "输入模型 ID";
      if (options.id) input.id = options.id;
      if (options.field) input.dataset.field = options.field;
      const toggle = make("button", "model-combo-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-label", "显示模型选项");
      toggle.title = "显示模型选项";
      const menu = make("div", "model-combo-menu");
      menu.setAttribute("role", "listbox");
      const state = { activeIndex: 0, matches: [], showAll: false };
      const notifyChange = () => {
        if (typeof options.onChange === "function") options.onChange(input.value);
      };
      const close = () => {
        wrapper.classList.remove("open");
        input.setAttribute("aria-expanded", "false");
      };
      const render = () => {
        const query = state.showAll ? "" : input.value.trim().toLowerCase();
        state.matches = view.modelOptions.filter((item) => {
          return !query || item.model.toLowerCase().includes(query) || item.displayName.toLowerCase().includes(query);
        }).slice(0, 20);
        menu.replaceChildren();
        if (!state.matches.length) {
          menu.append(make("div", "model-combo-empty", view.modelCatalogError ? "模型列表不可用，可直接输入模型 ID" : "没有匹配模型，可直接输入模型 ID"));
          return;
        }
        state.activeIndex = Math.min(Math.max(state.activeIndex, 0), state.matches.length - 1);
        state.matches.forEach((item, index) => {
          const option = make("button", "model-combo-option" + (index === state.activeIndex ? " active" : ""));
          option.type = "button";
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", index === state.activeIndex ? "true" : "false");
          option.append(make("strong", "", item.displayName || item.model));
          if (item.isDefault) option.append(badge("CLI 默认", "ok"));
          if (item.displayName !== item.model) option.append(make("code", "", item.model));
          if (item.description) option.append(make("span", "source", item.description));
          option.addEventListener("click", () => {
            input.value = item.model;
            close();
            notifyChange();
            input.focus();
          });
          menu.append(option);
        });
      };
      const open = (showAll = false) => {
        closeModelCombos(wrapper);
        wrapper.classList.add("open");
        input.setAttribute("aria-expanded", "true");
        state.showAll = showAll;
        render();
      };
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      input.addEventListener("focus", open);
      input.addEventListener("click", open);
      input.addEventListener("input", () => {
        state.activeIndex = 0;
        state.showAll = false;
        notifyChange();
        open();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          close();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
        if (!wrapper.classList.contains("open")) open();
        if (!state.matches.length) return;
        event.preventDefault();
        if (event.key === "ArrowDown") state.activeIndex = (state.activeIndex + 1) % state.matches.length;
        if (event.key === "ArrowUp") state.activeIndex = (state.activeIndex - 1 + state.matches.length) % state.matches.length;
        if (event.key === "Enter") {
          input.value = state.matches[state.activeIndex].model;
          close();
          notifyChange();
          return;
        }
        render();
      });
      toggle.addEventListener("click", () => {
        if (wrapper.classList.contains("open")) {
          close();
          return;
        }
        input.focus();
        open(true);
      });
      wrapper.append(input, toggle, menu);
      return wrapper;
    }
    function closeModelCombos(except) {
      document.querySelectorAll(".model-combo.open").forEach((combo) => {
        if (combo === except) return;
        combo.classList.remove("open");
        combo.querySelector("input")?.setAttribute("aria-expanded", "false");
      });
    }
    function createSecretField(account, editing) {
      const label = make("label", "field");
      label.append(make("span", "", "App Secret"));
      const wrapper = make("div", "secret-field");
      const input = document.createElement("input");
      input.type = "password";
      input.dataset.field = "appSecret";
      input.value = account.appSecret || "";
      input.placeholder = account.hasAppSecret ? "••••••••••••" : "";
      if (account.hasAppSecret) input.dataset.masked = "true";
      input.disabled = !editing;
      const toggle = make("button", "secret-toggle", "显示");
      toggle.type = "button";
      toggle.disabled = !editing;
      toggle.addEventListener("click", () => revealSecret(input, toggle, account.id || "default"));
      wrapper.append(input, toggle);
      label.append(wrapper);
      return label;
    }
    async function revealSecret(input, button, accountId) {
      if (input.type === "text") { input.type = "password"; button.textContent = "显示"; return; }
      if (input.dataset.masked === "true") {
        const secret = await api("/api/feishu-config/" + encodeURIComponent(accountId) + "/secret");
        input.value = secret.appSecret || "";
        delete input.dataset.masked;
      }
      input.type = "text";
      button.textContent = "隐藏";
    }
    function createDomainField(value, disabled) {
      const label = make("label", "field");
      label.append(make("span", "", "域名"));
      const select = document.createElement("select");
      select.dataset.field = "domain";
      select.disabled = disabled;
      ["feishu", "lark"].forEach((domain) => {
        const option = document.createElement("option");
        option.value = domain;
        option.textContent = domain;
        option.selected = domain === value;
        select.append(option);
      });
      label.append(select);
      return label;
    }
    function createCheckbox(labelText, key, checked, disabled) {
      const label = make("label", "check-row");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.field = key;
      input.checked = checked;
      input.disabled = disabled;
      label.append(input, make("span", "", labelText));
      return label;
    }
    function createSessionRow(channelId, session) {
      const row = make("div", "session-row");
      row.append(make("span", "session-cell", session.chatKind === "group" ? "群聊" : "私聊"), make("span", "session-cell", session.preview || "-"), badge(stageText(session.stage), session.stage), make("span", "session-cell", formatElapsed(session.elapsedMs)));
      const open = make("button", "", "详情");
      open.type = "button";
      open.addEventListener("click", () => openSessionDrawer(channelId, session));
      row.append(open);
      return row;
    }
    function connectionText(state) {
      if (!state) return "";
      if (state.testing) return "正在测试连接...";
      const result = state.result || {};
      return result.ok ? "连接成功 · " + Math.round(Number(result.latencyMs || 0)) + " ms" : "连接失败 · " + (result.error || "未知错误");
    }
    async function testConnection(account) {
      const channelId = channelIdForAccount(account.id);
      view.connectionTests.set(channelId, { testing: true });
      renderAccounts();
      try {
        const result = await api("/api/channels/" + encodeURIComponent(channelId) + "/test", { method: "POST" });
        view.connectionTests.set(channelId, { testing: false, result });
      } catch (error) {
        view.connectionTests.set(channelId, { testing: false, result: { ok: false, error: error instanceof Error ? error.message : String(error) } });
      }
      renderAccounts();
    }
    function editAccount(index) {
      view.editingAccounts.add(index);
      renderAccounts();
    }
    function cancelAccount(index) {
      if (view.newAccounts.has(index)) {
        view.accounts.accounts.splice(index, 1);
        view.newAccounts.delete(index);
        view.editingAccounts.delete(index);
        shiftIndexes(index);
        renderAccounts();
        return;
      }
      loadAccounts().catch(showError);
    }
    function shiftIndexes(removed) {
      view.editingAccounts = new Set(Array.from(view.editingAccounts).filter((index) => index !== removed).map((index) => index > removed ? index - 1 : index));
      view.newAccounts = new Set(Array.from(view.newAccounts).filter((index) => index !== removed).map((index) => index > removed ? index - 1 : index));
    }
    function addAccount() {
      const index = view.accounts.accounts.length;
      view.accounts.accounts.push({ id: "account-" + (index + 1), originalId: "account-" + (index + 1), enabled: true, appId: "", appSecret: "", hasAppSecret: false, botOpenId: "", domain: "feishu", sendProgressReplies: false });
      view.editingAccounts.add(index);
      view.newAccounts.add(index);
      renderAccounts();
    }
    async function removeAccount(index) {
      const account = view.accounts.accounts[index];
      if (!account || !confirm("确认删除飞书账号 " + account.id + "？")) return;
      view.accounts.accounts.splice(index, 1);
      shiftIndexes(index);
      renderAccounts();
      await saveAccounts();
    }
    function collectAccounts() {
      return Array.from(byId("feishuAccountList").querySelectorAll(".account-card")).map((card) => {
        const account = {};
        card.querySelectorAll("[data-field]").forEach((field) => {
          if (field.dataset.field === "fast") account.fast = parseFastValue(field.value);
          else account[field.dataset.field] = field.type === "checkbox" ? field.checked : field.value;
        });
        return account;
      });
    }
    async function saveAccounts() {
      view.accounts = await api("/api/feishu-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accounts: collectAccounts() }) });
      view.editingAccounts.clear();
      view.newAccounts.clear();
      renderAccounts();
      setStatus("飞书账号配置已保存，后台正在热更新");
      setTimeout(() => loadOverview().catch(showError), 700);
    }
    function editAllAccounts() {
      view.editingAccounts = new Set(view.accounts.accounts.map((_, index) => index));
      renderAccounts();
    }
    function updateBulkActions() {
      const editing = view.editingAccounts.size > 0;
      byId("editAllAccounts").hidden = editing;
      byId("cancelAllAccounts").hidden = !editing;
      byId("saveAllAccounts").hidden = !editing;
    }
    function openSessionDrawer(channelId, session) {
      view.sessionChannelId = channelId;
      view.session = session;
      view.archives = [];
      view.archiveSelection = undefined;
      byId("sessionDrawer").hidden = false;
      document.body.classList.add("drawer-open");
      byId("drawerTitle").textContent = session.senderName || session.conversationKey;
      byId("drawerMeta").textContent = session.conversationKey + " · " + stageText(session.stage) + " · " + session.messageCount + " 条消息";
      renderSessionMessages();
      activateDrawerTab("realtime");
    }
    function closeSessionDrawer() {
      byId("sessionDrawer").hidden = true;
      document.body.classList.remove("drawer-open");
      view.session = null;
    }
    function activateDrawerTab(name) {
      view.drawerTab = name;
      document.querySelectorAll(".drawer-tab").forEach((item) => item.classList.toggle("active", item.dataset.drawerTab === name));
      document.querySelectorAll(".drawer-view").forEach((item) => item.classList.toggle("active", item.id === "drawer-" + name));
      if (name === "archives" && view.session && !view.archives.length) loadArchives().catch(showError);
    }
    function renderSessionMessages() {
      const target = byId("drawerMessages");
      target.replaceChildren();
      const session = view.session;
      if (!session) { target.append(make("div", "empty", "暂无会话")); return; }
      (session.messages || []).forEach((message) => {
        const turn = make("article", "message-turn");
        const meta = make("div", "turn-meta");
        meta.append(make("span", "", formatTime(message.receivedAt)), badge(stageText(message.stage), message.stage), make("code", "", message.messageId || ""));
        turn.append(meta, createBubble("用户", message.preview || "-", "user"));
        const attachments = make("div", "attachment-row");
        if (message.imageCount) attachments.append(make("span", "attachment", "图片 " + message.imageCount));
        if (message.fileCount) attachments.append(make("span", "attachment", "文件 " + message.fileCount));
        (message.fileAttachments || []).forEach((file) => attachments.append(make("span", "attachment", file.name || file.path)));
        if (attachments.childNodes.length) turn.append(attachments);
        if (message.output) turn.append(createBubble("Codex", message.output, "assistant"));
        (message.progressEvents || []).forEach((event) => {
          if (event.type === "assistant_text" && !message.output) turn.append(createBubble("Codex", event.text || "", "assistant"));
          if (event.type !== "assistant_text") turn.append(createEventDetails(event));
        });
        if (message.error) turn.append(createBubble("错误", message.error, "error"));
        target.append(turn);
      });
      if (!target.childNodes.length) target.append(make("div", "empty", "暂无消息过程"));
    }
    function createBubble(label, text, className) {
      const bubble = make("div", "bubble " + className);
      bubble.append(make("span", "bubble-label", label), make("div", "", text));
      return bubble;
    }
    function createEventDetails(event) {
      let className = "event";
      let title;
      if (event.type === "tool_start") title = "工具开始 · " + (event.name || "tool");
      else if (event.type === "tool_result") title = "工具结果 · " + (event.name || "tool");
      else {
        const stderr = classifyStderr(event.text);
        className += " " + stderr.className;
        title = stderr.title;
      }
      const details = make("details", className);
      details.append(make("summary", "", title));
      const content = event.type === "tool_start" ? JSON.stringify(event.input || {}, null, 2) : event.text || "";
      details.append(make("pre", "", content));
      return details;
    }
    function classifyStderr(text) {
      const value = String(text || "");
      if (/\\b(?:ERROR|FATAL|PANIC)\\b/i.test(value)) return { className: "stderr-error", title: "Codex 错误" };
      if (/\\bWARN(?:ING)?\\b/i.test(value)) return { className: "stderr-warning", title: "Codex 警告" };
      return { className: "stderr-log", title: "Codex 运行日志" };
    }
    async function loadArchives() {
      if (!view.session || !view.sessionChannelId) return;
      const path = "/api/channels/" + encodeURIComponent(view.sessionChannelId) + "/archives?conversationKey=" + encodeURIComponent(view.session.conversationKey);
      const body = await api(path);
      view.archives = body.sessions || [];
      view.archiveSelection = view.archives.length ? 1 : undefined;
      renderArchiveList();
      if (view.archiveSelection) await loadArchiveDetail();
    }
    function renderArchiveList() {
      const target = byId("archiveList");
      target.replaceChildren();
      if (!view.archives.length) target.append(make("div", "empty", "暂无历史归档"));
      view.archives.forEach((archive, index) => {
        const selection = index + 1;
        const button = make("button", "list-row" + (selection === view.archiveSelection ? " active" : ""));
        button.type = "button";
        button.append(make("span", "row-title", (archive.current ? "当前 · " : "") + archive.archiveId), make("span", "row-meta", archive.messageCount + " 条 · " + formatTime(archive.lastActiveAt)), make("span", "row-meta", archive.preview || "-"));
        button.addEventListener("click", () => { view.archiveSelection = selection; renderArchiveList(); loadArchiveDetail().catch(showError); });
        target.append(button);
      });
      const enabled = Boolean(view.archiveSelection);
      byId("summarizeArchive").disabled = !enabled;
      byId("refreshSummary").disabled = !enabled;
    }
    async function loadArchiveDetail(summary) {
      if (!view.session || !view.sessionChannelId || !view.archiveSelection) return;
      const path = "/api/channels/" + encodeURIComponent(view.sessionChannelId) + "/archives?conversationKey=" + encodeURIComponent(view.session.conversationKey) + "&selection=" + view.archiveSelection;
      const body = await api(path);
      renderArchiveDetail(body.detail, summary);
    }
    function renderArchiveDetail(detail, summary) {
      const target = byId("archiveDetail");
      target.replaceChildren();
      if (!detail && !summary) { target.append(make("div", "empty", "暂无归档详情")); return; }
      const session = detail && detail.session ? detail.session : summary || {};
      target.append(make("h2", "", session.archiveId || "历史归档"));
      if (summary && summary.aiSummary) {
        const box = make("div", "summary-box");
        box.append(make("h3", "", summary.aiSummary.topic || "AI 总结"), make("p", "", "关键信息：" + (summary.aiSummary.keyInfo || "-")), make("p", "", "最近动作：" + (summary.aiSummary.recentAction || "-")));
        target.append(box);
      }
      if (summary && summary.summaryError) target.append(createBubble("总结失败", summary.summaryError, "error"));
      const thread = make("div", "message-thread");
      ((detail && detail.messages) || []).forEach((message) => thread.append(createBubble(message.role === "user" ? "用户" : "Codex", message.text || "", message.role === "user" ? "user" : "assistant")));
      target.append(thread);
    }
    async function summarizeArchive(refresh) {
      if (!view.session || !view.sessionChannelId || !view.archiveSelection) return;
      const path = "/api/channels/" + encodeURIComponent(view.sessionChannelId) + "/archives/summary";
      const body = await api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationKey: view.session.conversationKey, selection: view.archiveSelection, refresh: Boolean(refresh) }) });
      await loadArchiveDetail(body.summary);
    }
    async function loadUsage() {
      const request = ++view.usageRequest;
      const params = new URLSearchParams({ preset: view.usagePreset, bucket: byId("usageBucket").value, recentValue: byId("usageRecent").value });
      if (byId("usageStart").value) params.set("startDate", byId("usageStart").value);
      if (byId("usageEnd").value) params.set("endDate", byId("usageEnd").value);
      const usage = await api("/api/usage?" + params.toString());
      if (request !== view.usageRequest) return;
      view.usage = usage;
      renderUsage();
    }
    function renderUsage() {
      const usage = view.usage;
      if (!usage) return;
      const summary = byId("usageSummary");
      summary.replaceChildren();
      addMetric(summary, "请求数", formatNumber(usage.totalRequests));
      addMetric(summary, "总 Token", formatNumber(usage.totals.total));
      addMetric(summary, "输入", formatNumber(usage.totals.input));
      addMetric(summary, "缓存输入", formatNumber(usage.totals.cached));
      addMetric(summary, "输出", formatNumber(usage.totals.output));
      addMetric(summary, "推理", formatNumber(usage.totals.reasoning));
      const activeSessions = Math.max(0, Number(usage.activeSessions || 0));
      const pending = byId("usagePending");
      pending.hidden = activeSessions === 0;
      pending.textContent = activeSessions + " 个任务执行中，用量将在任务完成后入账。页面将自动刷新。";
      byId("usageRangeLabel").textContent = usage.range.start ? formatTime(usage.range.start) + " 至 " + formatTime(usage.range.end) : "暂无记录";
      byId("usageInvalid").textContent = usage.invalidLines ? "已忽略 " + usage.invalidLines + " 条无效记录" : "";
      renderUsageChart(usage.timeline || []);
      renderUsageGroups(byId("usageModels"), usage.byModel || []);
      renderUsageGroups(byId("usageCwds"), usage.byCwd || []);
      const rows = byId("usageRecentRows");
      rows.replaceChildren();
      (usage.recent || []).forEach((item) => {
        const row = document.createElement("tr");
        [formatTime(item.timestamp), item.model, item.cwd, formatNumber(item.usage.total)].forEach((text) => row.append(make("td", "", text)));
        rows.append(row);
      });
      if (!rows.childNodes.length) {
        const row = document.createElement("tr");
        const cell = make("td", "source", "暂无调用记录");
        cell.colSpan = 4;
        row.append(cell);
        rows.append(row);
      }
    }
    function renderUsageGroups(target, groups) {
      target.replaceChildren();
      const max = Math.max(1, ...groups.map((item) => Number(item.usage.total || 0)));
      groups.forEach((item) => {
        const row = make("div", "usage-group-row");
        row.append(make("span", "row-title", item.name), make("span", "source", formatNumber(item.usage.total) + " · " + item.requests + " 次"));
        const bar = make("div", "bar");
        const fill = make("span", "bar-fill");
        fill.style.width = Math.max(2, Number(item.usage.total || 0) / max * 100) + "%";
        bar.append(fill);
        row.append(bar);
        target.append(row);
      });
      if (!groups.length) target.append(make("div", "empty", "暂无数据"));
    }
    function renderUsageChart(timeline) {
      const svg = byId("usageChart");
      svg.replaceChildren();
      const canvasWidth = Math.max(800, timeline.length * 52);
      svg.setAttribute("viewBox", "0 0 " + canvasWidth + " 300");
      svg.style.width = canvasWidth + "px";
      if (!timeline.length) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String(canvasWidth / 2)); text.setAttribute("y", "150"); text.setAttribute("text-anchor", "middle"); text.setAttribute("fill", "currentColor"); text.textContent = "暂无用量数据"; svg.append(text); return;
      }
      const max = Math.max(1, ...timeline.map((item) => Number(item.usage.total || 0)));
      const gap = 12;
      const width = Math.max(12, (canvasWidth - 70 - gap * (timeline.length - 1)) / timeline.length);
      timeline.forEach((item, index) => {
        const height = Math.max(2, Number(item.usage.total || 0) / max * 230);
        const x = 35 + index * (width + gap);
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(x)); rect.setAttribute("y", String(255 - height)); rect.setAttribute("width", String(width)); rect.setAttribute("height", String(height)); rect.setAttribute("rx", "3"); rect.setAttribute("fill", "var(--accent)"); svg.append(rect);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String(x + width / 2)); label.setAttribute("y", "278"); label.setAttribute("text-anchor", "middle"); label.setAttribute("fill", "currentColor"); label.setAttribute("font-size", "10"); label.textContent = item.key; svg.append(label);
      });
    }
    async function loadLogs(reset) {
      if (view.logPaused) return;
      const params = new URLSearchParams();
      if (!reset && view.logCursor !== undefined) params.set("cursor", String(view.logCursor));
      const result = await api("/api/logs" + (params.toString() ? "?" + params.toString() : ""));
      if (reset || result.reset || view.logCursor === undefined) view.logText = result.content || "";
      else view.logText += result.content || "";
      if (view.logText.length > 600000) view.logText = view.logText.slice(-600000);
      view.logCursor = result.cursor;
      byId("logMeta").textContent = formatNumber(result.size) + " 字节 · " + (result.updatedAt ? formatTime(result.updatedAt) : "暂无日志");
      renderLogs();
    }
    function renderLogs() {
      const query = byId("logSearch").value.toLowerCase();
      const level = byId("logLevel").value;
      const lines = view.logText.split(/\\r?\\n/).filter((line) => {
        if (query && !line.toLowerCase().includes(query)) return false;
        if (level === "all") return true;
        return logLevel(line) === level;
      });
      const output = byId("logOutput");
      output.textContent = lines.join("\\n") || "暂无匹配日志";
      if (!view.logPaused) output.scrollTop = output.scrollHeight;
    }
    function logLevel(line) {
      const value = line.toLowerCase();
      if (value.includes("error") || value.includes("failed") || value.includes("失败")) return "error";
      if (value.includes("warn") || value.includes("警告")) return "warn";
      return "info";
    }
    function toggleLogPause() {
      view.logPaused = !view.logPaused;
      byId("logPause").textContent = view.logPaused ? "继续" : "暂停";
      if (!view.logPaused) loadLogs(false).catch(showError);
    }
    async function copyLogs() {
      await navigator.clipboard.writeText(byId("logOutput").textContent || "");
      setStatus("当前日志已复制");
    }
    async function restartService() {
      if (!confirm("确认重启 Codex Gateway 服务？")) return;
      await api("/api/service/restart", { method: "POST" });
      setStatus("服务正在重启，页面会自动恢复连接");
    }
    async function stopService() {
      if (!confirm("确认停止 Codex Gateway 服务？")) return;
      await api("/api/service/stop", { method: "POST" });
      setStatus("服务已停止");
    }
    async function refreshActiveTab() {
      await loadOverview();
      if (view.activeTab === "usage") await loadUsage();
      if (view.activeTab === "config") await Promise.all([loadPublicConfig(), loadModelCatalog()]);
      if (view.activeTab === "channels") await Promise.all([loadAccounts(), loadModelCatalog()]);
      if (view.activeTab === "logs") await loadLogs(true);
    }
    async function refreshUsagePolling() {
      const wasPending = Number(view.usage && view.usage.activeSessions || 0) > 0;
      await loadOverview();
      if (view.activeTab !== "usage") return;
      const activeSessions = currentChannels().reduce((total, channel) => total + Number(channel.activeSessions || 0), 0);
      if (activeSessions > 0 || wasPending) await loadUsage();
    }

    renderThemeToggle();
    byId("themeToggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true));
    systemThemeQuery && systemThemeQuery.addEventListener("change", (event) => { if (!readStoredTheme()) applyTheme(event.matches ? "dark" : "light", false); });
    document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    document.querySelectorAll(".drawer-tab").forEach((button) => button.addEventListener("click", () => activateDrawerTab(button.dataset.drawerTab)));
    byId("refreshButton").addEventListener("click", () => refreshActiveTab().catch(showError));
    byId("restartService").addEventListener("click", () => restartService().catch(showError));
    byId("stopService").addEventListener("click", () => stopService().catch(showError));
    byId("openChannels").addEventListener("click", () => activateTab("channels"));
    byId("channelsRefresh").addEventListener("click", () => Promise.all([loadOverview(), loadAccounts(), loadModelCatalog()]).catch(showError));
    byId("editCodexModel").addEventListener("click", () => editCodexModel().catch(showError));
    byId("cancelCodexModel").addEventListener("click", cancelCodexModel);
    byId("saveCodexModel").addEventListener("click", () => saveCodexModel().catch(showError));
    byId("editAllAccounts").addEventListener("click", editAllAccounts);
    byId("cancelAllAccounts").addEventListener("click", () => loadAccounts().catch(showError));
    byId("saveAllAccounts").addEventListener("click", () => saveAccounts().catch(showError));
    byId("addAccount").addEventListener("click", addAccount);
    byId("drawerClose").addEventListener("click", closeSessionDrawer);
    byId("drawerBackdrop").addEventListener("click", closeSessionDrawer);
    byId("summarizeArchive").addEventListener("click", () => summarizeArchive(false).catch(showError));
    byId("refreshSummary").addEventListener("click", () => summarizeArchive(true).catch(showError));
    byId("usagePresets").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { view.usagePreset = button.dataset.preset; byId("usagePresets").querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button)); loadUsage().catch(showError); }));
    byId("usageRefresh").addEventListener("click", () => loadUsage().catch(showError));
    byId("usageBucket").addEventListener("change", () => loadUsage().catch(showError));
    byId("usageRecent").addEventListener("change", () => { if (view.usagePreset === "recent") loadUsage().catch(showError); });
    byId("logSearch").addEventListener("input", renderLogs);
    byId("logLevel").addEventListener("change", renderLogs);
    byId("logPause").addEventListener("click", toggleLogPause);
    byId("logCopy").addEventListener("click", () => copyLogs().catch(showError));
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".model-combo")) closeModelCombos();
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !byId("sessionDrawer").hidden) closeSessionDrawer(); });

    try {
      const storedTab = localStorage.getItem(TAB_STORAGE_KEY);
      if (["overview", "usage", "config", "channels", "logs"].includes(storedTab)) activateTab(storedTab);
    } catch {}
    Promise.all([loadOverview(), loadPublicConfig(), loadAccounts(), loadModelCatalog()]).catch(showError);
    if (view.activeTab === "usage") loadUsage().catch(showError);
    if (view.activeTab === "logs") loadLogs(true).catch(showError);
    setInterval(() => {
      refreshUsagePolling().catch(showError);
      if (view.activeTab === "logs" && !view.logPaused) loadLogs(false).catch(showError);
    }, 2000);
  </script>
</body>
</html>`;
}

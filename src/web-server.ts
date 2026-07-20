import type { ChannelManager } from "./channel-manager.js";
import type { ServiceState } from "./service/state.js";

export interface WebServerOptions {
  port: number;
  stateProvider: () => ServiceState | null;
  channelStatusProvider: () => ReturnType<ChannelManager["getStatus"]>;
  channelManager?: WebChannelManager;
  stopService?: () => Promise<void> | void;
}

export interface WebRequestOptions {
  stateProvider: () => ServiceState | null;
  channelStatusProvider: () => ReturnType<ChannelManager["getStatus"]>;
  channelManager?: WebChannelManager;
  stopService?: () => Promise<void> | void;
}

export interface WebChannelManager {
  updateChannelConfig(id: string, config: { sendProgressReplies?: boolean }): boolean;
  testChannelConnection(id: string): Promise<unknown>;
  listChannelArchives(id: string, conversationKey: string): unknown;
  getChannelArchiveDetail(
    id: string,
    conversationKey: string,
    selection?: number | string
  ): unknown;
  summarizeChannelArchive(
    id: string,
    conversationKey: string,
    selection?: number | string,
    refresh?: boolean
  ): Promise<unknown>;
}

export function startWebServer(options: WebServerOptions): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    fetch: (request) => handleWebRequest(request, options),
  });
}

export async function handleWebRequest(
  request: Request,
  options: WebRequestOptions
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return htmlResponse(renderMonitorPage());
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return jsonResponse({
      state: options.stateProvider(),
      channels: options.channelStatusProvider(),
    });
  }
  if (request.method === "GET" && url.pathname === "/api/channels") {
    return jsonResponse(options.channelStatusProvider());
  }
  const channelRoute = parseChannelRoute(url.pathname);
  if (channelRoute && options.channelManager) {
    try {
      if (request.method === "POST" && channelRoute.action === "test") {
        return jsonResponse(
          await options.channelManager.testChannelConnection(channelRoute.channelId)
        );
      }
      if (request.method === "PATCH" && channelRoute.action === "config") {
        const body = await readJsonObject(request);
        if (typeof body.sendProgressReplies !== "boolean") {
          return jsonResponse({ error: "sendProgressReplies 必须是布尔值。" }, 400);
        }
        const ok = options.channelManager.updateChannelConfig(channelRoute.channelId, {
          sendProgressReplies: body.sendProgressReplies,
        });
        return jsonResponse({ ok }, ok ? 200 : 404);
      }
      if (request.method === "GET" && channelRoute.action === "archives") {
        const conversationKey = url.searchParams.get("conversationKey")?.trim();
        if (!conversationKey) return jsonResponse({ error: "缺少 conversationKey。" }, 400);
        const selection = parseArchiveSelection(url.searchParams.get("selection"));
        if (selection !== undefined) {
          return jsonResponse({
            detail: options.channelManager.getChannelArchiveDetail(
              channelRoute.channelId,
              conversationKey,
              selection
            ),
          });
        }
        return jsonResponse({
          sessions: options.channelManager.listChannelArchives(
            channelRoute.channelId,
            conversationKey
          ),
        });
      }
      if (request.method === "POST" && channelRoute.action === "archives/summary") {
        const body = await readJsonObject(request);
        const conversationKey = readNonEmptyString(body.conversationKey);
        if (!conversationKey) return jsonResponse({ error: "缺少 conversationKey。" }, 400);
        const selection = parseBodyArchiveSelection(body.selection);
        return jsonResponse({
          summary: await options.channelManager.summarizeChannelArchive(
            channelRoute.channelId,
            conversationKey,
            selection,
            body.refresh === true
          ),
        });
      }
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/service/stop") {
    await options.stopService?.();
    return jsonResponse({ ok: true });
  }
  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }
  return jsonResponse({ error: "Not found" }, 404);
}

function parseChannelRoute(
  pathname: string
): { channelId: string; action: "test" | "config" | "archives" | "archives/summary" } | null {
  const match = pathname.match(/^\/api\/channels\/([^/]+)\/(test|config|archives(?:\/summary)?)$/);
  if (!match) return null;
  return {
    channelId: decodeURIComponent(match[1]),
    action: match[2] as "test" | "config" | "archives" | "archives/summary",
  };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求体必须是 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

function parseArchiveSelection(value: string | null): number | string | undefined {
  if (!value?.trim()) return undefined;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function parseBodyArchiveSelection(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function renderMonitorPage(): string {
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
      --ink: #17212b;
      --muted: #66727f;
      --line: #d8dee5;
      --soft: #f4f6f8;
      --panel: #ffffff;
      --subtle: #fafbfc;
      --control: #ffffff;
      --control-hover: #f8fafb;
      --control-border: #bfc8d1;
      --control-border-hover: #768493;
      --brand-bg: #17212b;
      --brand-ink: #ffffff;
      --green: #176b52;
      --green-soft: #e7f4ef;
      --green-line: #79a997;
      --green-border: #b8d9cd;
      --green-panel: #f4faf7;
      --amber: #9a5b13;
      --red: #a53a3a;
      --online: #25845f;
      --offline: #8b96a1;
      --code-bg: #16202a;
      --code-ink: #e8edf2;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --ink: #e7edf3;
      --muted: #9aa6b2;
      --line: #343f49;
      --soft: #0f1419;
      --panel: #181e25;
      --subtle: #141a20;
      --control: #212a33;
      --control-hover: #29343e;
      --control-border: #485561;
      --control-border-hover: #738392;
      --brand-bg: #e7edf3;
      --brand-ink: #11161b;
      --green: #50c494;
      --green-soft: #18382d;
      --green-line: #3f9b78;
      --green-border: #32765e;
      --green-panel: #172d26;
      --amber: #e2a34d;
      --red: #f27777;
      --online: #50c494;
      --offline: #788591;
      --code-bg: #0b0f14;
      --code-ink: #dce5ed;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--soft); color: var(--ink); letter-spacing: 0; }
    button, input { font: inherit; letter-spacing: 0; }
    button { min-height: 34px; border: 1px solid var(--control-border); background: var(--control); color: var(--ink); border-radius: 5px; padding: 6px 11px; cursor: pointer; }
    button:hover { border-color: var(--control-border-hover); background: var(--control-hover); }
    button:disabled { cursor: not-allowed; opacity: .48; }
    button.primary { border-color: var(--green); background: var(--green); color: var(--soft); }
    button.danger { color: var(--red); }
    input[type="text"] { width: 100%; min-height: 34px; border: 1px solid var(--control-border); border-radius: 5px; padding: 6px 9px; background: var(--control); color: var(--ink); }
    .topbar { min-height: 64px; border-bottom: 1px solid var(--line); background: var(--panel); display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 24px; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 6px; background: var(--brand-bg); color: var(--brand-ink); font-size: 13px; font-weight: 750; }
    h1 { margin: 0; font-size: 19px; line-height: 1.2; }
    h2 { margin: 0; font-size: 15px; }
    h3 { margin: 0; font-size: 14px; }
    .top-actions { display: flex; gap: 8px; align-items: center; }
    .icon-button { width: 34px; height: 34px; min-height: 34px; padding: 0; display: grid; place-items: center; font-size: 17px; line-height: 1; }
    .service-state { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; white-space: nowrap; }
    .state-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--offline); }
    .state-dot.online { background: var(--online); }
    main { max-width: 1440px; margin: 0 auto; padding: 20px 24px 32px; }
    .service-strip { border: 1px solid var(--line); background: var(--panel); border-radius: 6px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .metric { min-width: 0; padding: 13px 16px; border-right: 1px solid var(--line); }
    .metric:last-child { border-right: 0; }
    .metric-label { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
    .metric-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .workspace { min-height: 610px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); display: grid; grid-template-columns: 286px minmax(0, 1fr); overflow: hidden; }
    .sidebar { border-right: 1px solid var(--line); background: var(--subtle); min-width: 0; }
    .side-head, .panel-head { min-height: 52px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); }
    .channel-list { padding: 8px; border-bottom: 1px solid var(--line); }
    .channel-row { width: 100%; height: 54px; display: block; text-align: left; border-color: transparent; background: transparent; padding: 7px 8px; }
    .channel-row.active { background: var(--green-soft); border-color: var(--green-border); }
    .row-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; font-size: 13px; }
    .row-meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; color: var(--muted); font-size: 11px; }
    .runtime-controls { padding: 14px; }
    .switch { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
    .switch input { width: 17px; height: 17px; accent-color: var(--green); }
    .side-action { width: 100%; margin-top: 10px; }
    .main-panel { min-width: 0; }
    .tabs { min-height: 52px; display: flex; align-items: end; gap: 4px; padding: 0 14px; border-bottom: 1px solid var(--line); }
    .tab { height: 41px; min-height: 41px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted); padding: 0 12px; }
    .tab.active { color: var(--ink); border-bottom-color: var(--green); font-weight: 650; }
    .tab-panel { display: none; min-height: 556px; }
    .tab-panel.active { display: block; }
    .session-layout { display: grid; grid-template-columns: 330px minmax(0, 1fr); min-height: 556px; }
    .session-list { border-right: 1px solid var(--line); padding: 8px; min-width: 0; }
    .session-row { width: 100%; min-height: 72px; display: block; text-align: left; margin-bottom: 6px; padding: 9px 10px; border-color: var(--line); }
    .session-row.active { border-color: var(--green-line); background: var(--green-soft); }
    .stage { color: var(--green); font-size: 11px; }
    .stage.failed { color: var(--red); }
    .stage.model_processing, .stage.queued, .stage.replying { color: var(--amber); }
    .detail { min-width: 0; padding: 18px; }
    .detail-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); margin: 14px 0 18px; }
    .detail-meta .metric { background: var(--panel); border: 0; }
    .timeline { border-top: 1px solid var(--line); }
    .timeline-item { padding: 13px 0; border-bottom: 1px solid var(--line); }
    .timeline-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 7px; font-size: 12px; }
    .timeline-body { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }
    .event-list { margin: 8px 0 0; padding: 0; list-style: none; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    .event-list li { padding: 2px 0; word-break: break-word; }
    .archive-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto auto; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .archive-layout { display: grid; grid-template-columns: 330px minmax(0, 1fr); min-height: 502px; }
    .archive-list { padding: 8px; border-right: 1px solid var(--line); }
    .archive-summary { padding: 12px; border: 1px solid var(--green-border); background: var(--green-panel); border-radius: 5px; margin-bottom: 16px; }
    .archive-summary p { margin: 6px 0 0; font-size: 13px; line-height: 1.5; }
    .config-grid { display: grid; grid-template-columns: minmax(220px, 360px) minmax(0, 1fr); min-height: 556px; }
    .config-block { padding: 18px; border-right: 1px solid var(--line); }
    .config-block:last-child { border-right: 0; }
    .result { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; color: var(--muted); font-size: 12px; }
    .empty { color: var(--muted); font-size: 13px; padding: 18px 10px; }
    details.raw { margin-top: 16px; border: 1px solid var(--line); background: var(--panel); border-radius: 6px; }
    details.raw summary { cursor: pointer; padding: 12px 14px; font-size: 13px; }
    pre { margin: 0; padding: 14px; border-top: 1px solid var(--line); background: var(--code-bg); color: var(--code-ink); overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 11px; line-height: 1.5; }
    @media (max-width: 900px) {
      main { padding: 14px; }
      .service-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric:nth-child(2) { border-right: 0; }
      .metric:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
      .workspace { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--line); }
      .session-layout, .archive-layout, .config-grid { grid-template-columns: 1fr; }
      .session-list, .archive-list, .config-block { border-right: 0; border-bottom: 1px solid var(--line); }
      .archive-toolbar { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 560px) {
      .topbar { padding: 0 14px; }
      .service-state { display: none; }
      .top-actions .danger { display: none; }
      .service-strip { grid-template-columns: 1fr; }
      .metric { border-right: 0; border-bottom: 1px solid var(--line); }
      .metric:last-child { border-bottom: 0; }
      .archive-toolbar { grid-template-columns: 1fr; }
      .detail-meta { grid-template-columns: 1fr; }
      .tabs { overflow-x: auto; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><div class="brand-mark">CG</div><h1>Codex Gateway</h1></div>
    <div class="top-actions">
      <div class="service-state"><span class="state-dot" id="stateDot"></span><span id="serviceState">加载中</span></div>
      <button class="icon-button" id="themeToggle" type="button" aria-label="切换到深色主题" title="切换到深色主题"><span id="themeIcon" aria-hidden="true">☾</span></button>
      <button id="refresh">刷新</button>
      <button class="danger" id="stopService">停止服务</button>
    </div>
  </header>
  <main>
    <section class="service-strip" id="serviceMetrics"></section>
    <section class="workspace">
      <aside class="sidebar">
        <div class="side-head"><h2>Channels</h2><span class="stage" id="channelCount">0</span></div>
        <div class="channel-list" id="channelList"></div>
        <div class="runtime-controls">
          <label class="switch"><span>实时过程回复</span><input id="progressToggle" type="checkbox" disabled /></label>
          <button class="side-action" id="connectionTest" disabled>连接测试</button>
          <div class="result" id="connectionResult">尚未测试</div>
        </div>
      </aside>
      <div class="main-panel">
        <nav class="tabs">
          <button class="tab active" data-tab="sessions">实时会话</button>
          <button class="tab" data-tab="archives">历史归档</button>
          <button class="tab" data-tab="config">运行配置</button>
        </nav>
        <div class="tab-panel active" id="panel-sessions">
          <div class="session-layout">
            <div class="session-list" id="sessionList"></div>
            <div class="detail" id="sessionDetail"><div class="empty">暂无会话</div></div>
          </div>
        </div>
        <div class="tab-panel" id="panel-archives">
          <div class="archive-toolbar">
            <input type="text" id="conversationKey" aria-label="会话键" placeholder="conversationKey" />
            <button id="loadArchives">加载归档</button>
            <button class="primary" id="summarizeArchive" disabled>AI 总结</button>
            <button id="refreshSummary" disabled>刷新总结</button>
          </div>
          <div class="archive-layout">
            <div class="archive-list" id="archiveList"><div class="empty">暂无归档</div></div>
            <div class="detail" id="archiveDetail"><div class="empty">暂无归档详情</div></div>
          </div>
        </div>
        <div class="tab-panel" id="panel-config">
          <div class="config-grid">
            <div class="config-block"><h2>Channel 配置</h2><div class="result" id="configSummary">尚未选择 channel</div></div>
            <div class="config-block"><h2>连接检查</h2><div class="result" id="configConnectionResult">尚未测试</div></div>
          </div>
        </div>
      </div>
    </section>
    <details class="raw"><summary>原始状态</summary><pre id="raw">加载中...</pre></details>
  </main>
  <script>
    const THEME_STORAGE_KEY = "codex-gateway-theme";
    const systemThemeQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    function readStoredTheme() {
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        return stored === "light" || stored === "dark" ? stored : null;
      } catch {
        return null;
      }
    }
    function renderThemeToggle() {
      const dark = document.documentElement.dataset.theme === "dark";
      const label = dark ? "切换到浅色主题" : "切换到深色主题";
      byId("themeIcon").textContent = dark ? "☀" : "☾";
      byId("themeToggle").setAttribute("aria-label", label);
      byId("themeToggle").title = label;
    }
    function applyTheme(theme, persist) {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      if (persist) {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {}
      }
      renderThemeToggle();
    }
    const view = {
      snapshot: null,
      channelId: null,
      conversationKey: null,
      messageId: null,
      archives: [],
      archiveSelection: undefined
    };
    const byId = (id) => document.getElementById(id);
    const make = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = String(text);
      return element;
    };
    const currentChannels = () => view.snapshot?.channels?.channels || [];
    const currentChannel = () => currentChannels().find((item) => item.id === view.channelId) || null;
    const formatTime = (value) => {
      if (!value) return "-";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
    };
    const formatElapsed = (value) => {
      const ms = Number(value || 0);
      if (ms < 1000) return ms + " ms";
      return (ms / 1000).toFixed(1) + " s";
    };
    const stageText = (stage) => ({
      received: "已接收", downloading_images: "下载图片", downloading_files: "下载文件",
      queued: "排队中", model_processing: "Codex 处理中", replying: "回复中",
      completed: "已完成", failed: "失败", stopped: "已停止"
    }[stage] || stage || "未知");
    renderThemeToggle();
    byId("themeToggle").addEventListener("click", () => {
      const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme, true);
    });
    systemThemeQuery?.addEventListener("change", (event) => {
      if (!readStoredTheme()) applyTheme(event.matches ? "dark" : "light", false);
    });
    async function api(path, options) {
      const response = await fetch(path, options);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || ("HTTP " + response.status));
      return body;
    }
    function addMetric(container, label, value) {
      const metric = make("div", "metric");
      metric.append(make("div", "metric-label", label), make("div", "metric-value", value || "-"));
      container.append(metric);
    }
    function renderService() {
      const state = view.snapshot?.state || {};
      const metrics = byId("serviceMetrics");
      metrics.replaceChildren();
      addMetric(metrics, "PID", state.pid);
      addMetric(metrics, "工作目录", state.cwd);
      addMetric(metrics, "日志", state.logPath);
      addMetric(metrics, "启动时间", formatTime(state.startedAt));
      byId("stateDot").classList.toggle("online", Boolean(state.pid));
      byId("serviceState").textContent = state.pid ? "服务运行中" : "服务未运行";
    }
    function renderChannels() {
      const channels = currentChannels();
      if (!channels.some((item) => item.id === view.channelId)) view.channelId = channels[0]?.id || null;
      byId("channelCount").textContent = String(channels.length);
      const list = byId("channelList");
      list.replaceChildren();
      if (!channels.length) list.append(make("div", "empty", "暂无 channel"));
      for (const channel of channels) {
        const button = make("button", "channel-row" + (channel.id === view.channelId ? " active" : ""));
        button.append(
          make("span", "row-title", channel.id),
          make("span", "row-meta", (channel.status || "unknown") + " · " + (channel.model || "默认模型"))
        );
        button.addEventListener("click", () => selectChannel(channel.id));
        list.append(button);
      }
      renderSelectedChannel();
    }
    function selectChannel(id) {
      view.channelId = id;
      view.messageId = null;
      view.archives = [];
      view.archiveSelection = undefined;
      renderChannels();
    }
    function renderSelectedChannel() {
      const channel = currentChannel();
      const toggle = byId("progressToggle");
      toggle.disabled = !channel;
      toggle.checked = Boolean(channel?.sendProgressReplies);
      byId("connectionTest").disabled = !channel;
      byId("configSummary").textContent = channel
        ? ["ID: " + channel.id, "状态: " + channel.status, "模型: " + (channel.model || "-"), "目录: " + (channel.cwd || "-"), "活跃会话: " + (channel.activeSessions || 0), "实时过程回复: " + (channel.sendProgressReplies ? "开启" : "关闭")].join("\\n")
        : "尚未选择 channel";
      renderSessions();
    }
    function renderSessions() {
      const sessions = currentChannel()?.recentSessions || [];
      if (!sessions.some((item) => item.currentMessage?.messageId === view.messageId)) {
        view.messageId = sessions[0]?.currentMessage?.messageId || null;
      }
      const list = byId("sessionList");
      list.replaceChildren();
      if (!sessions.length) list.append(make("div", "empty", "暂无实时会话"));
      sessions.forEach((session) => {
        const messageId = session.currentMessage?.messageId;
        const button = make("button", "session-row" + (messageId === view.messageId ? " active" : ""));
        const title = make("span", "row-title", session.senderName || session.conversationKey);
        const meta = make("span", "row-meta", stageText(session.stage) + " · " + session.messageCount + " 条 · " + formatElapsed(session.elapsedMs));
        const preview = make("span", "row-meta", session.preview || "-");
        button.append(title, meta, preview);
        button.addEventListener("click", () => {
          view.messageId = messageId;
          view.conversationKey = session.conversationKey;
          byId("conversationKey").value = session.conversationKey || "";
          renderSessions();
        });
        list.append(button);
      });
      const selected = sessions.find((item) => item.currentMessage?.messageId === view.messageId) || sessions[0];
      if (selected?.conversationKey && !view.conversationKey) {
        view.conversationKey = selected.conversationKey;
        byId("conversationKey").value = selected.conversationKey;
      }
      renderSessionDetail(selected);
    }
    function renderSessionDetail(session) {
      const detail = byId("sessionDetail");
      detail.replaceChildren();
      if (!session) {
        detail.append(make("div", "empty", "暂无会话"));
        return;
      }
      detail.append(make("h2", "", session.conversationKey));
      const meta = make("div", "detail-meta");
      addMetric(meta, "状态", stageText(session.stage));
      addMetric(meta, "耗时", formatElapsed(session.elapsedMs));
      addMetric(meta, "消息", session.messageCount);
      detail.append(meta);
      const timeline = make("div", "timeline");
      for (const message of session.messages || []) {
        const item = make("div", "timeline-item");
        const head = make("div", "timeline-head");
        const stage = make("span", "stage " + (message.stage || ""), stageText(message.stage));
        head.append(make("strong", "", message.preview || message.messageId), stage);
        item.append(head);
        if (message.output) item.append(make("div", "timeline-body", message.output));
        if (message.error) item.append(make("div", "stage failed", message.error));
        const events = make("ul", "event-list");
        for (const event of message.progressEvents || []) {
          const description = event.type === "assistant_text" ? event.text : event.type === "tool_start" ? (event.name + " started") : event.type === "tool_result" ? ((event.name || "tool") + " completed") : event.text || event.type;
          events.append(make("li", "", formatTime(event.at) + "  " + description));
        }
        if (events.childNodes.length) item.append(events);
        timeline.append(item);
      }
      detail.append(timeline);
    }
    async function loadArchives() {
      const key = byId("conversationKey").value.trim();
      if (!view.channelId || !key) return;
      view.conversationKey = key;
      const path = "/api/channels/" + encodeURIComponent(view.channelId) + "/archives?conversationKey=" + encodeURIComponent(key);
      const body = await api(path);
      view.archives = body.sessions || [];
      view.archiveSelection = view.archives.length ? 1 : undefined;
      renderArchives();
      if (view.archiveSelection) await loadArchiveDetail();
    }
    function renderArchives() {
      const list = byId("archiveList");
      list.replaceChildren();
      if (!view.archives.length) list.append(make("div", "empty", "暂无归档"));
      view.archives.forEach((archive, index) => {
        const selection = index + 1;
        const button = make("button", "session-row" + (selection === view.archiveSelection ? " active" : ""));
        button.append(
          make("span", "row-title", (archive.current ? "当前 · " : "") + archive.archiveId),
          make("span", "row-meta", archive.messageCount + " 条 · " + formatTime(archive.lastActiveAt)),
          make("span", "row-meta", archive.preview || "-")
        );
        button.addEventListener("click", async () => {
          view.archiveSelection = selection;
          renderArchives();
          await loadArchiveDetail();
        });
        list.append(button);
      });
      const enabled = Boolean(view.channelId && view.conversationKey && view.archiveSelection);
      byId("summarizeArchive").disabled = !enabled;
      byId("refreshSummary").disabled = !enabled;
    }
    async function loadArchiveDetail() {
      if (!view.channelId || !view.conversationKey || !view.archiveSelection) return;
      const path = "/api/channels/" + encodeURIComponent(view.channelId) + "/archives?conversationKey=" + encodeURIComponent(view.conversationKey) + "&selection=" + view.archiveSelection;
      const body = await api(path);
      renderArchiveDetail(body.detail);
    }
    function renderArchiveDetail(detailValue, summaryValue) {
      const detail = byId("archiveDetail");
      detail.replaceChildren();
      if (!detailValue && !summaryValue) {
        detail.append(make("div", "empty", "暂无归档详情"));
        return;
      }
      const session = detailValue?.session || summaryValue || {};
      detail.append(make("h2", "", session.archiveId || "Session summary"));
      const summary = summaryValue?.aiSummary;
      if (summary) {
        const box = make("div", "archive-summary");
        box.append(make("h3", "", summary.topic));
        box.append(make("p", "", "关键信息：" + summary.keyInfo));
        box.append(make("p", "", "最近动作：" + summary.recentAction));
        detail.append(box);
      } else if (summaryValue?.summaryError) {
        detail.append(make("div", "stage failed", summaryValue.summaryError));
      }
      const timeline = make("div", "timeline");
      for (const message of detailValue?.messages || []) {
        const item = make("div", "timeline-item");
        item.append(make("div", "timeline-head", message.role === "user" ? "用户" : "Codex"));
        item.append(make("div", "timeline-body", message.text));
        timeline.append(item);
      }
      detail.append(timeline);
    }
    async function summarizeArchive(refresh) {
      if (!view.channelId || !view.conversationKey || !view.archiveSelection) return;
      const path = "/api/channels/" + encodeURIComponent(view.channelId) + "/archives/summary";
      const body = await api(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationKey: view.conversationKey, selection: view.archiveSelection, refresh })
      });
      const detailPath = "/api/channels/" + encodeURIComponent(view.channelId) + "/archives?conversationKey=" + encodeURIComponent(view.conversationKey) + "&selection=" + view.archiveSelection;
      const detailBody = await api(detailPath);
      renderArchiveDetail(detailBody.detail, body.summary);
    }
    async function testConnection() {
      if (!view.channelId) return;
      const result = await api("/api/channels/" + encodeURIComponent(view.channelId) + "/test", { method: "POST" });
      const text = JSON.stringify(result, null, 2);
      byId("connectionResult").textContent = text;
      byId("configConnectionResult").textContent = text;
    }
    async function updateProgressReplies(enabled) {
      if (!view.channelId) return;
      await api("/api/channels/" + encodeURIComponent(view.channelId) + "/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sendProgressReplies: enabled })
      });
      await loadStatus();
    }
    function activateTab(name) {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
      document.querySelectorAll(".tab-panel").forEach((item) => item.classList.toggle("active", item.id === "panel-" + name));
      if (name === "archives" && view.conversationKey && !view.archives.length) loadArchives().catch(showError);
    }
    function showError(error) {
      const message = error instanceof Error ? error.message : String(error);
      byId("connectionResult").textContent = message;
    }
    async function loadStatus() {
      view.snapshot = await api("/api/status");
      renderService();
      renderChannels();
      byId("raw").textContent = JSON.stringify(view.snapshot, null, 2);
    }
    document.querySelectorAll(".tab").forEach((item) => item.addEventListener("click", () => activateTab(item.dataset.tab)));
    byId("refresh").addEventListener("click", () => loadStatus().catch(showError));
    byId("loadArchives").addEventListener("click", () => loadArchives().catch(showError));
    byId("summarizeArchive").addEventListener("click", () => summarizeArchive(false).catch(showError));
    byId("refreshSummary").addEventListener("click", () => summarizeArchive(true).catch(showError));
    byId("connectionTest").addEventListener("click", () => testConnection().catch(showError));
    byId("progressToggle").addEventListener("change", (event) => updateProgressReplies(event.target.checked).catch(showError));
    byId("stopService").addEventListener("click", async () => {
      if (!confirm("确认停止 Codex Gateway 服务？")) return;
      await api("/api/service/stop", { method: "POST" });
    });
    loadStatus().catch(showError);
    setInterval(() => loadStatus().catch(showError), 2000);
  </script>
</body>
</html>`;
}

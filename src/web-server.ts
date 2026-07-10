import type { ChannelManager } from "./channel-manager.js";
import type { ServiceState } from "./service/state.js";

export interface WebServerOptions {
  port: number;
  stateProvider: () => ServiceState | null;
  channelStatusProvider: () => ReturnType<ChannelManager["getStatus"]>;
  stopService?: () => Promise<void> | void;
}

export interface WebRequestOptions {
  stateProvider: () => ServiceState | null;
  channelStatusProvider: () => ReturnType<ChannelManager["getStatus"]>;
  stopService?: () => Promise<void> | void;
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
  if (request.method === "POST" && url.pathname === "/api/service/stop") {
    await options.stopService?.();
    return jsonResponse({ ok: true });
  }
  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }
  return jsonResponse({ error: "Not found" }, 404);
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
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #17202a; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 20px; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
    h1 { font-size: 28px; margin: 0; }
    button { border: 1px solid #c7ced8; background: white; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    section { background: white; border: 1px solid #dfe4ea; border-radius: 8px; padding: 16px; margin-top: 16px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #101828; color: #eef4ff; padding: 16px; border-radius: 6px; overflow: auto; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .item { border: 1px solid #edf0f4; border-radius: 6px; padding: 12px; }
    .label { color: #667085; font-size: 12px; margin-bottom: 4px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Codex Gateway</h1>
      <button id="refresh">刷新</button>
    </header>
    <section>
      <div class="meta" id="meta"></div>
    </section>
    <section>
      <h2>Channels</h2>
      <pre id="channels">加载中...</pre>
    </section>
    <section>
      <h2>Raw Status</h2>
      <pre id="raw">加载中...</pre>
    </section>
  </main>
  <script>
    async function loadStatus() {
      const response = await fetch("/api/status");
      const status = await response.json();
      const state = status.state || {};
      document.getElementById("meta").innerHTML = [
        ["PID", state.pid || "-"],
        ["Web UI", state.webUrl || "-"],
        ["CWD", state.cwd || "-"],
        ["Log", state.logPath || "-"]
      ].map(([label, value]) => '<div class="item"><div class="label">' + label + '</div><div>' + value + '</div></div>').join("");
      document.getElementById("channels").textContent = JSON.stringify(status.channels, null, 2);
      document.getElementById("raw").textContent = JSON.stringify(status, null, 2);
    }
    document.getElementById("refresh").addEventListener("click", loadStatus);
    loadStatus();
    setInterval(loadStatus, 5000);
  </script>
</body>
</html>`;
}

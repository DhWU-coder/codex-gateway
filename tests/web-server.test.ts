import { describe, expect, test } from "bun:test";
import { handleWebRequest } from "../src/web-server.js";

describe("web server", () => {
  test("returns status JSON with channels", async () => {
    const response = await handleWebRequest(new Request("http://127.0.0.1/api/status"), {
      stateProvider: () => ({
        pid: 1234,
        startedAt: "2026-07-10T00:00:00.000Z",
        host: "127.0.0.1",
        port: 18788,
        webUrl: "http://127.0.0.1:18788/",
        logPath: "/tmp/service.log",
        cwd: "/tmp/work",
        channels: {},
      }),
      channelStatusProvider: () => ({
        channels: [{ id: "feishu:test", status: "connected" }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state.pid).toBe(1234);
    expect(body.channels.channels[0].id).toBe("feishu:test");
  });

  test("renders a monitor page", async () => {
    const response = await handleWebRequest(new Request("http://127.0.0.1/"), {
      stateProvider: () => null,
      channelStatusProvider: () => ({ channels: [] }),
    });

    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Codex Gateway");
    expect(html).toContain("实时会话");
    expect(html).toContain("历史归档");
    expect(html).toContain("AI 总结");
    expect(html).toContain("连接测试");
    expect(html).toContain("实时过程回复");
    expect(html).toContain('id="themeToggle"');
    expect(html).toContain('aria-label="切换到深色主题"');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain("codex-gateway-theme");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html.indexOf('id="themeBootstrap"')).toBeLessThan(html.indexOf("<style>"));
    const scripts = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)).map(
      (match) => match[1] ?? ""
    );
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
    const runBootstrap = new Function("localStorage", "window", "document", scripts[0]);
    const storedRoot = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    runBootstrap(
      { getItem: () => "light" },
      { matchMedia: () => ({ matches: true }) },
      { documentElement: storedRoot }
    );
    expect(storedRoot.dataset.theme).toBe("light");
    const systemRoot = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    runBootstrap(
      { getItem: () => null },
      { matchMedia: () => ({ matches: true }) },
      { documentElement: systemRoot }
    );
    expect(systemRoot.dataset.theme).toBe("dark");
  });

  test("routes channel operations through the manager", async () => {
    const calls: unknown[] = [];
    const channelManager = {
      updateChannelConfig(id: string, config: unknown) {
        calls.push(["config", id, config]);
        return true;
      },
      async testChannelConnection(id: string) {
        calls.push(["test", id]);
        return { ok: true, checks: [{ name: "tenant_access_token", ok: true }] };
      },
      listChannelArchives(id: string, conversationKey: string) {
        calls.push(["archives", id, conversationKey]);
        return [{ archiveId: "archive-1", current: true }];
      },
      getChannelArchiveDetail(id: string, conversationKey: string, selection?: number | string) {
        calls.push(["detail", id, conversationKey, selection]);
        return { session: { archiveId: "archive-1" }, messages: [] };
      },
      async summarizeChannelArchive(
        id: string,
        conversationKey: string,
        selection?: number | string,
        refresh?: boolean
      ) {
        calls.push(["summary", id, conversationKey, selection, refresh]);
        return { archiveId: "archive-1", aiSummary: { topic: "网关开发" } };
      },
    };
    const options = {
      stateProvider: () => null,
      channelStatusProvider: () => ({ channels: [] }),
      channelManager,
    };
    const channelPath = "/api/channels/feishu%3Atest";

    const testResponse = await handleWebRequest(
      new Request(`http://127.0.0.1${channelPath}/test`, { method: "POST" }),
      options
    );
    const configResponse = await handleWebRequest(
      new Request(`http://127.0.0.1${channelPath}/config`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sendProgressReplies: true }),
      }),
      options
    );
    const archivesResponse = await handleWebRequest(
      new Request(
        `http://127.0.0.1${channelPath}/archives?conversationKey=dm%3Aou_sender`
      ),
      options
    );
    const detailResponse = await handleWebRequest(
      new Request(
        `http://127.0.0.1${channelPath}/archives?conversationKey=dm%3Aou_sender&selection=1`
      ),
      options
    );
    const summaryResponse = await handleWebRequest(
      new Request(`http://127.0.0.1${channelPath}/archives/summary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationKey: "dm:ou_sender",
          selection: 1,
          refresh: true,
        }),
      }),
      options
    );

    expect(testResponse.status).toBe(200);
    expect(configResponse.status).toBe(200);
    expect(await archivesResponse.json()).toEqual({
      sessions: [{ archiveId: "archive-1", current: true }],
    });
    expect(await detailResponse.json()).toMatchObject({
      detail: { session: { archiveId: "archive-1" } },
    });
    expect(await summaryResponse.json()).toMatchObject({
      summary: { aiSummary: { topic: "网关开发" } },
    });
    expect(calls).toEqual([
      ["test", "feishu:test"],
      ["config", "feishu:test", { sendProgressReplies: true }],
      ["archives", "feishu:test", "dm:ou_sender"],
      ["detail", "feishu:test", "dm:ou_sender", 1],
      ["summary", "feishu:test", "dm:ou_sender", 1, true],
    ]);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { handleWebRequest } from "../src/web-server.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    expect(html).toContain('data-tab="overview"');
    expect(html).toContain('data-tab="usage"');
    expect(html).toContain('data-tab="config"');
    expect(html).toContain('data-tab="channels"');
    expect(html).toContain('data-tab="logs"');
    expect(html).toContain('id="feishuAccountList"');
    expect(html).toContain('id="sessionDrawer"');
    expect(html).toContain('id="usageSummary"');
    expect(html).toContain('id="logOutput"');
    expect(html).toContain("历史归档");
    expect(html).toContain("AI 总结");
    expect(html).toContain("连接测试");
    expect(html).toContain("实时过程回复");
    expect(html).toContain("/api/feishu-config");
    expect(html).toContain("/api/usage");
    expect(html).toContain("/api/logs");
    expect(html).toContain("/api/service/restart");
    expect(html).not.toContain("Web Chat");
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

  test("删除账号时先刷新表单再保存剩余账号", async () => {
    const response = await handleWebRequest(new Request("http://127.0.0.1/"), {
      stateProvider: () => null,
      channelStatusProvider: () => ({ channels: [] }),
    });
    const html = await response.text();
    const script = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))[1]?.[1] ?? "";
    const source = script.match(/async function removeAccount\(index\) \{[\s\S]*?\n    \}/)?.[0];
    expect(source).toBeString();

    const order: string[] = [];
    const view = { accounts: { accounts: [{ id: "one" }, { id: "two" }] } };
    const removeAccount = new Function(
      "view",
      "confirm",
      "shiftIndexes",
      "renderAccounts",
      "saveAccounts",
      `${source}; return removeAccount;`
    )(
      view,
      () => true,
      () => order.push("shift"),
      () => order.push("render"),
      () => order.push("save")
    ) as (index: number) => Promise<void>;

    await removeAccount(0);
    expect(view.accounts.accounts).toEqual([{ id: "two" }]);
    expect(order).toEqual(["shift", "render", "save"]);
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

  test("提供概览、用量和日志 API", async () => {
    const fixture = createWebFixture();
    mkdirSync(join(fixture.projectRoot, ".codex-usage"), { recursive: true });
    writeFileSync(
      join(fixture.projectRoot, ".codex-usage", "usage.jsonl"),
      `${JSON.stringify({
        schema_version: "codex-usage.project-log.v1",
        timestamp: "2026-07-20T01:00:00.000Z",
        provider: "openai-codex",
        model: "gpt-5",
        cwd: "/workspace",
        usage: { total: 120, input: 80, cached: 20, output: 40 },
      })}\n`
    );
    writeFileSync(fixture.logPath, "service ready\n");
    const options = fixture.options({
      configReloadStateProvider: () => ({ status: "success", updatedAt: "now", result: {} }),
    });

    const overview = await handleWebRequest(
      new Request("http://127.0.0.1/api/overview"),
      options
    );
    const usage = await handleWebRequest(
      new Request("http://127.0.0.1/api/usage?preset=all"),
      options
    );
    const logs = await handleWebRequest(
      new Request("http://127.0.0.1/api/logs"),
      options
    );

    expect(await overview.json()).toMatchObject({
      state: { pid: 1234 },
      configPath: fixture.configPath,
      reload: { status: "success" },
      stats: { channels: 1, connectedChannels: 1, activeSessions: 2 },
    });
    expect(await usage.json()).toMatchObject({
      totalRequests: 1,
      totals: { total: 120, cached: 20 },
    });
    expect(await logs.json()).toMatchObject({ content: "service ready\n", reset: false });
  });

  test("配置 API 脱敏 Secret 并保存热更新字段", async () => {
    const fixture = createWebFixture();
    const options = fixture.options();

    const publicConfig = await handleWebRequest(
      new Request("http://127.0.0.1/api/config"),
      options
    );
    const accounts = await handleWebRequest(
      new Request("http://127.0.0.1/api/feishu-config"),
      options
    );
    const secret = await handleWebRequest(
      new Request("http://127.0.0.1/api/feishu-config/primary/secret"),
      options
    );
    const save = await handleWebRequest(
      new Request("http://127.0.0.1/api/feishu-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accounts: [
            {
              id: "primary",
              originalId: "primary",
              enabled: true,
              appId: "cli_updated",
              appSecret: "",
              domain: "feishu",
              sendProgressReplies: true,
            },
          ],
        }),
      }),
      options
    );

    const publicText = await publicConfig.text();
    const accountsText = await accounts.text();
    expect(publicText).not.toContain("secret-primary");
    expect(JSON.parse(publicText)).toMatchObject({
      configPath: fixture.configPath,
      codex: { command: "codex", model: "gpt-5" },
      channels: { feishu: { configuredAccounts: 1, enabledAccounts: 1 } },
    });
    expect(accountsText).not.toContain("secret-primary");
    expect(JSON.parse(accountsText).accounts[0]).toMatchObject({
      id: "primary",
      appSecret: "",
      hasAppSecret: true,
    });
    expect(await secret.json()).toEqual({ appSecret: "secret-primary" });
    expect(save.status).toBe(200);
    expect(readFileSync(fixture.configPath, "utf-8")).toContain("cli_updated");
  });

  test("日志下载和服务重启使用服务端固定依赖", async () => {
    const fixture = createWebFixture();
    writeFileSync(fixture.logPath, "download me\n");
    let restarted = 0;
    const options = fixture.options({
      restartService: () => {
        restarted += 1;
      },
    });

    const download = await handleWebRequest(
      new Request("http://127.0.0.1/api/logs/download"),
      options
    );
    const restart = await handleWebRequest(
      new Request("http://127.0.0.1/api/service/restart", { method: "POST" }),
      options
    );
    await Bun.sleep(80);

    expect(download.headers.get("content-disposition")).toContain("service.log");
    expect(await download.text()).toBe("download me\n");
    expect(restart.status).toBe(202);
    expect(restarted).toBe(1);
  });
});

function createWebFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-web-api-"));
  temporaryDirectories.push(projectRoot);
  const configPath = join(projectRoot, "config.yaml");
  const logPath = join(projectRoot, "service.log");
  writeFileSync(
    configPath,
    `service:
  port: 18788
  cwd: /workspace
codex:
  command: codex
  model: gpt-5
  sandbox: workspace-write
channels:
  feishu:
    accounts:
      - id: primary
        enabled: true
        appId: cli_primary
        appSecret: secret-primary
        domain: feishu
        model: gpt-5
        cwd: /workspace/primary
        historyBaseDir: /history/primary
        sendProgressReplies: false
`
  );
  const state = {
    pid: 1234,
    startedAt: "2026-07-20T00:00:00.000Z",
    host: "127.0.0.1",
    port: 18788,
    webUrl: "http://127.0.0.1:18788/",
    logPath,
    cwd: "/workspace",
    channels: {},
  };
  return {
    projectRoot,
    configPath,
    logPath,
    options(extra: Record<string, unknown> = {}) {
      return {
        stateProvider: () => state,
        channelStatusProvider: () => ({
          channels: [
            {
              id: "feishu:primary",
              status: "connected",
              activeSessions: 2,
            },
          ],
        }),
        projectRoot,
        configPath,
        logPath,
        ...extra,
      };
    },
  };
}

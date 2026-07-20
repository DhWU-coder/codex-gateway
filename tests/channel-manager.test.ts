import { describe, expect, test } from "bun:test";
import { ChannelManager } from "../src/channel-manager.js";
import type { FeishuAccountConfig, GatewayConfig } from "../src/config.js";

describe("Channel manager", () => {
  test("starts only configured Feishu channels and reports status", async () => {
    const started: string[] = [];
    const config = gatewayConfig([
      {
        id: "enabled",
        enabled: true,
        appId: "cli_a",
        appSecret: "secret",
        domain: "feishu",
        cwd: "/tmp/enabled",
        historyBaseDir: "/tmp/history-enabled",
        sendProgressReplies: false,
      },
      {
        id: "disabled",
        enabled: false,
        domain: "feishu",
        cwd: "/tmp/disabled",
        historyBaseDir: "/tmp/history-disabled",
        sendProgressReplies: false,
      },
    ]);
    const manager = new ChannelManager({
      config,
      createFeishuChannel: (account) => ({
        id: `feishu:${account.id}`,
        start: async () => {
          if (account.enabled) started.push(account.id);
        },
        stop: async () => undefined,
        getStatus: () => ({ id: account.id, status: account.enabled ? "connected" : "not_configured" }),
      }),
    });

    await manager.start();

    expect(started).toEqual(["enabled"]);
    expect(manager.getStatus().channels.map((channel) => channel.id)).toEqual([
      "enabled",
      "disabled",
    ]);
  });

  test("routes runtime operations to a selected channel", async () => {
    const updates: unknown[] = [];
    const manager = new ChannelManager({
      config: gatewayConfig([account("test")]),
      createFeishuChannel: () => ({
        id: "feishu:test",
        async start() {},
        async stop() {},
        getStatus: () => ({ id: "feishu:test", status: "connected" }),
        updateConfig(config) {
          updates.push(config);
        },
        async testConnection() {
          return { ok: true, checks: [{ name: "tenant_access_token", ok: true }] };
        },
        listArchivedSessions: () => [
          {
            archiveId: "archive-1",
            conversationKey: "dm:ou_sender",
            cwd: "/tmp/test",
            nativeSessionStarted: true,
            createdAt: "2026-07-20T00:00:00.000Z",
            lastActiveAt: "2026-07-20T00:01:00.000Z",
            messageCount: 2,
            preview: "测试任务",
            current: true,
          },
        ],
        getArchivedSessionDetail: () => null,
        summarizeArchivedSession: async () => null,
      }),
    });

    expect(manager.updateChannelConfig("feishu:test", { sendProgressReplies: true })).toBe(true);
    expect(updates).toEqual([{ sendProgressReplies: true }]);
    expect(await manager.testChannelConnection("feishu:test")).toMatchObject({ ok: true });
    expect(manager.listChannelArchives("feishu:test", "dm:ou_sender")).toHaveLength(1);
    expect(await manager.summarizeChannelArchive("feishu:test", "dm:ou_sender")).toBeNull();
  });

  test("returns useful failures for missing or unsupported channels", async () => {
    const manager = new ChannelManager({
      config: gatewayConfig([account("test")]),
      createFeishuChannel: () => ({
        id: "feishu:test",
        async start() {},
        async stop() {},
        getStatus: () => ({ id: "feishu:test", status: "connected" }),
      }),
    });

    expect(manager.updateChannelConfig("missing", { sendProgressReplies: true })).toBe(false);
    expect(await manager.testChannelConnection("missing")).toMatchObject({ ok: false });
    expect(manager.listChannelArchives("feishu:test", "dm:ou_sender")).toEqual([]);
  });

  test("热更新时动态删除和新增飞书账号", async () => {
    const events: string[] = [];
    const manager = new ChannelManager({
      config: gatewayConfig([account("old")]),
      createFeishuChannel: (item) => ({
        id: channelId(item.id),
        async start() {
          events.push(`start:${item.id}`);
        },
        async stop() {
          events.push(`stop:${item.id}`);
        },
        getStatus: () => ({ id: channelId(item.id), status: "connected" }),
      }),
    });
    await manager.start();

    const result = await manager.reloadConfig(gatewayConfig([account("new")]));

    expect(result).toMatchObject({
      added: ["feishu:new"],
      removed: ["feishu:old"],
      errors: [],
    });
    expect(events).toEqual(["start:old", "stop:old", "start:new"]);
    expect(manager.getStatus().channels.map((item) => item.id)).toEqual(["feishu:new"]);
  });

  test("过程回复原地更新，凭据变化只重建对应频道", async () => {
    const created: FeishuAccountConfig[] = [];
    const updates: Array<{ id: string; sendProgressReplies?: boolean }> = [];
    const events: string[] = [];
    const initial = { ...account("primary"), model: "gpt-5", cwd: "/workspace/old" };
    const manager = new ChannelManager({
      config: gatewayConfig([initial]),
      createFeishuChannel: (item) => {
        created.push({ ...item });
        const generation = created.length;
        return {
          id: channelId(item.id),
          async start() {
            events.push(`start:${generation}`);
          },
          async stop() {
            events.push(`stop:${generation}`);
          },
          getStatus: () => ({ id: channelId(item.id), status: "connected" }),
          updateConfig(config) {
            updates.push({ id: item.id, ...config });
          },
        };
      },
    });
    await manager.start();

    const runtimeResult = await manager.reloadConfig(
      gatewayConfig([{ ...initial, sendProgressReplies: true }])
    );
    const restartResult = await manager.reloadConfig(
      gatewayConfig([
        {
          ...initial,
          appSecret: "secret-new",
          sendProgressReplies: true,
          model: "gpt-5-new",
          cwd: "/workspace/new",
        },
      ])
    );

    expect(runtimeResult.updated).toEqual(["feishu:primary"]);
    expect(updates).toEqual([{ id: "primary", sendProgressReplies: true }]);
    expect(restartResult.restarted).toEqual(["feishu:primary"]);
    expect(restartResult.ignoredNonHotFields).toEqual([
      "feishu:primary.model",
      "feishu:primary.cwd",
    ]);
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({
      appSecret: "secret-new",
      model: "gpt-5",
      cwd: "/workspace/old",
      sendProgressReplies: true,
    });
    expect(events).toEqual(["start:1", "stop:1", "start:2"]);
  });

  test("频道重建失败时恢复旧频道并隔离错误", async () => {
    const events: string[] = [];
    const initial = account("primary");
    const manager = new ChannelManager({
      config: gatewayConfig([initial]),
      createFeishuChannel: (item) => ({
        id: channelId(item.id),
        async start() {
          events.push(`start:${item.appSecret}`);
          if (item.appSecret === "bad-secret") throw new Error("连接失败");
        },
        async stop() {
          events.push(`stop:${item.appSecret}`);
        },
        getStatus: () => ({
          id: channelId(item.id),
          status: item.appSecret === "bad-secret" ? "failed" : "connected",
        }),
      }),
    });
    await manager.start();

    const result = await manager.reloadConfig(
      gatewayConfig([{ ...initial, appSecret: "bad-secret" }])
    );

    expect(result.errors).toEqual([
      { channelId: "feishu:primary", error: "连接失败" },
    ]);
    expect(manager.getStatus().channels).toEqual([
      { id: "feishu:primary", status: "connected" },
    ]);
    expect(events).toEqual([
      "start:secret",
      "stop:secret",
      "start:bad-secret",
      "stop:bad-secret",
      "start:secret",
    ]);
  });
});

function account(id: string): FeishuAccountConfig {
  return {
    id,
    enabled: true,
    appId: "cli_a",
    appSecret: "secret",
    domain: "feishu",
    cwd: `/tmp/${id}`,
    historyBaseDir: `/tmp/history-${id}`,
    sendProgressReplies: false,
  };
}

function gatewayConfig(accounts: FeishuAccountConfig[]): GatewayConfig {
  return {
    service: {
      port: 18788,
      cwd: "/tmp/work",
    },
    codex: {
      command: "codex",
      model: "gpt-5",
      search: false,
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: false,
      extraArgs: [],
    },
    channels: {
      feishu: {
        accounts,
      },
    },
  };
}

function channelId(id: string): string {
  return id === "default" ? "feishu" : `feishu:${id}`;
}

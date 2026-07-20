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

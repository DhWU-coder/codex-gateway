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
});

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

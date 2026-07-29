import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { CodexModelOption } from "../src/codex/model-catalog.js";
import type { CodexConfig } from "../src/config.js";
import {
  WebChatChannel,
  createWebChatConversationKey,
} from "../src/web-chat/channel.js";
import { WebChatManager } from "../src/web-chat/manager.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat 频道适配器", () => {
  test("状态包含用户、Session、活跃任务和账户卡片", async () => {
    const { channel, manager } = fixture();
    const enabled = await manager.createUser({
      username: "alice",
      password: "password-123",
      model: "gpt-test",
    });
    const disabled = await manager.createUser({
      username: "bob",
      password: "password-456",
    });
    manager.updateUser(disabled.id, { enabled: false });
    const session = manager.createSession(enabled.id, { title: "测试会话" });
    await manager.sendMessage(enabled.id, session.id, { text: "你好" });

    await channel.start();
    const status = channel.getStatus();

    expect(status).toMatchObject({
      id: "web-chat",
      status: "connected",
      configuredUsers: 2,
      enabledUsers: 1,
      sessionCount: 1,
      activeSessions: 0,
    });
    expect(status.accounts).toEqual([
      expect.objectContaining({
        id: enabled.id,
        username: "alice",
        enabled: true,
        sessionCount: 1,
      }),
      expect.objectContaining({
        id: disabled.id,
        username: "bob",
        enabled: false,
        sessionCount: 0,
      }),
    ]);
    expect(status.recentSessions).toEqual([
      expect.objectContaining({
        conversationKey: createWebChatConversationKey(enabled.id, session.id),
      }),
    ]);
  });

  test("复用现有 archive 详情和 AI 总结接口", async () => {
    const { channel, manager } = fixture();
    const user = await manager.createUser({
      username: "alice",
      password: "password-123",
    });
    const session = manager.createSession(user.id);
    await manager.sendMessage(user.id, session.id, { text: "总结这件事" });
    const key = createWebChatConversationKey(user.id, session.id);

    expect(channel.listArchivedSessions(key)).toHaveLength(1);
    expect(channel.getArchivedSessionDetail(key)?.messages).toHaveLength(2);
    expect(await channel.summarizeArchivedSession(key)).toMatchObject({
      aiSummary: {
        topic: "Web Chat",
        keyInfo: "已有消息",
        recentAction: "已完成",
      },
    });
  });

  test("连接测试读取共享 Codex 模型目录", async () => {
    const { channel } = fixture();
    expect(await channel.testConnection()).toMatchObject({
      ok: true,
      checks: [
        { name: "codex_models", ok: true },
        { name: "codex_app_server", ok: true },
        { name: "codex_capabilities", ok: true },
      ],
    });
  });
});

function fixture() {
  const gatewayHome = mkdtempSync(join(tmpdir(), "codex-gateway-web-channel-"));
  roots.push(gatewayHome);
  const manager = new WebChatManager({
    gatewayHome,
    projectRoot: gatewayHome,
    codex: codexConfig(),
    modelCatalogProvider: async () => modelOptions(),
    runner: async (input) => {
      if (input.prompt.startsWith("总结以下飞书历史 session")) {
        return {
          text: '{"topic":"Web Chat","keyInfo":"已有消息","recentAction":"已完成"}',
        };
      }
      return { text: "你好", sessionId: "codex-web" };
    },
  });
  return {
    manager,
    channel: new WebChatChannel({
      manager,
      modelCatalogProvider: async () => modelOptions(),
    }),
  };
}

function codexConfig(): CodexConfig {
  return {
    command: "codex",
    model: "gpt-test",
    search: true,
    skipGitRepoCheck: true,
    dangerouslyBypassApprovalsAndSandbox: true,
    extraArgs: [],
  };
}

function modelOptions(): CodexModelOption[] {
  return [
    {
      id: "test",
      model: "gpt-test",
      displayName: "Test",
      description: "",
      supportedReasoningEfforts: [],
      additionalSpeedTiers: [],
      serviceTiers: [],
      supportsFast: false,
      isDefault: true,
    },
  ];
}

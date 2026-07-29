import { describe, expect, test } from "bun:test";
import type { CodexModelOption } from "../src/codex/model-catalog.js";
import type { WebChatAuthenticatedSession } from "../src/web-chat/auth.js";
import { buildWebChatBootstrap } from "../src/web-chat/bootstrap.js";
import type { WebChatManager } from "../src/web-chat/manager.js";
import type { WebChatSessionRecord } from "../src/web-chat/session-store.js";

describe("Web Chat 首屏 Bootstrap", () => {
  test("没有会话时创建默认会话并聚合完整公开首屏数据", async () => {
    const session = sessionRecord();
    const models: CodexModelOption[] = [
      {
        id: "gpt-test",
        model: "gpt-test",
        displayName: "GPT Test",
        description: "",
        supportedReasoningEfforts: [],
        additionalSpeedTiers: [],
        serviceTiers: [],
        supportsFast: false,
        isDefault: true,
      },
    ];
    let listCount = 0;
    const manager = {
      listSessions: () => {
        listCount += 1;
        return listCount === 1 ? [] : [session];
      },
      createSession: () => session,
      listModels: async () => models,
      listMessages: () => ({
        messages: [
          {
            id: "message-1",
            role: "user",
            text: "你好",
            createdAt: "2026-07-29T10:00:00.000Z",
          },
        ],
        total: 1,
      }),
      listTraces: () => [
        {
          messageId: "message-1",
          sessionId: session.id,
          status: "completed",
          entries: [],
          createdAt: "2026-07-29T10:00:00.000Z",
          updatedAt: "2026-07-29T10:00:01.000Z",
        },
      ],
      listCapabilities: async () => [
        {
          id: "capability-1",
          name: "Documents",
          kind: "plugin",
        },
      ],
    } as unknown as WebChatManager;
    const authenticated = {
      sessionToken: "不能进入页面",
      csrfToken: "csrf-test",
      expiresAt: 1_800_000_000_000,
      user: {
        id: "user-test",
        username: "alice",
        enabled: true,
        createdAt: "2026-07-29T09:00:00.000Z",
        updatedAt: "2026-07-29T09:00:00.000Z",
        workspacePath: "/private/workspace",
        sessionsPath: "/private/sessions",
      },
    } satisfies WebChatAuthenticatedSession;

    const bootstrap = await buildWebChatBootstrap(manager, authenticated);

    expect(listCount).toBe(2);
    expect(bootstrap).toMatchObject({
      version: 1,
      identity: {
        user: { id: "user-test", username: "alice" },
        csrfToken: "csrf-test",
        expiresAt: 1_800_000_000_000,
      },
      models,
      sessions: [session],
      current: {
        session,
        messages: {
          messages: [{ id: "message-1", text: "你好" }],
          total: 1,
        },
        traces: [{ messageId: "message-1", status: "completed" }],
        capabilities: [
          { id: "capability-1", name: "Documents", kind: "plugin" },
        ],
      },
    });
    expect(bootstrap.commands.map((command) => command.name)).toContain("model");
    expect(JSON.stringify(bootstrap)).not.toContain("不能进入页面");
  });
});

function sessionRecord(): WebChatSessionRecord {
  return {
    id: "session-test",
    userId: "user-test",
    title: "新对话",
    running: false,
    model: "gpt-test",
    planMode: false,
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:00:00.000Z",
  };
}

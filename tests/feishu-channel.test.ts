import { describe, expect, test } from "bun:test";
import { FeishuChannel } from "../src/feishu/channel.js";

describe("Feishu channel", () => {
  test("routes a direct message to Codex and replies with router output", async () => {
    const sentPrompts: string[] = [];
    const replies: string[] = [];
    const channel = new FeishuChannel({
      account: {
        id: "test",
        enabled: true,
        appId: "cli_a",
        appSecret: "secret",
        botOpenId: "ou_bot",
        domain: "feishu",
        cwd: "/tmp/work",
        historyBaseDir: "/tmp/history",
        sendProgressReplies: false,
      },
      eventClient: {
        start: async () => undefined,
        stop: async () => undefined,
      },
      messageClient: {
        replyText: async (input) => {
          replies.push(input.text);
        },
        sendText: async () => undefined,
      },
      router: {
        send: async (_conversationKey, prompt) => {
          sentPrompts.push(prompt);
        },
        resetSession: () => undefined,
        stopSession: () => true,
        stopAll: () => undefined,
        getStatus: () => ({ running: false, sessionId: "sess_1" }),
      },
    });

    await channel.handleEvent({
      event: {
        message: {
          message_id: "om_1",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "你好" }),
          mentions: [],
        },
        sender: {
          sender_name: "东豪",
          sender_id: { open_id: "ou_sender" },
        },
      },
    });

    channel.handleSessionOutput("dm:ou_sender", "Codex 回复");

    expect(sentPrompts).toEqual(["你好\n"]);
    expect(replies).toEqual(["Codex 回复"]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  buildCodexPromptForFeishu,
  parseFeishuMessageEvent,
  resolveConversationKey,
  shouldHandleMessage,
  stripBotMention,
} from "../src/feishu/events.js";

describe("Feishu events", () => {
  test("handles direct text messages without requiring mention", () => {
    const event = parseFeishuMessageEvent(messageEvent({ chatType: "p2p", text: "你好" }));

    expect(event?.text).toBe("你好");
    expect(resolveConversationKey(event!)).toBe("dm:ou_sender");
    expect(shouldHandleMessage(event!, "ou_bot")).toBe(true);
  });

  test("handles group messages only when the bot is mentioned", () => {
    const mentioned = parseFeishuMessageEvent(
      messageEvent({
        chatType: "group",
        text: "@Codex 帮我看下",
        mentions: [{ id: { open_id: "ou_bot" }, name: "Codex" }],
      })
    );
    const silent = parseFeishuMessageEvent(messageEvent({ chatType: "group", text: "路过" }));

    expect(shouldHandleMessage(mentioned!, "ou_bot")).toBe(true);
    expect(stripBotMention(mentioned!.text, mentioned!.mentions, "ou_bot")).toBe("帮我看下");
    expect(shouldHandleMessage(silent!, "ou_bot")).toBe(false);
  });

  test("builds Codex prompt with group sender and image paths", () => {
    const prompt = buildCodexPromptForFeishu({
      chatKind: "group",
      chatId: "oc_group",
      senderName: "东豪",
      text: "分析一下",
      imagePaths: ["/tmp/a.png"],
      filePaths: ["/tmp/readme.md"],
    });

    expect(prompt).toBe(
      "[东豪] 分析一下\n/tmp/a.png\n/tmp/readme.md\n\n如需将生成的本地文件回传到飞书，请把文件保存在当前工作目录，并在最终回复中单独一行输出 [[codex:file:路径]]。\n"
    );
  });

  test("tells Codex how to return generated files to Feishu", () => {
    const prompt = buildCodexPromptForFeishu({
      chatKind: "direct",
      chatId: "oc_direct",
      senderName: "东豪",
      text: "生成一个 HTML 文件",
      imagePaths: [],
    });

    expect(prompt).toContain("[[codex:file:路径]]");
    expect(prompt).toContain("当前工作目录");
  });
});

function messageEvent(input: {
  chatType?: string;
  text?: string;
  mentions?: Array<Record<string, unknown>>;
}) {
  return {
    event: {
      message: {
        message_id: "om_1",
        chat_id: "oc_group",
        chat_type: input.chatType ?? "p2p",
        message_type: "text",
        content: JSON.stringify({ text: input.text ?? "" }),
        mentions: input.mentions ?? [],
      },
      sender: {
        sender_name: "东豪",
        sender_id: {
          open_id: "ou_sender",
        },
      },
    },
  };
}

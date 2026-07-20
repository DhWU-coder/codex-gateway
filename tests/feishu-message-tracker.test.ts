import { describe, expect, test } from "bun:test";
import { FeishuMessageProgressTracker } from "../src/feishu/message-tracker.js";

describe("Feishu message tracker", () => {
  test("tracks stages, progress, output, files and elapsed time", () => {
    let now = 1000;
    const tracker = new FeishuMessageProgressTracker({
      accountId: "test",
      now: () => now,
    });
    tracker.start({
      messageId: "om_1",
      conversationKey: "dm:ou_1",
      chatKind: "direct",
      senderName: "东豪",
      preview: "生成报告",
      imageCount: 1,
      fileCount: 1,
    });
    now = 1250;
    tracker.update("om_1", { stage: "model_processing" });
    tracker.appendProgressEvent("dm:ou_1", {
      type: "tool_start",
      name: "command_execution",
      input: { command: "bun test" },
    });
    tracker.appendOutput("dm:ou_1", "正在测试");
    tracker.setFileAttachments("om_1", [{ name: "input.pdf", path: "/tmp/input.pdf" }]);
    now = 1500;
    tracker.update("om_1", { stage: "completed" });

    expect(tracker.list()).toEqual([
      expect.objectContaining({
        accountId: "test",
        messageId: "om_1",
        stage: "completed",
        elapsedMs: 500,
        output: "正在测试",
        progressEvents: [
          expect.objectContaining({ at: 1250, type: "tool_start", name: "command_execution" }),
        ],
        fileAttachments: [{ name: "input.pdf", path: "/tmp/input.pdf" }],
      }),
    ]);
  });

  test("groups recent messages by conversation and keeps a bounded history", () => {
    let now = 1000;
    const tracker = new FeishuMessageProgressTracker({
      accountId: "test",
      maxMessages: 2,
      now: () => now,
    });
    tracker.start(message("om_1", "dm:ou_1", "第一条"));
    now += 10;
    tracker.start(message("om_2", "dm:ou_1", "第二条"));
    now += 10;
    tracker.start(message("om_3", "group:oc_1", "第三条"));

    expect(tracker.list().map((item) => item.messageId)).toEqual(["om_3", "om_2"]);
    expect(tracker.listSessions()).toEqual([
      expect.objectContaining({ conversationKey: "group:oc_1", messageCount: 1 }),
      expect.objectContaining({
        conversationKey: "dm:ou_1",
        messageCount: 1,
        currentMessage: expect.objectContaining({ messageId: "om_2" }),
      }),
    ]);
  });

  test("bounds individual progress payloads", () => {
    const tracker = new FeishuMessageProgressTracker({ accountId: "test" });
    tracker.start(message("om_large", "dm:ou_large", "大输出"));
    tracker.appendProgressEventForMessage("om_large", {
      type: "tool_result",
      name: "command_execution",
      text: "x".repeat(10000),
    });

    const event = tracker.list()[0]?.progressEvents?.[0];

    expect(event?.type).toBe("tool_result");
    expect(event && "text" in event ? event.text.length : 0).toBeLessThanOrEqual(4003);
  });
});

function message(messageId: string, conversationKey: string, preview: string) {
  return {
    messageId,
    conversationKey,
    chatKind: "direct" as const,
    senderName: "东豪",
    preview,
    imageCount: 0,
    fileCount: 0,
  };
}

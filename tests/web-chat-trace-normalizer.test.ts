import { describe, expect, test } from "bun:test";
import {
  WebChatTraceNormalizer,
} from "../src/web-chat/trace-normalizer.js";

describe("Web Chat Trace 标准化", () => {
  test("中间回复与连续工具组按真实顺序交错", () => {
    let now = Date.parse("2026-07-29T00:00:00.000Z");
    let id = 0;
    const normalizer = new WebChatTraceNormalizer({
      now: () => new Date(now += 1_000),
      createId: () => `activity-${++id}`,
    });
    const trace = normalizer.create({
      messageId: "message-1",
      assistantMessageId: "message-2",
    });

    normalizer.append(trace, {
      type: "assistant_text",
      phase: "commentary",
      text: "先读取项目结构。",
    });
    normalizer.append(trace, {
      type: "tool_start",
      name: "commandExecution",
      toolUseId: "tool-1",
      input: { command: "rg --files" },
    });
    normalizer.append(trace, {
      type: "tool_result",
      name: "commandExecution",
      toolUseId: "tool-1",
      text: "README.md",
      durationMs: 25,
    });
    normalizer.append(trace, {
      type: "web_search",
      query: "Codex app-server",
      toolUseId: "tool-2",
    });
    normalizer.append(trace, {
      type: "assistant_text",
      phase: "commentary",
      text: "结构已经确认，开始修改。",
    });
    normalizer.append(trace, {
      type: "file_change",
      toolUseId: "tool-3",
      changes: [
        { path: "src/main.ts", additions: 8, deletions: 2 },
        { path: "src/view.ts", additions: 5, deletions: 0 },
      ],
    });

    expect(trace.entries.map((entry) => entry.type)).toEqual([
      "message",
      "tool_group",
      "message",
      "tool_group",
    ]);
    expect(trace.entries[1]).toMatchObject({
      type: "tool_group",
      activities: [
        expect.objectContaining({
          id: "tool-1",
          status: "completed",
          durationMs: 25,
        }),
        expect.objectContaining({
          id: "tool-2",
          kind: "web_search",
          status: "completed",
        }),
      ],
    });
    expect(trace.latestActivity).toBe("已修改 2 个文件");
    expect(trace.steps.current).toBe(3);
    expect(trace.fileChanges).toEqual({ files: 2, additions: 13, deletions: 2 });
  });

  test("递归隐藏敏感字段、令牌文本并截断长输出", () => {
    const normalizer = new WebChatTraceNormalizer({
      createId: () => "activity-secret",
    });
    const trace = normalizer.create({
      messageId: "message-secret",
      assistantMessageId: "assistant-secret",
    });

    normalizer.append(trace, {
      type: "tool_start",
      name: "mcpToolCall",
      toolUseId: "tool-secret",
      input: {
        authorization: "Bearer raw-auth-token",
        nested: {
          apiKey: "raw-api-key",
          value: "Bearer another-raw-token",
        },
      },
    });
    normalizer.append(trace, {
      type: "tool_result",
      toolUseId: "tool-secret",
      text: `password=raw-password ${"x".repeat(5_000)}`,
    });

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain("raw-auth-token");
    expect(serialized).not.toContain("raw-api-key");
    expect(serialized).not.toContain("another-raw-token");
    expect(serialized).not.toContain("raw-password");
    expect(serialized).toContain("[已隐藏]");
    expect(serialized.length).toBeLessThan(6_000);
  });

  test("最终化状态并限制最多 200 个时间线活动", () => {
    let now = Date.parse("2026-07-29T01:00:00.000Z");
    let id = 0;
    const normalizer = new WebChatTraceNormalizer({
      now: () => new Date(now += 1_000),
      createId: () => `activity-${++id}`,
    });
    const trace = normalizer.create({
      messageId: "message-limit",
      assistantMessageId: "assistant-limit",
    });

    for (let index = 0; index < 230; index += 1) {
      normalizer.append(trace, {
        type: "assistant_text",
        phase: "commentary",
        text: `过程 ${index}`,
      });
    }
    normalizer.finalize(trace, "completed");

    expect(trace.entries).toHaveLength(200);
    expect(trace.status).toBe("completed");
    expect(trace.completedAt).toBeDefined();
    expect(trace.summary).toContain("完成");
    expect(trace.summary).toContain("200 条过程");
  });
});

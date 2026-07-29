import { describe, expect, test } from "bun:test";
import { WebChatEventHub } from "../src/web-chat/event-hub.js";

describe("Web Chat 公开事件中心", () => {
  test("事件 ID 递增且按用户隔离", () => {
    const hub = new WebChatEventHub({ now: () => 1_000 });
    const first = hub.publish("user-1", {
      sessionId: "chat-1",
      type: "session.created",
      payload: { title: "第一段对话" },
    });
    const second = hub.publish("user-2", {
      sessionId: "chat-2",
      type: "session.created",
      payload: { title: "第二段对话" },
    });

    expect(second.id).toBe(first.id + 1);
    expect(hub.eventsSince("user-1", 0)).toEqual({
      events: [first],
      reset: false,
    });
    expect(hub.eventsSince("user-2", 0)).toEqual({
      events: [second],
      reset: false,
    });
  });

  test("订阅只接收当前用户事件并可取消", () => {
    const hub = new WebChatEventHub();
    const received: number[] = [];
    const unsubscribe = hub.subscribe("user-1", (event) => received.push(event.id));

    const first = hub.publish("user-1", {
      sessionId: "chat-1",
      type: "message.accepted",
      payload: { messageId: "message-1" },
    });
    hub.publish("user-2", {
      sessionId: "chat-2",
      type: "message.accepted",
      payload: { messageId: "message-2" },
    });
    unsubscribe();
    hub.publish("user-1", {
      sessionId: "chat-1",
      type: "message.completed",
      payload: { messageId: "message-1" },
    });

    expect(received).toEqual([first.id]);
  });

  test("消息接收事件只公开安全的附件和引用字段", () => {
    const hub = new WebChatEventHub();
    const event = hub.publish("user-1", {
      sessionId: "chat-1",
      type: "message.accepted",
      payload: {
        messageId: "message-1",
        text: "检查附件",
        attachments: [
          {
            id: "file-1",
            name: "截图.png",
            kind: "image",
            mimeType: "image/png",
            size: 123,
            path: "/private/截图.png",
          },
        ],
        references: [
          {
            id: "skill:review",
            name: "代码审查",
            kind: "skill",
            path: "/opt/skills/review/SKILL.md",
            prompt: "private",
          },
        ],
      },
    });

    expect(event.payload).toEqual({
      messageId: "message-1",
      text: "检查附件",
      attachments: [
        {
          id: "file-1",
          name: "截图.png",
          kind: "image",
          mimeType: "image/png",
          size: 123,
        },
      ],
      references: [
        {
          id: "skill:review",
          name: "代码审查",
          kind: "skill",
        },
      ],
    });
  });

  test("有限缓冲支持 Last-Event-ID 续传并报告窗口缺失", () => {
    const hub = new WebChatEventHub({ maxEventsPerUser: 2 });
    const first = publishProgress(hub, "一");
    const second = publishProgress(hub, "二");
    const third = publishProgress(hub, "三");

    expect(hub.eventsSince("user-1", second.id)).toEqual({
      events: [third],
      reset: false,
    });
    expect(hub.eventsSince("user-1", first.id - 1)).toEqual({
      events: [],
      reset: true,
    });
    expect(hub.eventsSince("user-1")).toEqual({
      events: [],
      reset: false,
    });
  });

  test("拒绝未知事件和管理员专属原始字段", () => {
    const hub = new WebChatEventHub();

    expect(() =>
      hub.publish("user-1", {
        sessionId: "chat-1",
        type: "message.progress",
        payload: { stderr: "secret" },
      })
    ).toThrow("公开事件不能包含");
    expect(() =>
      hub.publish("user-1", {
        sessionId: "chat-1",
        type: "tool.raw" as "message.progress",
        payload: {},
      })
    ).toThrow("不支持的公开事件类型");
  });

  test("活动和 Trace 事件只保留公开白名单字段", () => {
    const hub = new WebChatEventHub();
    const activity = hub.publish("user-1", {
      sessionId: "chat-1",
      type: "message.activity",
      payload: {
        messageId: "message-1",
        activity: {
          id: "activity-1",
          type: "command",
          title: "正在运行命令",
          status: "running",
          createdAt: "2026-07-29T00:00:00.000Z",
          absolutePath: "/private/project",
        },
        unknown: "drop-me",
      },
    });
    const trace = hub.publish("user-1", {
      sessionId: "chat-1",
      type: "message.trace",
      payload: {
        messageId: "message-1",
        trace: {
          status: "completed",
          summary: "完成 · 1 个工具",
          latestActivity: "处理完成",
          steps: { current: 1 },
          fileChanges: { files: 0 },
          private: "drop-me",
        },
      },
    });

    expect(activity.payload).toEqual({
      messageId: "message-1",
      activity: {
        id: "activity-1",
        type: "command",
        title: "正在运行命令",
        status: "running",
        createdAt: "2026-07-29T00:00:00.000Z",
      },
    });
    expect(trace.payload).toEqual({
      messageId: "message-1",
      trace: {
        status: "completed",
        summary: "完成 · 1 个工具",
        latestActivity: "处理完成",
        steps: { current: 1 },
        fileChanges: { files: 0 },
      },
    });
  });
});

function publishProgress(hub: WebChatEventHub, text: string) {
  return hub.publish("user-1", {
    sessionId: "chat-1",
    type: "message.progress",
    payload: { text },
  });
}

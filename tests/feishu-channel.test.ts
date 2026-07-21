import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    await channel.handleSessionOutput("dm:ou_sender", "Codex 回复");

    expect(sentPrompts).toEqual([
      "你好\n\n如需将生成的本地文件回传到飞书，请把文件保存在当前工作目录，并在最终回复中单独一行输出 [[codex:file:路径]]。\n",
    ]);
    expect(replies).toEqual(["Codex 回复"]);
  });

  test("uploads files declared by Codex and hides the directive", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-channel-file-"));
    const filePath = join(cwd, "result.html");
    writeFileSync(filePath, "<html></html>");
    const replies: string[] = [];
    const sentFiles: string[] = [];
    const channel = new FeishuChannel({
      account: account(cwd),
      messageClient: {
        async replyText(input) {
          replies.push(`${input.messageId}:${input.text}`);
        },
        async sendText() {},
        async replyFile(input) {
          sentFiles.push(`${input.messageId}:${input.filePath}`);
        },
      },
      router: {
        async send(_conversationKey, _prompt, _imagePaths, onOutput) {
          await onOutput?.("页面已经生成。\n[[codex:file:result.html]]");
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("生成 HTML", "om_1"));

    expect(replies).toEqual(["om_1:页面已经生成。"]);
    expect(sentFiles).toEqual([`om_1:${filePath}`]);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("sends a cwd file with the file command without calling Codex", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-channel-command-"));
    const filePath = join(cwd, "result.html");
    writeFileSync(filePath, "<html></html>");
    const routed: string[] = [];
    const sentFiles: string[] = [];
    const channel = new FeishuChannel({
      account: account(cwd),
      messageClient: {
        async replyText() {},
        async sendText() {},
        async replyFile(input) {
          sentFiles.push(`${input.messageId}:${input.filePath}`);
        },
      },
      router: {
        async send(_conversationKey, prompt) {
          routed.push(prompt);
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("/file result.html", "om_file"));
    await channel.handleEvent(textPayload("/sendfile result.html", "om_sendfile"));

    expect(routed).toEqual([]);
    expect(sentFiles).toEqual([`om_file:${filePath}`, `om_sendfile:${filePath}`]);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("binds each returned file to its source Feishu message", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-channel-binding-"));
    const firstPath = join(cwd, "first.html");
    const secondPath = join(cwd, "second.html");
    writeFileSync(firstPath, "first");
    writeFileSync(secondPath, "second");
    const outputCallbacks: Array<(text: string) => void | Promise<void>> = [];
    const replies: string[] = [];
    const sentFiles: string[] = [];
    const channel = new FeishuChannel({
      account: account(cwd),
      messageClient: {
        async replyText(input) {
          replies.push(input.text);
        },
        async sendText() {},
        async replyFile(input) {
          sentFiles.push(`${input.messageId}:${input.filePath}`);
        },
      },
      router: {
        async send(_conversationKey, _prompt, _imagePaths, onOutput) {
          if (onOutput) outputCallbacks.push(onOutput);
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("第一条", "om_1"));
    await channel.handleEvent(textPayload("第二条", "om_2"));
    await outputCallbacks[1]("[[codex:file:second.html]]");
    await outputCallbacks[0]("[[codex:file:first.html]]");

    expect(sentFiles).toEqual([`om_2:${secondPath}`, `om_1:${firstPath}`]);
    expect(replies).toEqual([]);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("handles archived session commands without sending them to Codex", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-channel-sessions-"));
    const replies: string[] = [];
    const routed: string[] = [];
    const actions: string[] = [];
    const sessions = [
      archivedSession({
        archiveId: "archive-current",
        sessionId: "codex-current",
        current: true,
        preview: "当前任务",
      }),
      archivedSession({
        archiveId: "archive-old",
        sessionId: "codex-old",
        current: false,
        preview: "历史任务",
      }),
    ];
    const channel = new FeishuChannel({
      account: { ...account(cwd), model: "gpt-5" },
      messageClient: {
        async replyText(input) {
          replies.push(`${input.messageId}:${input.text}`);
        },
        async sendText() {},
      },
      router: {
        async send(_conversationKey, prompt) {
          routed.push(prompt);
        },
        resetSession(conversationKey) {
          actions.push(`reset:${conversationKey}`);
        },
        stopSession(conversationKey) {
          actions.push(`stop:${conversationKey}`);
          return true;
        },
        stopAll() {},
        getStatus: () => ({
          running: false,
          sessionId: "codex-current",
          archiveId: "archive-current",
          cwd,
          model: "gpt-5",
          messageCount: 4,
        }),
        listArchivedSessions: () => sessions,
        getCurrentArchivedSession: () => sessions[0],
        getArchivedSessionDetail: (_conversationKey, selection) =>
          selection === 2
            ? {
                session: sessions[1],
                messages: [
                  { role: "user", text: "历史问题", createdAt: "2026-07-19T00:00:00.000Z" },
                  { role: "assistant", text: "历史回答", createdAt: "2026-07-19T00:01:00.000Z" },
                ],
              }
            : null,
        resumeArchivedSession(_conversationKey, selection) {
          actions.push(`resume:${selection}`);
          return {
            ok: true,
            message: "已恢复历史 session。",
            archiveId: "archive-old",
            sessionId: "codex-old",
          };
        },
        forkArchivedSession(_conversationKey, selection) {
          actions.push(`fork:${selection}`);
          return {
            ok: true,
            message: "已 fork 历史 session。",
            archiveId: "archive-fork",
            forkedFrom: "archive-current",
          };
        },
        summarizeArchivedSessions: async () => [
          {
            ...sessions[0],
            aiSummary: {
              topic: "网关开发",
              keyInfo: "会话管理",
              recentAction: "运行测试",
              messageCount: 4,
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
          },
        ],
        summarizeArchivedSession: async (_conversationKey, selection, refresh) => {
          actions.push(`summary:${selection ?? "current"}:${refresh}`);
          return {
            ...sessions[1],
            aiSummary: {
              topic: "历史总结",
              keyInfo: "保留上下文",
              recentAction: "刷新缓存",
              messageCount: 4,
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
          };
        },
      },
    });

    await channel.handleEvent(textPayload("/new", "om_new"));
    await channel.handleEvent(textPayload("/clear", "om_clear"));
    await channel.handleEvent(textPayload("/stop", "om_stop"));
    await channel.handleEvent(textPayload("/status", "om_status"));
    await channel.handleEvent(textPayload("/sessions 1", "om_sessions"));
    await channel.handleEvent(textPayload("/sessions all --summary 1", "om_summary"));
    await channel.handleEvent(textPayload("/session", "om_session"));
    await channel.handleEvent(textPayload("/session 2", "om_session_2"));
    await channel.handleEvent(textPayload("/resume 2", "om_resume"));
    await channel.handleEvent(textPayload("/fork 1", "om_fork"));
    await channel.handleEvent(textPayload("/summary 2 --refresh", "om_one_summary"));

    expect(routed).toEqual([]);
    expect(actions).toEqual([
      "reset:dm:ou_sender",
      "reset:dm:ou_sender",
      "stop:dm:ou_sender",
      "resume:2",
      "fork:1",
      "summary:2:true",
    ]);
    expect(replies.find((reply) => reply.startsWith("om_status:"))).toContain("账号：test");
    expect(replies.find((reply) => reply.startsWith("om_status:"))).toContain("Archive：archive-current");
    const listReply = replies.find((reply) => reply.startsWith("om_sessions:")) ?? "";
    expect(listReply).toContain("1. 当前");
    expect(listReply).not.toContain("archive-old");
    const summaryReply = replies.find((reply) => reply.startsWith("om_summary:")) ?? "";
    expect(summaryReply).toContain("主题：网关开发");
    expect(summaryReply).toContain("历史任务");
    expect(replies.find((reply) => reply.startsWith("om_session:"))).toContain("当前 session");
    expect(replies.find((reply) => reply.startsWith("om_session_2:"))).toContain("用户：\n历史问题");
    expect(replies.find((reply) => reply.startsWith("om_resume:"))).toContain("原生 session：codex-old");
    expect(replies.find((reply) => reply.startsWith("om_fork:"))).toContain("fork 自：archive-current");
    expect(replies.find((reply) => reply.startsWith("om_one_summary:"))).toContain("主题：历史总结");
    rmSync(cwd, { recursive: true, force: true });
  });

  test("reports empty or missing archived session selections", async () => {
    const replies: string[] = [];
    const channel = new FeishuChannel({
      account: account("/tmp/work"),
      messageClient: {
        async replyText(input) {
          replies.push(input.text);
        },
        async sendText() {},
      },
      router: {
        async send() {},
        resetSession() {},
        stopSession: () => false,
        stopAll() {},
        getStatus: () => ({ running: false }),
        listArchivedSessions: () => [],
        getCurrentArchivedSession: () => null,
        getArchivedSessionDetail: () => null,
        resumeArchivedSession: () => ({ ok: false, message: "没有找到对应的历史 session。" }),
        forkArchivedSession: () => ({ ok: false, message: "没有找到对应的历史 session。" }),
        summarizeArchivedSessions: async () => [],
      },
    });

    await channel.handleEvent(textPayload("/sessions", "om_empty"));
    await channel.handleEvent(textPayload("/session", "om_current"));
    await channel.handleEvent(textPayload("/session 9", "om_missing"));
    await channel.handleEvent(textPayload("/resume 9", "om_resume_missing"));

    expect(replies).toEqual([
      "还没有可恢复的历史 session。",
      "当前没有可查看的 session。",
      "没有找到第 9 个 session。",
      "没有找到对应的历史 session。",
    ]);
  });

  test("relays assistant progress once, tracks it, and manages Typing reaction", async () => {
    const replies: string[] = [];
    const reactions: string[] = [];
    const channel = new FeishuChannel({
      account: { ...account("/tmp/work"), sendProgressReplies: true },
      outputQuietMs: 1000,
      messageClient: {
        async replyText(input) {
          replies.push(input.text);
        },
        async sendText() {},
      },
      reactionClient: {
        async addTypingReaction(input) {
          reactions.push(`add:${input.messageId}`);
          return { reactionId: "reaction-1" };
        },
        async removeTypingReaction(input) {
          reactions.push(`remove:${input.messageId}:${input.reactionId}`);
        },
      },
      router: {
        async send(_conversationKey, _prompt, _images, onOutput, onProgress) {
          onProgress?.({ type: "tool_start", name: "command_execution" });
          onProgress?.({ type: "assistant_text", text: "实时答案" });
          await onOutput?.("实时答案");
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("执行任务", "om_progress"));

    expect(replies).toEqual(["实时答案"]);
    expect(reactions).toEqual([
      "add:om_progress",
      "remove:om_progress:reaction-1",
    ]);
    expect(channel.getStatus()).toMatchObject({
      activeSessions: 0,
      sendProgressReplies: true,
      recentMessages: [
        {
          messageId: "om_progress",
          stage: "completed",
          output: "实时答案",
          progressEvents: [
            { type: "tool_start", name: "command_execution" },
            { type: "assistant_text", text: "实时答案" },
          ],
        },
      ],
    });
  });

  test("reports invalid Codex return-file directives", async () => {
    const replies: string[] = [];
    const channel = new FeishuChannel({
      account: account("/tmp/work"),
      messageClient: {
        async replyText(input) {
          replies.push(input.text);
        },
        async sendText() {},
      },
      router: {
        async send(_conversationKey, _prompt, _images, onOutput) {
          await onOutput?.("[[codex:file:missing.html]]");
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("生成文件", "om_missing_file"));

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("文件回传失败");
    expect(replies[0]).toContain("missing.html");
  });

  test("hides return-file directives from progress replies", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-progress-file-"));
    const filePath = join(cwd, "result.html");
    writeFileSync(filePath, "result");
    const replies: string[] = [];
    const files: string[] = [];
    const finalText = "页面已生成。\n[[codex:file:result.html]]";
    const channel = new FeishuChannel({
      account: { ...account(cwd), sendProgressReplies: true },
      outputQuietMs: 1000,
      messageClient: {
        async replyText(input) {
          replies.push(input.text);
        },
        async sendText() {},
        async replyFile(input) {
          files.push(input.filePath);
        },
      },
      router: {
        async send(_conversationKey, _prompt, _images, onOutput, onProgress) {
          onProgress?.({ type: "assistant_text", text: finalText });
          await onOutput?.(finalText);
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("生成页面", "om_progress_file"));

    expect(replies).toEqual(["页面已生成。"]);
    expect(files).toEqual([filePath]);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("preserves whitespace across assistant progress fragments", async () => {
    const replies: string[] = [];
    const channel = new FeishuChannel({
      account: { ...account("/tmp/work"), sendProgressReplies: true },
      outputQuietMs: 1000,
      messageClient: {
        async replyText(input) {
          replies.push(input.text);
        },
        async sendText() {},
      },
      router: {
        async send(_conversationKey, _prompt, _images, onOutput, onProgress) {
          onProgress?.({ type: "assistant_text", text: "实时 " });
          onProgress?.({ type: "assistant_text", text: "答案" });
          await onOutput?.("实时 答案");
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("流式输出", "om_progress_space"));

    expect(replies).toEqual(["实时 答案"]);
  });

  test("deduplicates messages only within the configured TTL", async () => {
    let now = 0;
    let routed = 0;
    const channel = new FeishuChannel({
      account: { ...account("/tmp/work"), messageDedupeTtlMs: 100 },
      now: () => now,
      router: {
        async send() {
          routed += 1;
        },
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
      },
    });

    await channel.handleEvent(textPayload("同一条消息", "om_dedupe"));
    now = 50;
    await channel.handleEvent(textPayload("同一条消息", "om_dedupe"));
    now = 101;
    await channel.handleEvent(textPayload("同一条消息", "om_dedupe"));

    expect(routed).toBe(2);
  });

  test("updates progress replies at runtime and exposes connection checks", async () => {
    const defaults: unknown[] = [];
    const channel = new FeishuChannel({
      account: {
        ...account("/tmp/work"),
        model: "gpt-old",
        reasoningEffort: "high",
        fast: true,
        verbosity: "low",
      },
      messageClient: {
        async replyText() {},
        async sendText() {},
        async testConnection() {
          return {
            ok: true,
            latencyMs: 12,
            checks: [{ name: "tenant_access_token", ok: true }],
          };
        },
      },
      router: {
        async send() {},
        resetSession() {},
        stopSession: () => true,
        stopAll() {},
        getStatus: () => ({ running: false }),
        updateDefaults(settings) {
          defaults.push(settings);
        },
      },
    });

    channel.updateConfig({
      sendProgressReplies: true,
      model: "gpt-new",
      reasoningEffort: "low",
      fast: false,
      verbosity: "high",
    });

    expect(channel.getStatus()).toMatchObject({
      sendProgressReplies: true,
      model: "gpt-new",
      reasoningEffort: "low",
      fast: false,
      verbosity: "high",
    });
    expect(defaults).toEqual([
      { model: "gpt-new", reasoningEffort: "low", fast: false, verbosity: "high" },
    ]);
    expect(await channel.testConnection()).toMatchObject({ ok: true, latencyMs: 12 });
  });
});

function account(cwd: string) {
  return {
    id: "test",
    enabled: true,
    appId: "cli_a",
    appSecret: "secret",
    botOpenId: "ou_bot",
    domain: "feishu" as const,
    cwd,
    historyBaseDir: join(cwd, "history"),
    sendProgressReplies: false,
  };
}

function textPayload(text: string, messageId: string) {
  return {
    event: {
      message: {
        message_id: messageId,
        chat_id: "oc_1",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text }),
        mentions: [],
      },
      sender: {
        sender_name: "东豪",
        sender_id: { open_id: "ou_sender" },
      },
    },
  };
}

function archivedSession(input: {
  archiveId: string;
  sessionId: string;
  current: boolean;
  preview: string;
}) {
  return {
    ...input,
    conversationKey: "dm:ou_sender",
    cwd: "/tmp/work",
    model: "gpt-5",
    nativeSessionStarted: true,
    createdAt: "2026-07-19T00:00:00.000Z",
    lastActiveAt: "2026-07-20T00:00:00.000Z",
    messageCount: 4,
  };
}

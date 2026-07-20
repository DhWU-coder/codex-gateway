import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CodexSessionRouter } from "../src/session/router.js";
import type { CodexRunner } from "../src/codex/runner.js";

describe("Codex session router", () => {
  test("persists a returned Codex session id and resumes on the next message", async () => {
    const calls: Array<{ prompt: string; sessionId?: string; resume: boolean }> = [];
    const runner: CodexRunner = async (input) => {
      calls.push({
        prompt: input.prompt,
        sessionId: input.sessionId,
        resume: Boolean(input.resume),
      });
      return {
        text: calls.length === 1 ? "第一条回复" : "第二条回复",
        sessionId: calls.length === 1 ? "codex-session-1" : input.sessionId,
      };
    };
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      model: "gpt-5",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-")),
      runner,
      onOutput: () => undefined,
    });

    await router.send("dm:ou_sender", "你好");
    await router.send("dm:ou_sender", "继续");

    expect(calls).toEqual([
      { prompt: "你好", sessionId: undefined, resume: false },
      { prompt: "继续", sessionId: "codex-session-1", resume: true },
    ]);
  });

  test("falls back to recent JSONL history when Codex does not return a session id", async () => {
    const prompts: string[] = [];
    const runner: CodexRunner = async (input) => {
      prompts.push(input.prompt);
      return {
        text: prompts.length === 1 ? "第一条回复" : "第二条回复",
      };
    };
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      model: "gpt-5",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-history-")),
      runner,
      onOutput: () => undefined,
    });

    await router.send("dm:ou_sender", "你好");
    await router.send("dm:ou_sender", "继续");

    expect(prompts[1]).toContain("用户：你好");
    expect(prompts[1]).toContain("助手：第一条回复");
    expect(prompts[1]).toContain("当前用户消息：\n继续");
  });

  test("keeps queued outputs bound to each request callback", async () => {
    let runCount = 0;
    const outputs: string[] = [];
    const runner: CodexRunner = async (input) => {
      runCount += 1;
      return {
        text: runCount === 1 ? "第一条回复" : "第二条回复",
        sessionId: input.sessionId ?? "codex-session-1",
      };
    };
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-output-")),
      runner,
    });

    const first = router.send("dm:ou_sender", "第一条", [], (text) => {
      outputs.push(`om_1:${text}`);
    });
    const second = router.send("dm:ou_sender", "第二条", [], (text) => {
      outputs.push(`om_2:${text}`);
    });
    await Promise.all([first, second]);

    expect(outputs).toEqual(["om_1:第一条回复", "om_2:第二条回复"]);
  });

  test("keeps the previous archive when resetting to a new session", async () => {
    let callCount = 0;
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      model: "gpt-5",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-reset-")),
      createArchiveId: createIdFactory("archive-one", "archive-two"),
      runner: async () => {
        callCount += 1;
        return { text: `回复 ${callCount}`, sessionId: `codex-${callCount}` };
      },
    });

    await router.send("dm:ou_sender", "第一项任务");
    router.resetSession("dm:ou_sender");
    await router.send("dm:ou_sender", "第二项任务");

    expect(router.listArchivedSessions("dm:ou_sender")).toEqual([
      expect.objectContaining({
        archiveId: "archive-two",
        sessionId: "codex-2",
        current: true,
        messageCount: 2,
      }),
      expect.objectContaining({
        archiveId: "archive-one",
        sessionId: "codex-1",
        current: false,
        messageCount: 2,
      }),
    ]);
  });

  test("resumes a selected archived Codex session", async () => {
    const calls: Array<{ prompt: string; sessionId?: string; resume: boolean }> = [];
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      model: "gpt-5",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-resume-")),
      createArchiveId: createIdFactory("archive-one", "archive-two"),
      runner: async (input) => {
        calls.push({
          prompt: input.prompt,
          sessionId: input.sessionId,
          resume: Boolean(input.resume),
        });
        return {
          text: `回复 ${calls.length}`,
          sessionId: input.sessionId ?? `codex-${calls.length}`,
        };
      },
    });

    await router.send("dm:ou_sender", "第一项任务");
    router.resetSession("dm:ou_sender");
    await router.send("dm:ou_sender", "第二项任务");

    const resumed = router.resumeArchivedSession("dm:ou_sender", 2);
    await router.send("dm:ou_sender", "继续第一项任务");

    expect(resumed).toMatchObject({
      ok: true,
      archiveId: "archive-one",
      sessionId: "codex-1",
    });
    expect(calls.at(-1)).toEqual({
      prompt: "继续第一项任务",
      sessionId: "codex-1",
      resume: true,
    });
  });

  test("forks archived messages into a fresh Codex session", async () => {
    const calls: Array<{ prompt: string; sessionId?: string; resume: boolean }> = [];
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      model: "gpt-5",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-fork-")),
      createArchiveId: createIdFactory("archive-source", "archive-empty", "archive-fork"),
      runner: async (input) => {
        calls.push({
          prompt: input.prompt,
          sessionId: input.sessionId,
          resume: Boolean(input.resume),
        });
        return {
          text: calls.length === 1 ? "已有方案" : "分支方案",
          sessionId: input.sessionId ?? `codex-${calls.length}`,
        };
      },
    });

    await router.send("dm:ou_sender", "原始需求");
    router.resetSession("dm:ou_sender");

    const forked = router.forkArchivedSession("dm:ou_sender", 2);
    await router.send("dm:ou_sender", "换一种实现");

    expect(forked).toMatchObject({
      ok: true,
      archiveId: "archive-fork",
      forkedFrom: "archive-source",
    });
    expect(calls.at(-1)?.resume).toBe(false);
    expect(calls.at(-1)?.sessionId).toBeUndefined();
    expect(calls.at(-1)?.prompt).toContain("用户：原始需求");
    expect(calls.at(-1)?.prompt).toContain("助手：已有方案");
    expect(calls.at(-1)?.prompt).toContain("当前用户消息：\n换一种实现");
  });

  test("summarizes archived sessions and reuses the message-count cache", async () => {
    let summaryCalls = 0;
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      model: "gpt-5",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-summary-")),
      createArchiveId: createIdFactory("archive-summary"),
      runner: async (input) => {
        if (input.prompt.startsWith("总结以下飞书历史 session")) {
          summaryCalls += 1;
          return {
            text: '{"topic":"网关开发","keyInfo":"补齐会话命令","recentAction":"等待测试"}',
          };
        }
        return { text: "已经记录", sessionId: "codex-summary" };
      },
    });
    await router.send("dm:ou_sender", "补齐会话管理");

    const first = await router.summarizeArchivedSessions("dm:ou_sender", "all");
    const second = await router.summarizeArchivedSessions("dm:ou_sender", 1);

    expect(first[0].aiSummary).toMatchObject({
      topic: "网关开发",
      keyInfo: "补齐会话命令",
      recentAction: "等待测试",
      messageCount: 2,
    });
    expect(second[0].aiSummary).toEqual(first[0].aiSummary);
    expect(summaryCalls).toBe(1);
  });

  test("exposes current archive details with its messages", async () => {
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      model: "gpt-5",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-detail-")),
      createArchiveId: createIdFactory("archive-detail"),
      runner: async () => ({ text: "详细回复", sessionId: "codex-detail" }),
    });
    await router.send("dm:ou_sender", "详细问题");

    expect(router.getCurrentArchivedSession("dm:ou_sender")).toMatchObject({
      archiveId: "archive-detail",
      current: true,
    });
    expect(router.getArchivedSessionDetail("dm:ou_sender", 1)?.messages.map((item) => item.text)).toEqual([
      "详细问题",
      "详细回复",
    ]);
  });

  test("stops an active run without rejecting or starting queued messages", async () => {
    let calls = 0;
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const router = new CodexSessionRouter({
      cwd: "/tmp/work",
      historyBaseDir: mkdtempSync(join(tmpdir(), "codex-gateway-router-stop-")),
      runner: async (input) => {
        calls += 1;
        notifyStarted?.();
        return new Promise((resolve, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(new Error("Codex session stopped")),
            { once: true }
          );
        });
      },
    });

    const first = router.send("dm:ou_sender", "正在执行");
    await started;
    const queued = router.send("dm:ou_sender", "排队消息");

    expect(router.resumeArchivedSession("dm:ou_sender", 1)).toEqual({
      ok: false,
      message: "当前会话仍在处理中，请等待完成或先发送 /stop。",
    });
    expect(router.forkArchivedSession("dm:ou_sender", 1)).toEqual({
      ok: false,
      message: "当前会话仍在处理中，请等待完成或先发送 /stop。",
    });
    expect(router.stopSession("dm:ou_sender")).toBe(true);
    await expect(first).resolves.toBeUndefined();
    await expect(queued).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});

function createIdFactory(...ids: string[]): () => string {
  return () => ids.shift()!;
}

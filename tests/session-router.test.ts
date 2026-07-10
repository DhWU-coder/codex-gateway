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
});

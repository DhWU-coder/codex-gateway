import { describe, expect, test } from "bun:test";
import type { AppServerNotification } from "../src/codex/app-server-types.js";
import { CodexAppServerRuntime } from "../src/codex/app-server-runtime.js";
import type { CodexProgressEvent } from "../src/codex/json-events.js";

describe("Codex App Server Runtime", () => {
  test("新建 Thread 并发送结构化输入和运行参数", async () => {
    const client = new FakeAppServerClient();
    const runtime = new CodexAppServerRuntime(client);
    const progress: CodexProgressEvent[] = [];
    client.onRequest = async (method, params) => {
      if (method === "thread/start") {
        expect(params).toMatchObject({
          cwd: "/tmp/work",
          model: "gpt-test",
          serviceTier: "fast",
          sandbox: "workspace-write",
        });
        return { thread: { id: "thread-new" } };
      }
      if (method === "turn/start") {
        expect(params).toMatchObject({
          threadId: "thread-new",
          effort: "high",
          serviceTier: "fast",
          input: [
            { type: "text", text: "检查项目", text_elements: [] },
            { type: "skill", name: "review", path: "/tmp/skills/review" },
            { type: "mention", name: "README.md", path: "/tmp/work/README.md" },
          ],
          additionalContext: {
            browser: { value: "Browser", kind: "application" },
          },
        });
        queueMicrotask(() => {
          client.notify("item/started", {
            threadId: "thread-new",
            turnId: "turn-new",
            startedAtMs: 1,
            item: {
              type: "userMessage",
              id: "user-1",
              content: [{ type: "text", text: "检查项目" }],
            },
          });
          client.notify("item/completed", {
            threadId: "thread-new",
            turnId: "turn-new",
            completedAtMs: 1,
            item: {
              type: "user_message",
              id: "user-1",
              content: [{ type: "text", text: "检查项目" }],
            },
          });
          client.notify("item/completed", {
            threadId: "thread-new",
            turnId: "turn-new",
            completedAtMs: 2,
            item: {
              type: "agentMessage",
              id: "commentary-1",
              text: "我先检查文件。",
              phase: "commentary",
            },
          });
          client.notify("item/started", {
            threadId: "thread-new",
            turnId: "turn-new",
            startedAtMs: 3,
            item: {
              type: "commandExecution",
              id: "tool-1",
              command: "pwd",
              cwd: "/tmp/work",
              status: "inProgress",
            },
          });
          client.notify("item/completed", {
            threadId: "thread-new",
            turnId: "turn-new",
            completedAtMs: 4,
            item: {
              type: "commandExecution",
              id: "tool-1",
              command: "pwd",
              cwd: "/tmp/work",
              status: "completed",
              aggregatedOutput: "/tmp/work",
              durationMs: 12,
            },
          });
          client.notify("item/completed", {
            threadId: "thread-new",
            turnId: "turn-new",
            completedAtMs: 5,
            item: {
              type: "agentMessage",
              id: "final-1",
              text: "检查完成。",
              phase: "final_answer",
            },
          });
          client.notify("turn/completed", {
            threadId: "thread-new",
            turn: {
              id: "turn-new",
              status: "completed",
              items: [],
              error: null,
            },
          });
        });
        return { turn: { id: "turn-new", status: "inProgress", items: [] } };
      }
      throw new Error(`未处理请求：${method}`);
    };

    const result = await runtime.run({
      cwd: "/tmp/work",
      prompt: "检查项目",
      model: "gpt-test",
      reasoningEffort: "high",
      fast: true,
      sandbox: "workspace-write",
      structuredInput: [
        { type: "text", text: "检查项目" },
        { type: "skill", name: "review", path: "/tmp/skills/review" },
        { type: "mention", name: "README.md", path: "/tmp/work/README.md" },
      ],
      additionalContext: {
        browser: { value: "Browser", kind: "application" },
      },
      onProgress: (event) => progress.push(event),
    });

    expect(result).toMatchObject({
      text: "检查完成。",
      sessionId: "thread-new",
      turnId: "turn-new",
    });
    expect(progress).toEqual([
      {
        type: "assistant_text",
        text: "我先检查文件。",
        phase: "commentary",
      },
      {
        type: "tool_start",
        name: "commandExecution",
        input: { command: "pwd", cwd: "/tmp/work" },
        toolUseId: "tool-1",
      },
      {
        type: "tool_result",
        name: "commandExecution",
        text: "/tmp/work",
        toolUseId: "tool-1",
        durationMs: 12,
      },
    ]);
  });

  test("恢复 Thread 并保持不同会话通知隔离", async () => {
    const client = new FakeAppServerClient();
    const runtime = new CodexAppServerRuntime(client);
    const progressA: CodexProgressEvent[] = [];
    const progressB: CodexProgressEvent[] = [];
    client.onRequest = async (method, params) => {
      const input = params as Record<string, unknown>;
      if (method === "thread/resume") {
        return { thread: { id: input.threadId } };
      }
      if (method === "turn/start") {
        const threadId = String(input.threadId);
        const turnId = `turn-${threadId}`;
        queueMicrotask(() => {
          client.notify("item/completed", {
            threadId,
            turnId,
            completedAtMs: 1,
            item: {
              type: "reasoning",
              id: `reasoning-${threadId}`,
              summary: [`分析 ${threadId}`],
              content: [],
            },
          });
          client.notify("item/completed", {
            threadId,
            turnId,
            completedAtMs: 2,
            item: {
              type: "agentMessage",
              id: `final-${threadId}`,
              text: `完成 ${threadId}`,
              phase: "final_answer",
            },
          });
          client.notify("turn/completed", {
            threadId,
            turn: { id: turnId, status: "completed", items: [], error: null },
          });
        });
        return { turn: { id: turnId, status: "inProgress", items: [] } };
      }
      throw new Error(`未处理请求：${method}`);
    };

    const [resultA, resultB] = await Promise.all([
      runtime.run({
        cwd: "/tmp/a",
        prompt: "A",
        sessionId: "a",
        resume: true,
        onProgress: (event) => progressA.push(event),
      }),
      runtime.run({
        cwd: "/tmp/b",
        prompt: "B",
        sessionId: "b",
        resume: true,
        onProgress: (event) => progressB.push(event),
      }),
    ]);

    expect(resultA.text).toBe("完成 a");
    expect(resultB.text).toBe("完成 b");
    expect(progressA).toEqual([{ type: "reasoning", text: "分析 a" }]);
    expect(progressB).toEqual([{ type: "reasoning", text: "分析 b" }]);
  });

  test("AbortSignal 中止当前 Turn", async () => {
    const client = new FakeAppServerClient();
    const runtime = new CodexAppServerRuntime(client);
    const controller = new AbortController();
    client.onRequest = async (method) => {
      if (method === "thread/start") return { thread: { id: "thread-stop" } };
      if (method === "turn/start") {
        queueMicrotask(() => controller.abort());
        return { turn: { id: "turn-stop", status: "inProgress", items: [] } };
      }
      if (method === "turn/interrupt") {
        queueMicrotask(() => {
          client.notify("turn/completed", {
            threadId: "thread-stop",
            turn: { id: "turn-stop", status: "interrupted", items: [], error: null },
          });
        });
        return {};
      }
      throw new Error(`未处理请求：${method}`);
    };

    await expect(
      runtime.run({
        cwd: "/tmp/work",
        prompt: "停止",
        signal: controller.signal,
      })
    ).rejects.toThrow("已停止");
    expect(client.calls.some((call) => call.method === "turn/interrupt")).toBe(true);
  });

  test("提供目录、文件搜索和 Thread 窄用途操作", async () => {
    const client = new FakeAppServerClient();
    const runtime = new CodexAppServerRuntime(client);
    client.onRequest = async (method, params) => {
      if (method === "model/list") return { data: [{ model: "gpt-test" }] };
      if (method === "skills/list") return { data: [{ cwd: "/tmp/work", skills: [] }] };
      if (method === "plugin/installed") return { marketplaces: [] };
      if (method === "app/installed") return { apps: [{ id: "browser" }] };
      if (method === "fuzzyFileSearch") return { files: [{ path: "README.md" }] };
      if (method === "thread/fork") return { thread: { id: "thread-fork" } };
      if (method === "permissionProfile/list") {
        return {
          data: [
            { id: "read-only", allowed: true },
            { id: "danger-full-access", allowed: true },
          ],
        };
      }
      return { ok: true, params };
    };

    expect(await runtime.listModels()).toEqual([{ model: "gpt-test" }]);
    expect(await runtime.listSkills("/tmp/work")).toHaveLength(1);
    expect(await runtime.listInstalledPlugins("/tmp/work")).toEqual([]);
    expect(await runtime.listInstalledApps()).toEqual([{ id: "browser" }]);
    expect(await runtime.searchFiles("/tmp/work", "read")).toEqual([
      { path: "README.md" },
    ]);
    expect(await runtime.forkThread("thread-1", "/tmp/work")).toBe("thread-fork");
    expect(await runtime.listPermissionProfiles("/tmp/work")).toEqual([
      { id: "read-only", allowed: true },
    ]);

    await runtime.setThreadName("thread-1", "新名称");
    await runtime.deleteThread("thread-1");
    await runtime.executeThreadAction({
      type: "goal-set",
      threadId: "thread-1",
      objective: "完成任务",
    });
    expect(client.calls.map((call) => call.method)).toContain("thread/goal/set");
  });

  test("旧 Thread 不存在时应用目录自动回退到全局目录", async () => {
    const client = new FakeAppServerClient();
    const runtime = new CodexAppServerRuntime(client);
    client.onRequest = async (method, params) => {
      if (method !== "app/installed") return {};
      const input = params as { threadId?: string | null };
      if (input.threadId) throw new Error("thread not found: thread-old");
      return { apps: [{ id: "browser" }] };
    };

    expect(await runtime.listInstalledApps("thread-old")).toEqual([
      { id: "browser" },
    ]);
    expect(
      client.calls
        .filter((call) => call.method === "app/installed")
        .map((call) => call.params)
    ).toEqual([
      { threadId: "thread-old", forceRefresh: false },
      { threadId: null, forceRefresh: false },
    ]);
  });
});

class FakeAppServerClient {
  ready = true;
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(notification: AppServerNotification) => void>();
  onRequest: (method: string, params: unknown) => Promise<unknown> = async () => ({});

  async start(): Promise<void> {}

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params });
    return (await this.onRequest(method, params)) as T;
  }

  subscribe(listener: (notification: AppServerNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(method: string, params: unknown): void {
    for (const listener of this.listeners) listener({ method, params });
  }
}

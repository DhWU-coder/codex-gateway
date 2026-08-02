import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { CodexModelOption } from "../src/codex/model-catalog.js";
import type { CodexAppServerRuntime } from "../src/codex/app-server-runtime.js";
import type { CodexRunInput, CodexRunner } from "../src/codex/runner.js";
import type { CodexConfig } from "../src/config.js";
import { WebChatEventHub } from "../src/web-chat/event-hub.js";
import { WebChatFileRepository } from "../src/web-chat/files.js";
import { WebChatManager } from "../src/web-chat/manager.js";
import { WebChatSessionStore } from "../src/web-chat/session-store.js";
import { WebChatUserStore } from "../src/web-chat/user-store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat Manager", () => {
  test("新 Session 按显式值、账户值和全局值的顺序继承运行参数", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const accountUser = await userStore.create({
      username: "account-defaults",
      password: "password-123",
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: false,
      verbosity: "low",
    });
    const globalUser = await userStore.create({
      username: "global-defaults",
      password: "password-456",
    });
    const manager = createManager({
      gatewayHome,
      userStore,
      codex: {
        ...codexConfig(),
        reasoningEffort: "medium",
        fast: true,
        verbosity: "high",
      },
    });

    expect(manager.createSession(accountUser.id, { model: undefined })).toMatchObject({
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: false,
      verbosity: "low",
    });
    expect(
      manager.createSession(accountUser.id, {
        model: "gpt-standard",
        reasoningEffort: "low",
        fast: false,
        verbosity: "medium",
      })
    ).toMatchObject({
      model: "gpt-standard",
      reasoningEffort: "low",
      fast: false,
      verbosity: "medium",
    });
    expect(manager.createSession(globalUser.id)).toMatchObject({
      model: "gpt-standard",
      reasoningEffort: "medium",
      fast: true,
      verbosity: "high",
    });
  });

  test("账户默认模型配置返回继承值并只同步空白 Session", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const user = await userStore.create({
      username: "account-runtime",
      password: "password-123",
    });
    const manager = createManager({
      gatewayHome,
      userStore,
      codex: {
        ...codexConfig(),
        reasoningEffort: "medium",
        fast: false,
      },
    });
    const blank = manager.createSession(user.id);
    const populated = manager.createSession(user.id);
    await manager.sendMessage(user.id, populated.id, { text: "保留会话配置" });

    expect(await manager.getAccountSettings(user.id)).toMatchObject({
      defaults: {
        model: null,
        reasoningEffort: null,
        fast: null,
      },
      effective: {
        model: "gpt-standard",
        reasoningEffort: "medium",
        fast: false,
      },
      inherited: {
        model: "gpt-standard",
        reasoningEffort: "medium",
        fast: false,
      },
    });

    const updated = await manager.updateAccountSettings(user.id, {
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: true,
    });

    expect(updated).toMatchObject({
      user: {
        id: user.id,
        model: "gpt-fast",
        reasoningEffort: "high",
        fast: true,
      },
      defaults: {
        model: "gpt-fast",
        reasoningEffort: "high",
        fast: true,
      },
      effective: {
        model: "gpt-fast",
        reasoningEffort: "high",
        fast: true,
      },
      inherited: {
        model: "gpt-standard",
        reasoningEffort: "medium",
        fast: false,
      },
    });
    expect(manager.getSession(user.id, blank.id)).toMatchObject({
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: true,
    });
    expect(manager.getSession(user.id, populated.id)).toMatchObject({
      model: "gpt-standard",
      reasoningEffort: "medium",
      fast: false,
    });
    expect(manager.createSession(user.id)).toMatchObject({
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: true,
    });
  });

  test("账户默认模型配置校验失败时保持原值", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const user = await userStore.create({
      username: "account-runtime-validation",
      password: "password-123",
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: true,
    });
    const manager = createManager({ gatewayHome, userStore });

    await expect(
      manager.updateAccountSettings(user.id, { model: "missing-model" })
    ).rejects.toThrow("模型 missing-model 不在当前模型目录中");
    await expect(
      manager.updateAccountSettings(user.id, {
        model: "gpt-standard",
        reasoningEffort: "high",
        fast: false,
      })
    ).rejects.toThrow("模型 gpt-standard 不支持 Effort high");
    await expect(
      manager.updateAccountSettings(user.id, {
        model: "gpt-standard",
        reasoningEffort: "medium",
        fast: true,
      })
    ).rejects.toThrow("模型 gpt-standard 不支持 Fast");

    expect(await manager.getAccountSettings(user.id)).toMatchObject({
      defaults: {
        model: "gpt-fast",
        reasoningEffort: "high",
        fast: true,
      },
    });
  });

  test("旧 Session 缺失运行参数时 Runner 继承账户和全局默认值", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const user = await userStore.create({
      username: "legacy-session",
      password: "password-123",
      model: "gpt-fast",
    });
    let received: CodexRunInput | undefined;
    const manager = createManager({
      gatewayHome,
      userStore,
      codex: {
        ...codexConfig(),
        reasoningEffort: "high",
        fast: true,
        verbosity: "high",
      },
      runner: async (input) => {
        received = input;
        return { text: "完成", sessionId: "codex-legacy" };
      },
    });
    const session = manager.sessionStore.create(user.id, {});

    await manager.sendMessage(user.id, session.id, { text: "继续旧会话" });

    expect(received).toMatchObject({
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: true,
      verbosity: "high",
    });
  });

  test("热更新 Codex 默认值会同步空白 Session 并保留已有内容 Session", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const user = await userStore.create({
      username: "runtime-reload",
      password: "password-123",
    });
    const initialCodex = {
      ...codexConfig(),
      reasoningEffort: "high" as const,
      fast: true,
    };
    let received: CodexRunInput | undefined;
    const manager = createManager({
      gatewayHome,
      userStore,
      codex: initialCodex,
      runner: async (input) => {
        received = input;
        return { text: "完成", sessionId: "codex-reloaded" };
      },
    });
    const blank = manager.createSession(user.id);
    const populated = manager.createSession(user.id);
    manager.listMessages(user.id, blank.id, { limit: 20 });
    await manager.sendMessage(user.id, populated.id, { text: "保留当前设置" });

    manager.updateCodexConfig({
      ...initialCodex,
      reasoningEffort: "low",
      fast: false,
    });

    expect(manager.getSession(user.id, blank.id)).toMatchObject({
      reasoningEffort: "low",
      fast: false,
    });
    expect(manager.getSession(user.id, populated.id)).toMatchObject({
      reasoningEffort: "high",
      fast: true,
    });
    expect(manager.createSession(user.id)).toMatchObject({
      reasoningEffort: "low",
      fast: false,
    });
    await manager.sendMessage(user.id, blank.id, { text: "使用最新默认值" });
    expect(received).toMatchObject({
      reasoningEffort: "low",
      fast: false,
    });
  });

  test("服务重启会用当前 Codex 默认值同步遗留空白 Session", async () => {
    const gatewayHome = createRoot();
    const firstUserStore = new WebChatUserStore({ gatewayHome });
    const user = await firstUserStore.create({
      username: "restart-runtime",
      password: "password-123",
    });
    const initialCodex = {
      ...codexConfig(),
      reasoningEffort: "high" as const,
      fast: true,
    };
    const firstManager = createManager({
      gatewayHome,
      userStore: firstUserStore,
      codex: initialCodex,
    });
    const blank = firstManager.createSession(user.id);
    const populated = firstManager.createSession(user.id);
    await firstManager.sendMessage(user.id, populated.id, { text: "保留旧配置" });

    const restarted = createManager({
      gatewayHome,
      userStore: new WebChatUserStore({ gatewayHome }),
      codex: {
        ...initialCodex,
        reasoningEffort: "low",
        fast: false,
      },
    });

    expect(restarted.getSession(user.id, blank.id)).toMatchObject({
      reasoningEffort: "low",
      fast: false,
    });
    expect(restarted.getSession(user.id, populated.id)).toMatchObject({
      reasoningEffort: "high",
      fast: true,
    });
  });

  test("纯附件消息保留空文本并向 Codex 提交内部附件提示", async () => {
    let received: CodexRunInput | undefined;
    const { manager, user } = await fixture({
      runner: async (input) => {
        received = input;
        return { text: "附件已处理", sessionId: "codex-attachment-only" };
      },
    });
    const session = manager.createSession(user.id);
    const upload = manager.uploadFile(user.id, session.id, {
      name: "需求说明.txt",
      mimeType: "text/plain",
      data: new TextEncoder().encode("附件内容"),
    });

    await manager.sendMessage(user.id, session.id, {
      text: "",
      fileIds: [upload.id],
    });

    expect(manager.getSession(user.id, session.id)?.title).toBe("需求说明.txt");
    expect(received?.prompt).toContain("请查看并处理用户提供的附件。");
    expect(received?.prompt).toContain("需求说明.txt");
    expect(
      manager.listMessages(user.id, session.id, { limit: 20 })?.messages[0]
    ).toMatchObject({
      role: "user",
      text: "",
      attachments: [expect.objectContaining({ name: "需求说明.txt" })],
    });
  });

  test("同一 Session 串行，不同 Session 无应用层并发上限", async () => {
    const gates: Array<() => void> = [];
    const calls: CodexRunInput[] = [];
    const { manager, user } = await fixture({
      runner: async (input) => {
        calls.push(input);
        await new Promise<void>((resolve) => gates.push(resolve));
        return { text: `完成 ${calls.indexOf(input)}`, sessionId: `codex-${calls.indexOf(input)}` };
      },
    });
    const firstSession = manager.createSession(user.id);
    const sameFirst = manager.sendMessage(user.id, firstSession.id, { text: "第一条" });
    const sameSecond = manager.sendMessage(user.id, firstSession.id, { text: "第二条" });
    await waitFor(() => calls.length === 1);
    expect(calls).toHaveLength(1);

    gates.shift()?.();
    await waitFor(() => calls.length === 2);
    gates.shift()?.();
    await Promise.all([sameFirst, sameSecond]);

    calls.splice(0);
    gates.splice(0);
    const sessions = Array.from({ length: 8 }, () => manager.createSession(user.id));
    const concurrent = sessions.map((session, index) =>
      manager.sendMessage(user.id, session.id, { text: `并发 ${index}` })
    );
    await waitFor(() => calls.length === 8);
    expect(calls).toHaveLength(8);
    for (const release of gates.splice(0)) release();
    await Promise.all(concurrent);
  });

  test("Web Runner 强制受限工作区配置并保留共享联网设置", async () => {
    let received: CodexRunInput | undefined;
    const { manager, user } = await fixture({
      codex: {
        ...codexConfig(),
        sandbox: "danger-full-access",
        dangerouslyBypassApprovalsAndSandbox: true,
        extraArgs: ["--dangerous-test"],
      },
      runner: async (input) => {
        received = input;
        return { text: "完成", sessionId: "codex-secure" };
      },
    });
    const session = manager.createSession(user.id);

    await manager.sendMessage(user.id, session.id, { text: "检查权限" });

    expect(received).toMatchObject({
      cwd: user.workspacePath,
      sandbox: "workspace-write",
      dangerouslyBypassApprovalsAndSandbox: false,
      extraArgs: [],
      search: true,
      skipGitRepoCheck: true,
    });
  });

  test("公开事件过滤原始进度，管理员 tracker 保留完整过程", async () => {
    const { manager, user, eventHub } = await fixture({
      runner: async (input) => {
        input.onProgress?.({ type: "assistant_text", text: "正在整理" });
        input.onProgress?.({ type: "stderr", text: "内部警告" });
        input.onProgress?.({
          type: "tool_start",
          name: "command_execution",
          input: { command: "secret-command" },
        });
        writeFileSync(join(input.cwd, "report.html"), "<html></html>");
        return {
          text: "报告已完成\n[[codex:file:report.html]]",
          sessionId: "codex-files",
        };
      },
    });
    const session = manager.createSession(user.id);
    const upload = manager.uploadFile(user.id, session.id, {
      name: "source.csv",
      mimeType: "text/csv",
      data: new TextEncoder().encode("a,b\n1,2"),
    });

    await manager.sendMessage(user.id, session.id, {
      text: "生成报告",
      fileIds: [upload.id],
    });

    const events = eventHub.eventsSince(user.id, 0).events;
    expect(events.some((event) => event.type === "message.progress")).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("内部警告");
    expect(JSON.stringify(events)).not.toContain("secret-command");
    const tracked = manager.listAdminMessages(user.id)[0];
    expect(tracked?.progressEvents?.map((event) => event.type)).toEqual([
      "assistant_text",
      "stderr",
      "tool_start",
    ]);
    expect(tracked?.output).toBe("报告已完成");
    expect(tracked?.fileAttachments?.[0]?.name).toBe("report.html");

    const messages = manager.listMessages(user.id, session.id, { limit: 20 });
    expect(messages?.messages).toEqual([
      expect.objectContaining({
        role: "user",
        text: "生成报告",
        attachments: [expect.objectContaining({ id: upload.id })],
      }),
      expect.objectContaining({
        role: "assistant",
        text: "报告已完成",
        attachments: [expect.objectContaining({ name: "report.html" })],
      }),
    ]);
  });

  test("模型、Effort 和 Fast 按共享目录校验并持久化", async () => {
    const { manager, user } = await fixture();
    const session = manager.createSession(user.id);

    const updated = await manager.updateRuntime(user.id, session.id, {
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: true,
      verbosity: "high",
    });
    expect(updated).toMatchObject({
      model: "gpt-fast",
      reasoningEffort: "high",
      fast: true,
      verbosity: "high",
    });
    expect(await manager.listEfforts(user.id, session.id)).toEqual([
      "low",
      "high",
    ]);
    await expect(
      manager.updateRuntime(user.id, session.id, { reasoningEffort: "xhigh" })
    ).rejects.toThrow("不支持 Effort");
    await expect(
      manager.updateRuntime(user.id, session.id, { model: "missing" })
    ).rejects.toThrow("不在当前模型目录");
  });

  test("App Server 引用、Trace、命令和 Thread 生命周期完整接线", async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    let received: CodexRunInput | undefined;
    const appServerRuntime = {
      ready: true,
      runner: async (input: CodexRunInput) => {
        received = input;
        input.onProgress?.({
          type: "assistant_text",
          phase: "commentary",
          text: "先检查文件。",
        });
        input.onProgress?.({
          type: "tool_start",
          name: "commandExecution",
          toolUseId: "tool-1",
          input: { command: "pwd" },
        });
        input.onProgress?.({
          type: "tool_result",
          name: "commandExecution",
          toolUseId: "tool-1",
          text: "完成",
        });
        return {
          text: "最终回复",
          sessionId: "thread-app-server",
          turnId: "turn-app-server",
        };
      },
      listSkills: async () => [
        {
          cwd: "/tmp",
          skills: [
            {
              name: "review",
              description: "审查代码",
              path: "/opt/skills/review/SKILL.md",
              enabled: true,
            },
          ],
        },
      ],
      listInstalledPlugins: async () => [],
      listInstalledApps: async () => [],
      searchFiles: async () => [],
      setThreadName: async (threadId: string, name: string) => {
        calls.push({ method: "thread/name/set", input: { threadId, name } });
      },
      deleteThread: async (threadId: string) => {
        calls.push({ method: "thread/delete", input: { threadId } });
      },
      forkThread: async () => "thread-fork",
      listPermissionProfiles: async () => [
        { id: "workspace-write", allowed: true },
      ],
      executeThreadAction: async (input: unknown) => {
        calls.push({ method: "thread/action", input });
        return {};
      },
    } as unknown as CodexAppServerRuntime;
    const { manager, user } = await fixture({ appServerRuntime });
    const session = manager.createSession(user.id);
    const [skill] = await manager.listCapabilities(user.id, session.id);

    await manager.sendMessage(user.id, session.id, {
      text: "检查项目",
      references: [skill!.id],
    });

    expect(received?.structuredInput).toEqual([
      { type: "text", text: "检查项目" },
      {
        type: "skill",
        name: "review",
        path: "/opt/skills/review/SKILL.md",
      },
    ]);
    expect(manager.getSession(user.id, session.id)?.threadId).toBe(
      "thread-app-server"
    );
    expect(manager.listTraces(user.id, session.id)).toEqual([
      expect.objectContaining({
        threadId: "thread-app-server",
        turnId: "turn-app-server",
        status: "completed",
        entries: [
          expect.objectContaining({ type: "message" }),
          expect.objectContaining({ type: "tool_group" }),
        ],
      }),
    ]);

    await manager.executeCommand(user.id, session.id, {
      name: "goal",
      arguments: { value: "完成测试" },
    });
    await manager.executeCommand(user.id, session.id, {
      name: "plan",
      arguments: { value: "on" },
    });
    await manager.executeCommand(user.id, session.id, {
      name: "permissions",
      arguments: { value: "workspace-write" },
    });
    expect(manager.getSession(user.id, session.id)).toMatchObject({
      goal: "完成测试",
      planMode: true,
      permissionProfile: "workspace-write",
    });

    manager.renameSession(user.id, session.id, "新名称");
    await waitFor(() => calls.some((call) => call.method === "thread/name/set"));
    expect(manager.removeSession(user.id, session.id)).toBe(true);
    await waitFor(() => calls.some((call) => call.method === "thread/delete"));
  });

  test("Fork、重启恢复、停止和跨用户所有权均生效", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const firstUser = await userStore.create({
      username: "alice",
      password: "password-123",
    });
    const secondUser = await userStore.create({
      username: "bob",
      password: "password-456",
    });
    let stopRun = false;
    const runner: CodexRunner = async (input) => {
      if (!stopRun) return { text: "原始回答", sessionId: "codex-source" };
      return new Promise((resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(new Error("stopped")), {
          once: true,
        });
      });
    };
    const manager = createManager({ gatewayHome, userStore, runner });
    const source = manager.createSession(firstUser.id);
    await manager.sendMessage(firstUser.id, source.id, { text: "原始需求" });
    const fork = manager.forkSession(firstUser.id, source.id);
    expect(fork).not.toBeNull();
    expect(manager.listMessages(firstUser.id, fork!.id, { limit: 20 })?.messages).toHaveLength(2);
    expect(manager.getSession(secondUser.id, source.id)).toBeNull();
    expect(manager.listMessages(secondUser.id, source.id, { limit: 20 })).toBeNull();

    const rebuilt = createManager({ gatewayHome, userStore, runner });
    expect(rebuilt.listSessions(firstUser.id).map((item) => item.id)).toContain(source.id);
    expect(rebuilt.listMessages(firstUser.id, source.id, { limit: 20 })?.messages).toHaveLength(2);

    stopRun = true;
    const running = rebuilt.sendMessage(firstUser.id, source.id, { text: "长任务" });
    await waitFor(() => rebuilt.getSession(firstUser.id, source.id)?.running === true);
    expect(rebuilt.stopSession(firstUser.id, source.id)).toBe(true);
    await expect(running).resolves.toBeDefined();
    expect(rebuilt.getSession(firstUser.id, source.id)?.running).toBe(false);
  });

  test("重写用户消息会从目标之前创建独立分支并保留原会话", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const user = await userStore.create({
      username: "rewrite-owner",
      password: "password-123",
    });
    const calls: CodexRunInput[] = [];
    const manager = createManager({
      gatewayHome,
      userStore,
      runner: async (input) => {
        calls.push(input);
        return {
          text: calls.length === 1 ? "第一条回答" : calls.length === 2 ? "第二条回答" : "重写回答",
          sessionId: `codex-rewrite-${calls.length}`,
        };
      },
    });
    const source = manager.createSession(user.id, { title: "重写测试" });
    await manager.sendMessage(user.id, source.id, { text: "第一条问题" });
    const attachment = manager.uploadFile(user.id, source.id, {
      name: "rewrite.txt",
      mimeType: "text/plain",
      data: new TextEncoder().encode("rewrite attachment"),
    });
    await manager.sendMessage(user.id, source.id, {
      text: "第二条问题",
      fileIds: [attachment.id],
    });
    const sourceMessages = manager.listMessages(user.id, source.id, { limit: 20 })!.messages;
    const secondUserMessage = sourceMessages.find(
      (message) => message.role === "user" && message.text === "第二条问题"
    );

    const rewrite = manager.createRewriteBranch(
      user.id,
      source.id,
      secondUserMessage!.id!
    );
    expect(rewrite.session).toMatchObject({
      title: "重写测试（重写）",
      forkedFrom: source.id,
      threadId: undefined,
    });
    expect(rewrite.fileIds).toEqual([attachment.id]);
    expect(manager.listMessages(user.id, source.id, { limit: 20 })?.messages).toHaveLength(4);
    expect(manager.listMessages(user.id, rewrite.session.id, { limit: 20 })?.messages).toEqual(
      sourceMessages.slice(0, 2)
    );

    await manager.sendMessage(user.id, rewrite.session.id, {
      text: "修改后的第二条问题",
      fileIds: rewrite.fileIds,
    });
    expect(calls.at(-1)).toMatchObject({ resume: false, sessionId: undefined });
    expect(calls.at(-1)?.prompt).toContain("第一条问题");
    expect(calls.at(-1)?.prompt).toContain("第一条回答");
    expect(calls.at(-1)?.prompt).toContain("修改后的第二条问题");
    expect(manager.listMessages(user.id, rewrite.session.id, { limit: 20 })?.messages).toHaveLength(4);
  });

  test("批量删除会停止运行 Session、去重并隔离跨用户失败项", async () => {
    const gatewayHome = createRoot();
    const userStore = new WebChatUserStore({ gatewayHome });
    const firstUser = await userStore.create({
      username: "batch-owner",
      password: "password-123",
    });
    const secondUser = await userStore.create({
      username: "batch-other",
      password: "password-456",
    });
    const manager = createManager({
      gatewayHome,
      userStore,
      runner: async (input) =>
        new Promise((resolve) => {
          input.signal?.addEventListener(
            "abort",
            () => resolve({ text: "", sessionId: "stopped-session" }),
            { once: true }
          );
        }),
    });
    const running = manager.createSession(firstUser.id);
    const idle = manager.createSession(firstUser.id);
    const foreign = manager.createSession(secondUser.id);
    const pending = manager.sendMessage(firstUser.id, running.id, {
      text: "持续运行",
    });
    await waitFor(() => manager.getSession(firstUser.id, running.id)?.running === true);

    const result = manager.removeSessions(firstUser.id, [
      running.id,
      idle.id,
      idle.id,
      foreign.id,
    ]);

    expect(result.deletedIds).toEqual([running.id, idle.id]);
    expect(result.stoppedIds).toEqual([running.id]);
    expect(result.failed).toEqual([
      { sessionId: foreign.id, error: "Session 不存在。" },
    ]);
    expect(manager.getSession(firstUser.id, running.id)).toBeNull();
    expect(manager.getSession(firstUser.id, idle.id)).toBeNull();
    expect(manager.getSession(secondUser.id, foreign.id)).not.toBeNull();
    await expect(pending).resolves.toBeDefined();
  });
});

async function fixture(options?: {
  runner?: CodexRunner;
  codex?: CodexConfig;
  appServerRuntime?: CodexAppServerRuntime;
}) {
  const gatewayHome = createRoot();
  const userStore = new WebChatUserStore({ gatewayHome });
  const user = await userStore.create({
    username: "alice",
    password: "password-123",
    model: "gpt-standard",
  });
  const eventHub = new WebChatEventHub();
  return {
    user,
    eventHub,
    manager: createManager({
      gatewayHome,
      userStore,
      eventHub,
      runner: options?.runner,
      codex: options?.codex,
      appServerRuntime: options?.appServerRuntime,
    }),
  };
}

function createManager(input: {
  gatewayHome: string;
  userStore: WebChatUserStore;
  eventHub?: WebChatEventHub;
  runner?: CodexRunner;
  codex?: CodexConfig;
  appServerRuntime?: CodexAppServerRuntime;
}) {
  return new WebChatManager({
    gatewayHome: input.gatewayHome,
    projectRoot: input.gatewayHome,
    codex: input.codex ?? codexConfig(),
    userStore: input.userStore,
    sessionStore: new WebChatSessionStore({ gatewayHome: input.gatewayHome }),
    eventHub: input.eventHub ?? new WebChatEventHub(),
    fileRepository: new WebChatFileRepository({ gatewayHome: input.gatewayHome }),
    modelCatalogProvider: async () => modelOptions(),
    appServerRuntime: input.appServerRuntime,
    ...(input.runner
      ? { runner: input.runner }
      : input.appServerRuntime
        ? {}
        : {
            runner: async () => ({
              text: "完成",
              sessionId: "codex-default",
            }),
          }),
  });
}

function codexConfig(): CodexConfig {
  return {
    command: "codex",
    model: "gpt-standard",
    sandbox: "danger-full-access",
    profile: "default",
    search: true,
    skipGitRepoCheck: true,
    dangerouslyBypassApprovalsAndSandbox: true,
    extraArgs: ["--unsafe"],
  };
}

function modelOptions(): CodexModelOption[] {
  return [
    {
      id: "standard",
      model: "gpt-standard",
      displayName: "Standard",
      description: "",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "" },
        { reasoningEffort: "medium", description: "" },
      ],
      defaultReasoningEffort: "medium",
      additionalSpeedTiers: [],
      serviceTiers: [],
      supportsFast: false,
      isDefault: true,
    },
    {
      id: "fast",
      model: "gpt-fast",
      displayName: "Fast",
      description: "",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "" },
        { reasoningEffort: "high", description: "" },
      ],
      defaultReasoningEffort: "low",
      additionalSpeedTiers: ["fast"],
      serviceTiers: [],
      supportsFast: true,
      isDefault: false,
    },
  ];
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-gateway-web-manager-"));
  roots.push(root);
  return root;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待条件超时");
    await Bun.sleep(5);
  }
}

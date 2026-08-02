import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { CodexConfig } from "../src/config.js";
import { handleWebRequest } from "../src/web-server.js";
import { WebChatAuthService } from "../src/web-chat/auth.js";
import { handleWebChatRequest } from "../src/web-chat/http.js";
import { WebChatManager } from "../src/web-chat/manager.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat HTTP", () => {
  test("认证 Session 只写入 HTTP fixture 的临时目录", async () => {
    const fixture = await createFixture();

    await loginAs(fixture, "alice", "password-123");

    const sessionsPath = join(
      fixture.gatewayHome,
      "web-chat",
      "auth-sessions.json"
    );
    expect(existsSync(sessionsPath)).toBe(true);
    const saved = JSON.parse(readFileSync(sessionsPath, "utf8")) as {
      sessions: Array<{ userId: string }>;
    };
    expect(saved.sessions).toEqual([
      expect.objectContaining({ userId: fixture.userId }),
    ]);
  });

  test("开放注册受动态开关保护并在成功后自动登录", async () => {
    const fixture = await createFixture();
    const serverOptions = {
      stateProvider: () => null,
      channelStatusProvider: () => ({ channels: [] }),
      webChatManager: fixture.manager,
      webChatAuth: fixture.auth,
      webChatRegistrationEnabledProvider: () => false,
    };
    const registrationRequest = () =>
      new Request("http://gateway.test/api/chat/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "new-user",
          password: "password-456",
        }),
      });

    const disabledPage = await handleWebRequest(
      new Request("http://gateway.test/chat"),
      serverOptions,
      { remoteAddress: "192.168.1.8" }
    );
    expect(await disabledPage.text()).not.toContain('id="registerForm"');

    const disabled = await handleWebRequest(
      registrationRequest(),
      serverOptions,
      { remoteAddress: "192.168.1.8" }
    );
    expect(disabled.status).toBe(403);

    serverOptions.webChatRegistrationEnabledProvider = () => true;
    const enabledPage = await handleWebRequest(
      new Request("http://gateway.test/chat"),
      serverOptions,
      { remoteAddress: "192.168.1.8" }
    );
    expect(await enabledPage.text()).toContain('id="registerForm"');

    const registered = await handleWebRequest(
      registrationRequest(),
      serverOptions,
      { remoteAddress: "192.168.1.8" }
    );
    expect(registered.status).toBe(201);
    expect(registered.headers.get("set-cookie")).toContain("codex_gateway_chat=");
    const registeredBody = (await registered.json()) as { csrfToken: string };
    const cookie = registered.headers.get("set-cookie")!.split(";", 1)[0]!;
    const me = await request(fixture, "/api/chat/me", { cookie });
    expect(await me.json()).toMatchObject({
      user: { username: "new-user" },
      csrfToken: registeredBody.csrfToken,
    });

    const duplicate = await handleWebRequest(
      registrationRequest(),
      serverOptions,
      { remoteAddress: "192.168.1.8" }
    );
    expect(duplicate.status).toBe(409);
  });

  test("注册限流使用 socket 地址且不信任转发头", async () => {
    const fixture = await createFixture({
      maxRegistrationAttempts: 2,
      registrationWindowMs: 60_000,
    });

    for (const forwardedAddress of ["10.0.0.1", "10.0.0.2"]) {
      const response = await request(fixture, "/api/chat/auth/register", {
        method: "POST",
        registrationEnabled: true,
        headers: { "x-forwarded-for": forwardedAddress },
        body: { username: "", password: "short" },
      });
      expect(response.status).toBe(400);
    }
    const limited = await request(fixture, "/api/chat/auth/register", {
      method: "POST",
      registrationEnabled: true,
      headers: { "x-forwarded-for": "10.0.0.3" },
      body: { username: "other", password: "password-123" },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  test("远程可打开 Chat、登录并读取当前用户", async () => {
    const fixture = await createFixture();
    const page = await request(fixture, "/chat");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Codex Web Chat");

    const bad = await request(fixture, "/api/chat/auth/login", {
      method: "POST",
      body: { username: "alice", password: "wrong" },
    });
    expect(bad.status).toBe(401);

    const login = await loginAs(fixture, "alice", "password-123");
    const me = await request(fixture, "/api/chat/me", {
      cookie: login.cookie,
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { username: "alice" },
      csrfToken: login.csrfToken,
    });
  });

  test("Chat 首屏根据 Cookie 直接显示正确的认证界面", async () => {
    const fixture = await createFixture();
    const anonymousPage = await request(fixture, "/chat");
    const anonymousHtml = await anonymousPage.text();

    expect(anonymousHtml).toContain(
      '<section class="login-view" id="loginView">'
    );
    expect(anonymousHtml).toContain(
      '<div class="chat-app" id="chatApp" hidden>'
    );

    const login = await loginAs(fixture, "alice", "password-123");
    const authenticatedPage = await request(fixture, "/chat", {
      cookie: login.cookie,
    });
    const authenticatedHtml = await authenticatedPage.text();

    expect(authenticatedHtml).toContain(
      '<section class="login-view" id="loginView" hidden>'
    );
    expect(authenticatedHtml).toContain(
      '<div class="chat-app" id="chatApp">'
    );
    expect(authenticatedHtml).toContain('id="webChatBootstrap"');
    expect(authenticatedHtml).toContain('"version":1');
    expect(authenticatedHtml).toContain('"username":"alice"');
    expect(authenticatedHtml).toContain('"model":"gpt-test"');
    expect(authenticatedHtml).toContain('"current":{"session"');
  });

  test("修改请求必须携带 CSRF，Session CRUD 和后台发送可用", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");
    const rejected = await request(fixture, "/api/chat/sessions", {
      method: "POST",
      cookie: login.cookie,
      body: {},
    });
    expect(rejected.status).toBe(403);

    const created = await request(fixture, "/api/chat/sessions", {
      method: "POST",
      cookie: login.cookie,
      csrfToken: login.csrfToken,
      body: { title: "HTTP 会话" },
    });
    expect(created.status).toBe(201);
    const session = (await created.json()).session as {
      id: string;
      model?: string;
      reasoningEffort?: string;
      fast?: boolean;
      verbosity?: string;
    };
    expect(session).toMatchObject({
      model: "gpt-test",
      reasoningEffort: "high",
      fast: true,
      verbosity: "high",
    });

    const runtime = await request(
      fixture,
      `/api/chat/sessions/${session.id}/runtime`,
      {
        method: "PUT",
        cookie: login.cookie,
        csrfToken: login.csrfToken,
        body: {
          model: "gpt-test",
          reasoningEffort: "high",
          fast: true,
          verbosity: "low",
        },
      }
    );
    expect(runtime.status).toBe(200);
    expect(await runtime.clone().json()).toMatchObject({
      session: { verbosity: "high" },
    });

    const accepted = await request(
      fixture,
      `/api/chat/sessions/${session.id}/messages`,
      {
        method: "POST",
        cookie: login.cookie,
        csrfToken: login.csrfToken,
        body: { text: "你好" },
      }
    );
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({
      accepted: true,
      userMessage: {
        id: expect.any(String),
        role: "user",
        text: "你好",
        createdAt: expect.any(String),
      },
      assistantMessageId: expect.any(String),
    });
    await waitFor(
      () =>
        fixture.manager.listMessages(fixture.userId, session.id, { limit: 20 })
          ?.total === 2
    );

    const messages = await request(
      fixture,
      `/api/chat/sessions/${session.id}/messages?limit=20`,
      { cookie: login.cookie }
    );
    expect(messages.status).toBe(200);
    const messageBody = await messages.json();
    expect(messageBody.messages).toHaveLength(2);

    const rewritten = await request(
      fixture,
      `/api/chat/sessions/${session.id}/messages/${messageBody.messages[0].id}/rewrite`,
      {
        method: "POST",
        cookie: login.cookie,
        csrfToken: login.csrfToken,
      }
    );
    expect(rewritten.status).toBe(201);
    expect(await rewritten.json()).toMatchObject({
      session: { forkedFrom: session.id, title: "HTTP 会话（重写）" },
      fileIds: [],
      references: [],
    });

    const renamed = await request(
      fixture,
      `/api/chat/sessions/${session.id}`,
      {
        method: "PATCH",
        cookie: login.cookie,
        csrfToken: login.csrfToken,
        body: { title: "已重命名" },
      }
    );
    expect(await renamed.json()).toMatchObject({
      session: { title: "已重命名" },
    });

    const detail = await request(
      fixture,
      `/api/chat/sessions/${session.id}`,
      { cookie: login.cookie }
    );
    expect(await detail.json()).toMatchObject({
      traces: [
        expect.objectContaining({
          status: "completed",
          entries: expect.any(Array),
        }),
      ],
    });
  });

  test("批量删除 Session 需要 CSRF 并返回统一结果", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");
    const first = fixture.manager.createSession(fixture.userId);
    const second = fixture.manager.createSession(fixture.userId);
    const body = { sessionIds: [first.id, second.id] };

    const rejected = await request(fixture, "/api/chat/sessions", {
      method: "DELETE",
      cookie: login.cookie,
      body,
    });
    expect(rejected.status).toBe(403);

    const deleted = await request(fixture, "/api/chat/sessions", {
      method: "DELETE",
      cookie: login.cookie,
      csrfToken: login.csrfToken,
      body,
    });

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      deletedIds: [first.id, second.id],
      stoppedIds: [],
      failed: [],
    });
    expect(fixture.manager.getSession(fixture.userId, first.id)).toBeNull();
    expect(fixture.manager.getSession(fixture.userId, second.id)).toBeNull();
  });

  test("能力目录、文件搜索和斜杠命令通过登录后的 Session API 提供", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");
    const session = fixture.manager.createSession(fixture.userId);

    const capabilities = await request(
      fixture,
      `/api/chat/capabilities?sessionId=${session.id}`,
      { cookie: login.cookie }
    );
    expect(capabilities.status).toBe(200);
    const capabilityBody = (await capabilities.json()) as {
      capabilities: unknown[];
      commands: Array<{ name: string }>;
    };
    expect(capabilityBody.capabilities).toEqual([]);
    expect(capabilityBody.commands.map((item) => item.name)).toEqual(
      expect.arrayContaining(["model", "goal", "plan"])
    );

    const files = await request(
      fixture,
      `/api/chat/files/search?sessionId=${session.id}&q=readme`,
      { cookie: login.cookie }
    );
    expect(files.status).toBe(200);
    expect(await files.json()).toEqual({ capabilities: [] });

    const command = await request(
      fixture,
      `/api/chat/sessions/${session.id}/commands`,
      {
        method: "POST",
        cookie: login.cookie,
        csrfToken: login.csrfToken,
        body: { name: "status", arguments: {} },
      }
    );
    expect(command.status).toBe(200);
    expect(await command.json()).toMatchObject({
      result: {
        ok: true,
        message: "当前会话状态",
        data: { model: "gpt-test", fast: true },
      },
    });
  });

  test("multipart 上传、token 下载和跨用户隔离生效", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");
    const session = fixture.manager.createSession(fixture.userId);
    const form = new FormData();
    form.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
    const upload = await handleWebChatRequest(
      new Request(`http://gateway.test/api/chat/sessions/${session.id}/files`, {
        method: "POST",
        headers: {
          cookie: login.cookie,
          "x-csrf-token": login.csrfToken,
        },
        body: form,
      }),
      fixture,
      { remoteAddress: "192.168.1.8" }
    );
    expect(upload.status).toBe(201);
    const file = (await upload.json()).file as { id: string };

    const attachmentOnly = await request(
      fixture,
      `/api/chat/sessions/${session.id}/messages`,
      {
        method: "POST",
        cookie: login.cookie,
        csrfToken: login.csrfToken,
        body: { text: "", fileIds: [file.id] },
      }
    );
    expect(attachmentOnly.status).toBe(202);
    await waitFor(
      () =>
        fixture.manager.listMessages(fixture.userId, session.id, { limit: 20 })
          ?.total === 2
    );
    expect(
      fixture.manager.listMessages(fixture.userId, session.id, { limit: 20 })
        ?.messages[0]
    ).toMatchObject({
      role: "user",
      text: "",
      attachments: [expect.objectContaining({ id: file.id })],
    });

    const emptyMessage = await request(
      fixture,
      `/api/chat/sessions/${session.id}/messages`,
      {
        method: "POST",
        cookie: login.cookie,
        csrfToken: login.csrfToken,
        body: { text: "", fileIds: [] },
      }
    );
    expect(emptyMessage.status).toBe(400);

    const download = await request(fixture, `/api/chat/files/${file.id}`, {
      cookie: login.cookie,
    });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("hello");

    const bob = await fixture.manager.createUser({
      username: "bob",
      password: "password-456",
    });
    const bobLogin = await loginAs(fixture, "bob", "password-456");
    const forbidden = await request(fixture, `/api/chat/files/${file.id}`, {
      cookie: bobLogin.cookie,
    });
    expect(forbidden.status).toBe(404);
    expect(fixture.manager.getSession(bob.id, session.id)).toBeNull();
  });

  test("安全栅格图片可内联预览且其他文件保持下载响应", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");
    const session = fixture.manager.createSession(fixture.userId);
    const uploadFile = async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      const response = await handleWebChatRequest(
        new Request(`http://gateway.test/api/chat/sessions/${session.id}/files`, {
          method: "POST",
          headers: {
            cookie: login.cookie,
            "x-csrf-token": login.csrfToken,
          },
          body: form,
        }),
        fixture,
        { remoteAddress: "192.168.1.8" }
      );
      expect(response.status).toBe(201);
      return (await response.json()).file as { id: string };
    };
    const image = await uploadFile(
      new File(["png"], "preview.png", { type: "image/png" })
    );
    const text = await uploadFile(
      new File(["text"], "notes.txt", { type: "text/plain" })
    );
    const svg = await uploadFile(
      new File(["<svg></svg>"], "vector.svg", { type: "image/svg+xml" })
    );

    const imagePreview = await request(
      fixture,
      `/api/chat/files/${image.id}?preview=1`,
      { cookie: login.cookie }
    );
    expect(imagePreview.status).toBe(200);
    expect(imagePreview.headers.get("content-disposition")).toContain("inline");
    expect(imagePreview.headers.get("x-content-type-options")).toBe("nosniff");

    const imageDownload = await request(
      fixture,
      `/api/chat/files/${image.id}`,
      { cookie: login.cookie }
    );
    expect(imageDownload.headers.get("content-disposition")).toContain(
      "attachment"
    );

    for (const file of [text, svg]) {
      const response = await request(
        fixture,
        `/api/chat/files/${file.id}?preview=1`,
        { cookie: login.cookie }
      );
      expect(response.headers.get("content-disposition")).toContain("attachment");
    }
  });

  test("账户设置 API 读取和保存当前用户默认模型配置", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");

    const initial = await request(fixture, "/api/chat/account-settings", {
      cookie: login.cookie,
    });
    expect(initial.status).toBe(200);
    expect(await initial.clone().json()).toMatchObject({
      settings: {
        defaults: {
          model: null,
          reasoningEffort: null,
          fast: null,
        },
        effective: {
          model: "gpt-test",
          reasoningEffort: "high",
          fast: true,
        },
        inherited: {
          model: "gpt-test",
          reasoningEffort: "high",
          fast: true,
        },
      },
    });

    const rejected = await request(fixture, "/api/chat/account-settings", {
      method: "PUT",
      cookie: login.cookie,
      body: {
        model: "gpt-test",
        reasoningEffort: "low",
        fast: false,
      },
    });
    expect(rejected.status).toBe(403);

    const saved = await request(fixture, "/api/chat/account-settings", {
      method: "PUT",
      cookie: login.cookie,
      csrfToken: login.csrfToken,
      body: {
        model: "gpt-test",
        reasoningEffort: "low",
        fast: false,
      },
    });
    expect(saved.status).toBe(200);
    expect(await saved.clone().json()).toMatchObject({
      settings: {
        user: {
          id: fixture.userId,
          model: "gpt-test",
          reasoningEffort: "low",
          fast: false,
        },
        defaults: {
          model: "gpt-test",
          reasoningEffort: "low",
          fast: false,
        },
        inherited: {
          model: "gpt-test",
          reasoningEffort: "high",
          fast: true,
        },
      },
    });

    const invalid = await request(fixture, "/api/chat/account-settings", {
      method: "PUT",
      cookie: login.cookie,
      csrfToken: login.csrfToken,
      body: { model: "missing-model" },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.clone().json()).toEqual({
      error: "模型 missing-model 不在当前模型目录中。",
    });

    const bob = await fixture.manager.createUser({
      username: "bob-settings",
      password: "password-456",
    });
    const bobLogin = await loginAs(fixture, "bob-settings", "password-456");
    const bobSettings = await request(fixture, "/api/chat/account-settings", {
      cookie: bobLogin.cookie,
    });
    expect(bobSettings.status).toBe(200);
    expect(await bobSettings.clone().json()).toMatchObject({
      settings: {
        user: { id: bob.id },
        defaults: {
          model: null,
          reasoningEffort: null,
          fast: null,
        },
      },
    });
  });

  test("SSE 仅返回当前用户公开事件并支持 Last-Event-ID", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");
    const session = fixture.manager.createSession(fixture.userId);
    await fixture.manager.sendMessage(fixture.userId, session.id, { text: "SSE" });
    const lastEventId = fixture.manager.eventHub.currentEventId() - 2;

    const response = await request(fixture, "/api/chat/events", {
      cookie: login.cookie,
      headers: { "last-event-id": String(lastEventId) },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    let text = "";
    for (let index = 0; index < 4 && !text.includes("message.trace"); index += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    await reader.cancel();
    expect(text).toContain("retry: 1500");
    expect(text).toContain(": connected");
    expect(text).toContain("message.trace");
    expect(text).toContain('"status":"completed"');
    expect(text).not.toContain("stderr");
    expect(text).not.toContain("toolInput");
  });

  test("退出、修改密码和停用账号立即撤销登录", async () => {
    const fixture = await createFixture();
    const login = await loginAs(fixture, "alice", "password-123");
    const changed = await request(fixture, "/api/chat/auth/password", {
      method: "POST",
      cookie: login.cookie,
      csrfToken: login.csrfToken,
      body: {
        currentPassword: "password-123",
        newPassword: "new-password-123",
      },
    });
    expect(changed.status).toBe(200);
    expect(
      (
        await request(fixture, "/api/chat/me", {
          cookie: login.cookie,
        })
      ).status
    ).toBe(401);

    const nextLogin = await loginAs(fixture, "alice", "new-password-123");
    fixture.manager.updateUser(fixture.userId, { enabled: false });
    expect(
      (
        await request(fixture, "/api/chat/me", {
          cookie: nextLogin.cookie,
        })
      ).status
    ).toBe(401);
  });

  test("用户管理 API 仅本机可用并支持重置密码", async () => {
    const fixture = await createFixture();
    const options = {
      stateProvider: () => null,
      channelStatusProvider: () => ({ channels: [] }),
      webChatManager: fixture.manager,
      webChatAuth: fixture.auth,
    };
    const remote = await handleWebRequest(
      new Request("http://gateway.test/api/web-chat/users"),
      options,
      { remoteAddress: "192.168.1.8" }
    );
    expect(remote.status).toBe(403);

    const created = await handleWebRequest(
      new Request("http://gateway.test/api/web-chat/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "admin-created",
          password: "password-789",
        }),
      }),
      options,
      { remoteAddress: "127.0.0.1" }
    );
    expect(created.status).toBe(201);
    const user = (await created.json()).user as { id: string };

    const reset = await handleWebRequest(
      new Request(
        `http://gateway.test/api/web-chat/users/${user.id}/password`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "reset-password-123" }),
        }
      ),
      options,
      { remoteAddress: "::1" }
    );
    expect(reset.status).toBe(200);
  });
});

async function createFixture(authOptions: {
  maxRegistrationAttempts?: number;
  registrationWindowMs?: number;
} = {}) {
  const gatewayHome = mkdtempSync(join(tmpdir(), "codex-gateway-web-http-"));
  roots.push(gatewayHome);
  const manager = new WebChatManager({
    gatewayHome,
    projectRoot: gatewayHome,
    codex: codexConfig(),
    modelCatalogProvider: async () => [
      {
        id: "gpt-test",
        model: "gpt-test",
        displayName: "GPT Test",
        description: "",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: "low",
        additionalSpeedTiers: ["fast"],
        serviceTiers: [],
        supportsFast: true,
        isDefault: true,
      },
    ],
    runner: async () => ({ text: "HTTP 回复", sessionId: "codex-http" }),
  });
  const user = await manager.createUser({
    username: "alice",
    password: "password-123",
  });
  const auth = new WebChatAuthService({
    userStore: manager.userStore,
    gatewayHome,
    ...authOptions,
  });
  return {
    gatewayHome,
    manager,
    auth,
    userId: user.id,
  };
}

async function loginAs(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  username: string,
  password: string
) {
  const response = await request(fixture, "/api/chat/auth/login", {
    method: "POST",
    body: { username, password },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return {
    csrfToken: body.csrfToken,
    cookie: response.headers.get("set-cookie")!.split(";", 1)[0]!,
  };
}

async function request(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    csrfToken?: string;
    headers?: Record<string, string>;
    registrationEnabled?: boolean;
  } = {}
) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrfToken) headers.set("x-csrf-token", options.csrfToken);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  return handleWebChatRequest(
    new Request(`http://gateway.test${path}`, {
      method: options.method ?? "GET",
      headers,
      body,
    }),
    {
      ...fixture,
      registrationEnabled: () => options.registrationEnabled ?? false,
    },
    { remoteAddress: "192.168.1.8" }
  );
}

function codexConfig(): CodexConfig {
  return {
    command: "codex",
    model: "gpt-test",
    reasoningEffort: "high",
    fast: true,
    verbosity: "high",
    search: true,
    skipGitRepoCheck: true,
    dangerouslyBypassApprovalsAndSandbox: true,
    extraArgs: [],
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待条件超时");
    await Bun.sleep(5);
  }
}

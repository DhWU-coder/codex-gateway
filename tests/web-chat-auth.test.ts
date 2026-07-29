import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  WEB_CHAT_SESSION_COOKIE,
  WebChatAuthService,
} from "../src/web-chat/auth.js";
import { resolveWebChatAuthSessionsPath } from "../src/paths.js";
import { WebChatUserStore } from "../src/web-chat/user-store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat 认证", () => {
  test("注册创建继承全局配置的用户并自动登录", async () => {
    const { auth, store } = fixture();

    const result = await auth.register("alice", "password-123", "192.168.1.8");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("注册应成功");

    expect(result.status).toBe(201);
    expect(result.setCookie).toContain(`${WEB_CHAT_SESSION_COOKIE}=`);
    expect(result.user).toMatchObject({
      username: "alice",
      enabled: true,
      model: undefined,
      reasoningEffort: undefined,
      fast: undefined,
      verbosity: undefined,
    });
    expect(result.user.lastLoginAt).toBeDefined();
    expect(auth.authenticate(cookieHeader(result.setCookie))?.user.username).toBe("alice");
    expect(store.list()).toHaveLength(1);
  });

  test("注册校验错误与重名返回稳定状态", async () => {
    const { auth } = fixture();

    expect(await auth.register("", "short", "192.168.1.8")).toMatchObject({
      ok: false,
      status: 400,
      message: "用户名必须为 1-64 个有效字符。",
    });
    expect((await auth.register("Alice", "password-123", "192.168.1.8")).ok).toBe(true);
    expect(await auth.register(" ＡＬＩＣＥ ", "password-456", "192.168.1.8")).toMatchObject({
      ok: false,
      status: 409,
      message: "用户名已存在。",
    });
  });

  test("并发注册同一用户名只允许一个请求成功", async () => {
    const { auth, store } = fixture();

    const results = await Promise.all([
      auth.register("alice", "password-123", "192.168.1.8"),
      auth.register("ＡＬＩＣＥ", "password-456", "192.168.1.9"),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(store.list()).toHaveLength(1);
  });

  test("注册按真实地址独立限流且所有结果均计数", async () => {
    const { auth, advance } = fixture({
      maxRegistrationAttempts: 3,
      registrationWindowMs: 60_000,
    });

    expect((await auth.register("", "short", "192.168.1.8")).status).toBe(400);
    expect((await auth.register("alice", "password-123", "192.168.1.8")).status).toBe(201);
    expect((await auth.register("alice", "password-456", "192.168.1.8")).status).toBe(409);
    expect(await auth.register("bob", "password-123", "192.168.1.8")).toMatchObject({
      ok: false,
      status: 429,
      retryAfterSeconds: 60,
    });
    expect((await auth.login("alice", "password-123", "192.168.1.8")).ok).toBe(true);
    expect((await auth.register("bob", "password-123", "192.168.1.9")).ok).toBe(true);

    advance(60_001);
    expect((await auth.register("carol", "password-123", "192.168.1.8")).ok).toBe(true);
  });

  test("正确密码创建 opaque Session 和独立 CSRF Token", async () => {
    const { auth, store } = fixture();
    await store.create({ username: "alice", password: "password-123" });

    const result = await auth.login("alice", "password-123", "192.168.1.8");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("登录应成功");

    expect(result.sessionToken).not.toBe(result.csrfToken);
    expect(result.setCookie).toContain(`${WEB_CHAT_SESSION_COOKIE}=`);
    expect(result.setCookie).toContain("HttpOnly");
    expect(result.setCookie).toContain("SameSite=Strict");
    expect(result.setCookie).toContain("Path=/");
    expect(result.setCookie).not.toContain("Secure");
    expect(auth.authenticate(cookieHeader(result.setCookie))?.user.username).toBe("alice");
    expect(
      auth.authenticateMutation(cookieHeader(result.setCookie), result.csrfToken)?.user.username
    ).toBe("alice");
    expect(auth.authenticateMutation(cookieHeader(result.setCookie), "forged")).toBeNull();
  });

  test("错误用户名和错误密码返回相同错误", async () => {
    const { auth, store } = fixture();
    await store.create({ username: "alice", password: "password-123" });

    const wrongPassword = await auth.login("alice", "wrong-password", "192.168.1.8");
    const wrongUsername = await auth.login("missing", "wrong-password", "192.168.1.8");
    expect(wrongPassword).toMatchObject({
      ok: false,
      status: 401,
      message: "用户名或密码错误。",
    });
    expect(wrongUsername).toMatchObject({
      ok: false,
      status: 401,
      message: "用户名或密码错误。",
    });
  });

  test("连续失败按规范化用户名和真实地址触发短时限流", async () => {
    const { auth, store, advance } = fixture({
      maxFailedAttempts: 2,
      failureWindowMs: 60_000,
    });
    await store.create({ username: "Alice", password: "password-123" });

    expect((await auth.login("alice", "wrong", "192.168.1.8")).status).toBe(401);
    expect((await auth.login(" ＡＬＩＣＥ ", "wrong", "192.168.1.8")).status).toBe(401);
    expect(await auth.login("alice", "password-123", "192.168.1.8")).toMatchObject({
      ok: false,
      status: 429,
    });
    expect((await auth.login("alice", "password-123", "192.168.1.9")).ok).toBe(true);

    advance(60_001);
    expect((await auth.login("alice", "password-123", "192.168.1.8")).ok).toBe(true);
  });

  test("服务重建后恢复未过期 Session 且磁盘不保存原始 Token", async () => {
    const { auth, store, createAuth, gatewayHome } = fixture();
    await store.create({ username: "alice", password: "password-123" });
    const result = await auth.login("alice", "password-123", "127.0.0.1");
    if (!result.ok) throw new Error("登录应成功");
    const cookie = cookieHeader(result.setCookie);
    const rawToken = decodeURIComponent(cookie.split("=", 2)[1] ?? "");
    const sessionsPath = resolveWebChatAuthSessionsPath({
      env: { CODEX_GATEWAY_HOME: gatewayHome },
    });

    expect(auth.authenticate(`${WEB_CHAT_SESSION_COOKIE}=forged`)).toBeNull();
    expect(createAuth().authenticate(cookie)?.user.username).toBe("alice");
    expect(existsSync(sessionsPath)).toBe(true);
    expect(readFileSync(sessionsPath, "utf8")).not.toContain(rawToken);
  });

  test("伪造 Cookie 和过期 Session 在服务重建后均无效", async () => {
    const { auth, store, advance, createAuth } = fixture({ sessionTtlMs: 10_000 });
    await store.create({ username: "alice", password: "password-123" });
    const result = await auth.login("alice", "password-123", "127.0.0.1");
    if (!result.ok) throw new Error("登录应成功");
    const cookie = cookieHeader(result.setCookie);

    expect(createAuth().authenticate(`${WEB_CHAT_SESSION_COOKIE}=forged`)).toBeNull();
    advance(10_001);
    expect(createAuth().authenticate(cookie)).toBeNull();
  });

  test("退出、修改密码和账号停用会撤销相关 Session", async () => {
    const { auth, store, createAuth } = fixture();
    const user = await store.create({ username: "alice", password: "password-123" });
    const first = await auth.login("alice", "password-123", "127.0.0.1");
    const second = await auth.login("alice", "password-123", "127.0.0.2");
    if (!first.ok || !second.ok) throw new Error("登录应成功");

    expect(auth.logout(cookieHeader(first.setCookie))).toContain("Max-Age=0");
    expect(createAuth().authenticate(cookieHeader(first.setCookie))).toBeNull();
    expect(createAuth().authenticate(cookieHeader(second.setCookie))).not.toBeNull();

    expect(
      await auth.changePassword(
        cookieHeader(second.setCookie),
        "wrong-password",
        "new-password-123"
      )
    ).toBe(false);
    expect(
      await auth.changePassword(
        cookieHeader(second.setCookie),
        "password-123",
        "new-password-123"
      )
    ).toBe(true);
    expect(createAuth().authenticate(cookieHeader(second.setCookie))).toBeNull();

    const third = await auth.login("alice", "new-password-123", "127.0.0.1");
    if (!third.ok) throw new Error("登录应成功");
    store.update(user.id, { enabled: false });
    expect(createAuth().authenticate(cookieHeader(third.setCookie))).toBeNull();
    expect(
      auth.authenticateMutation(cookieHeader(third.setCookie), third.csrfToken)
    ).toBeNull();
  });

  test("管理员可按用户撤销全部 Session", async () => {
    const { auth, store, createAuth } = fixture();
    const user = await store.create({ username: "alice", password: "password-123" });
    const first = await auth.login("alice", "password-123", "127.0.0.1");
    const second = await auth.login("alice", "password-123", "127.0.0.2");
    if (!first.ok || !second.ok) throw new Error("登录应成功");

    expect(auth.revokeUser(user.id)).toBe(2);
    expect(createAuth().authenticate(cookieHeader(first.setCookie))).toBeNull();
    expect(createAuth().authenticate(cookieHeader(second.setCookie))).toBeNull();
  });
});

function fixture(options?: {
  sessionTtlMs?: number;
  maxFailedAttempts?: number;
  failureWindowMs?: number;
  maxRegistrationAttempts?: number;
  registrationWindowMs?: number;
}) {
  const gatewayHome = mkdtempSync(join(tmpdir(), "codex-gateway-web-auth-"));
  roots.push(gatewayHome);
  let nowMs = Date.parse("2026-07-28T00:00:00.000Z");
  let tokenIndex = 0;
  let userIndex = 0;
  const store = new WebChatUserStore({
    gatewayHome,
    createId: () => `user-${++userIndex}`,
    now: () => new Date(nowMs),
  });
  const createAuth = () =>
    new WebChatAuthService({
      userStore: store,
      now: () => nowMs,
      createToken: () => `opaque-token-${++tokenIndex}`,
      gatewayHome,
      ...options,
    });
  return {
    gatewayHome,
    store,
    createAuth,
    auth: createAuth(),
    advance(milliseconds: number) {
      nowMs += milliseconds;
    },
  };
}

function cookieHeader(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

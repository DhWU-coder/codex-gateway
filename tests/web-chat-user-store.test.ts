import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { WebChatUserStore } from "../src/web-chat/user-store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat 用户存储", () => {
  test("使用 Argon2id 保存用户且不落明文密码", async () => {
    const { store, usersPath } = fixture();
    const user = await store.create({
      username: "Donghao",
      password: "correct-horse-123",
      model: "gpt-test",
      reasoningEffort: "high",
      fast: true,
      verbosity: "medium",
    });

    const raw = readFileSync(usersPath, "utf8");
    expect(raw).not.toContain("correct-horse-123");
    expect(raw).toContain("$argon2id$");
    expect(user).toMatchObject({
      username: "Donghao",
      enabled: true,
      model: "gpt-test",
      reasoningEffort: "high",
      fast: true,
      verbosity: "medium",
    });
    expect(user).not.toHaveProperty("passwordHash");
    expect(await store.verifyPassword(user.id, "correct-horse-123")).toBe(true);
    expect(await store.verifyPassword(user.id, "wrong-password")).toBe(false);
    expect(existsSync(user.workspacePath)).toBe(true);
    expect(existsSync(user.sessionsPath)).toBe(true);
  });

  test("用户名按 NFKC 和大小写规范化后保持唯一", async () => {
    const { store } = fixture();
    await store.create({ username: "Alice", password: "password-123" });

    await expect(
      store.create({ username: "ＡＬＩＣＥ", password: "password-456" })
    ).rejects.toThrow("用户名已存在");
    expect(store.findByUsername(" alice ")?.username).toBe("Alice");
  });

  test("更新默认参数不会修改密码哈希并支持重置密码", async () => {
    const { store } = fixture();
    const user = await store.create({ username: "alice", password: "password-123" });
    const before = store.getById(user.id)?.passwordHash;

    expect(
      store.update(user.id, {
        enabled: false,
        model: "gpt-next",
        reasoningEffort: "low",
        fast: false,
        verbosity: "high",
      })
    ).toMatchObject({
      enabled: false,
      model: "gpt-next",
      reasoningEffort: "low",
      fast: false,
      verbosity: "high",
    });
    expect(store.getById(user.id)?.passwordHash).toBe(before);

    expect(await store.resetPassword(user.id, "new-password-123")).toBe(true);
    expect(await store.verifyPassword(user.id, "password-123")).toBe(false);
    expect(await store.verifyPassword(user.id, "new-password-123")).toBe(true);
  });

  test("删除账号默认保留数据，purge 才删除用户目录", async () => {
    const { store } = fixture();
    const first = await store.create({ username: "first", password: "password-123" });
    await Bun.write(join(first.workspacePath, "keep.txt"), "keep");
    expect(store.remove(first.id, false)).toBe(true);
    expect(store.getById(first.id)).toBeNull();
    expect(existsSync(first.workspacePath)).toBe(true);

    const second = await store.create({ username: "second", password: "password-456" });
    expect(store.remove(second.id, true)).toBe(true);
    expect(existsSync(join(second.workspacePath, ".."))).toBe(false);
  });

  test("损坏数据文件会报错且不会被覆盖", () => {
    const { store, usersPath } = fixture();
    mkdirSync(join(usersPath, ".."), { recursive: true });
    writeFileSync(usersPath, "{broken", "utf8");

    expect(() => store.list()).toThrow("Web Chat 用户文件损坏");
    expect(readFileSync(usersPath, "utf8")).toBe("{broken");
  });
});

function fixture() {
  const gatewayHome = mkdtempSync(join(tmpdir(), "codex-gateway-web-users-"));
  roots.push(gatewayHome);
  const usersPath = join(gatewayHome, "web-chat", "users.json");
  return {
    gatewayHome,
    usersPath,
    store: new WebChatUserStore({
      gatewayHome,
      usersPath,
      createId: () => `user-${Math.random().toString(36).slice(2)}`,
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    }),
  };
}

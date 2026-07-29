import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  WebChatAuthSessionStore,
  type WebChatAuthSessionRecord,
} from "../src/web-chat/auth-session-store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat 认证 Session 仓库", () => {
  test("使用版本化 JSON 原子保存哈希记录且权限受限", () => {
    const root = temporaryRoot();
    const path = join(root, "web-chat", "auth-sessions.json");
    const store = new WebChatAuthSessionStore({ gatewayHome: root });
    const records: WebChatAuthSessionRecord[] = [
      {
        tokenHash: "a".repeat(64),
        csrfToken: "csrf-token",
        userId: "user-1",
        expiresAt: Date.parse("2026-07-30T00:00:00.000Z"),
      },
    ];

    store.save(records);

    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 1,
      sessions: records,
    });
    expect(readFileSync(path, "utf8")).not.toContain("raw-cookie-token");
    expect(readdirSync(join(root, "web-chat")).filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(store.load()).toEqual(records);
  });

  test("文件缺失或损坏时安全返回空集合", () => {
    const root = temporaryRoot();
    const path = join(root, "auth-sessions.json");
    const store = new WebChatAuthSessionStore({ sessionsPath: path });

    expect(store.load()).toEqual([]);
    writeFileSync(path, "{broken", "utf8");
    expect(store.load()).toEqual([]);
  });

  test("读取时丢弃字段非法的 Session", () => {
    const root = temporaryRoot();
    const path = join(root, "auth-sessions.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        sessions: [
          {
            tokenHash: "b".repeat(64),
            csrfToken: "csrf-token",
            userId: "user-1",
            expiresAt: 123,
          },
          {
            tokenHash: "raw-token",
            csrfToken: "csrf-token",
            userId: "user-2",
            expiresAt: 456,
          },
        ],
      }),
      "utf8"
    );
    const store = new WebChatAuthSessionStore({ sessionsPath: path });

    expect(store.load()).toEqual([
      {
        tokenHash: "b".repeat(64),
        csrfToken: "csrf-token",
        userId: "user-1",
        expiresAt: 123,
      },
    ]);
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-gateway-auth-sessions-"));
  roots.push(root);
  return root;
}

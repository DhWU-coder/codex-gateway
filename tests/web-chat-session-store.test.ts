import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { WebChatSessionStore } from "../src/web-chat/session-store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat Session 存储", () => {
  test("创建、排序、重命名和运行参数均持久化", () => {
    const { store, advance } = fixture();
    const first = store.create("user-1", {
      title: "第一段对话",
      model: "gpt-first",
      reasoningEffort: "high",
      fast: false,
      verbosity: "medium",
    });
    advance(1_000);
    const second = store.create("user-1", { title: "第二段对话" });

    expect(store.list("user-1").map((session) => session.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(store.rename("user-1", first.id, "  新标题  ")?.title).toBe("新标题");
    expect(
      store.updateRuntime("user-1", first.id, {
        model: "gpt-next",
        reasoningEffort: "low",
        fast: true,
        verbosity: "high",
      })
    ).toMatchObject({
      model: "gpt-next",
      reasoningEffort: "low",
      fast: true,
      verbosity: "high",
    });

    const rebuilt = store.rebuild();
    expect(rebuilt.get("user-1", first.id)).toMatchObject({
      title: "新标题",
      model: "gpt-next",
      reasoningEffort: "low",
      fast: true,
      verbosity: "high",
    });
    expect(rebuilt.historyPath("user-1", first.id)).toEndWith(
      `/${first.id}/history`
    );
  });

  test("运行中的 Session 禁止更新运行参数和删除", () => {
    const { store } = fixture();
    const session = store.create("user-1");

    expect(store.setRunning("user-1", session.id, true)?.running).toBe(true);
    expect(store.updateRuntime("user-1", session.id, { model: "gpt-next" })).toBeNull();
    expect(store.remove("user-1", session.id)).toBe(false);
    expect(store.setRunning("user-1", session.id, false)?.running).toBe(false);
    expect(store.remove("user-1", session.id)).toBe(true);
    expect(store.get("user-1", session.id)).toBeNull();
  });

  test("持久化 Thread、Goal、Plan 和安全权限配置并兼容旧记录", () => {
    const { store, gatewayHome } = fixture();
    const session = store.create("user-1", {
      goal: "完成 Web Chat",
      planMode: true,
      permissionProfile: "workspace-write",
    });

    expect(
      store.updateThreadState("user-1", session.id, {
        threadId: "thread-1",
        goal: "完成并验证 Web Chat",
        planMode: false,
        permissionProfile: "read-only",
      })
    ).toMatchObject({
      threadId: "thread-1",
      goal: "完成并验证 Web Chat",
      planMode: false,
      permissionProfile: "read-only",
    });
    expect(store.rebuild().get("user-1", session.id)).toMatchObject({
      threadId: "thread-1",
      goal: "完成并验证 Web Chat",
      planMode: false,
      permissionProfile: "read-only",
    });

    const legacyId = "chat-legacy";
    const legacyDir = join(
      gatewayHome,
      "channels",
      "web",
      "user-1",
      "sessions",
      legacyId
    );
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "web-session.json"),
      JSON.stringify({
        id: legacyId,
        userId: "user-1",
        title: "旧会话",
        running: false,
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z",
      })
    );

    expect(store.rebuild().get("user-1", legacyId)).toEqual(
      expect.objectContaining({
        id: legacyId,
        threadId: undefined,
        goal: undefined,
        planMode: false,
        permissionProfile: undefined,
      })
    );
  });

  test("跨用户访问统一返回不存在", () => {
    const { store } = fixture();
    const session = store.create("user-1");

    expect(store.get("user-2", session.id)).toBeNull();
    expect(store.rename("user-2", session.id, "越界")).toBeNull();
    expect(store.setRunning("user-2", session.id, true)).toBeNull();
    expect(store.remove("user-2", session.id)).toBe(false);
  });

  test("损坏的单条 Session 不影响其他记录", () => {
    const { store, gatewayHome } = fixture();
    const valid = store.create("user-1", { title: "可用" });
    const brokenDir = join(
      gatewayHome,
      "channels",
      "web",
      "user-1",
      "sessions",
      "broken-session"
    );
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, "web-session.json"), "{broken", "utf8");

    expect(store.list("user-1")).toEqual([valid]);
    expect(store.get("user-1", "broken-session")).toBeNull();
  });
});

function fixture() {
  const gatewayHome = mkdtempSync(join(tmpdir(), "codex-gateway-web-session-"));
  roots.push(gatewayHome);
  let nowMs = Date.parse("2026-07-28T00:00:00.000Z");
  let id = 0;
  const createStore = () =>
    new WebChatSessionStore({
      gatewayHome,
      now: () => new Date(nowMs),
      createId: () => `chat-${++id}`,
    });
  const store = createStore();
  return {
    gatewayHome,
    store: Object.assign(store, { rebuild: createStore }),
    advance(milliseconds: number) {
      nowMs += milliseconds;
    },
  };
}

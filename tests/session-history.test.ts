import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type SessionMessage, SessionHistoryStore } from "../src/session/history.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codex-gateway-history-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Session history store", () => {
  test("creates multiple archives and keeps the newest archive current", () => {
    const ids = ["session-one", "session-two"];
    const store = new SessionHistoryStore(dir, () => ids.shift()!);

    const first = store.readOrCreate("dm:ou_1", defaults());
    store.appendMessage(first, { role: "user", text: "第一条问题" });
    store.appendMessage(first, { role: "assistant", text: "第一条回答" });
    const second = store.createNewSession("dm:ou_1", defaults());

    expect(first.archiveId).toBe("session-one");
    expect(second.archiveId).toBe("session-two");
    expect(store.read("dm:ou_1")?.archiveId).toBe("session-two");
    expect(store.listSessions("dm:ou_1")).toEqual([
      expect.objectContaining({ archiveId: "session-two", current: true, messageCount: 0 }),
      expect.objectContaining({
        archiveId: "session-one",
        current: false,
        messageCount: 2,
        preview: "第一条问题",
      }),
    ]);

    const conversationDir = join(dir, encodeConversationKey("dm:ou_1"));
    expect(JSON.parse(readFileSync(join(conversationDir, "current.json"), "utf-8"))).toEqual({
      archiveId: "session-two",
    });
    expect(JSON.parse(readFileSync(join(conversationDir, "index.json"), "utf-8")).sessions).toHaveLength(2);
  });

  test("migrates legacy single-session files into the first archive", () => {
    const conversationKey = "group:oc_legacy";
    const conversationDir = join(dir, encodeConversationKey(conversationKey));
    mkdirSync(conversationDir, { recursive: true });
    writeFileSync(
      join(conversationDir, "session.json"),
      JSON.stringify({
        conversationKey,
        sessionId: "codex-old",
        cwd: "/tmp/legacy",
        model: "gpt-5",
        createdAt: "2026-07-19T00:00:00.000Z",
        lastActiveAt: "2026-07-19T01:00:00.000Z",
        messageCount: 2,
      })
    );
    writeFileSync(
      join(conversationDir, "messages.jsonl"),
      [
        JSON.stringify({ role: "user", text: "旧问题", createdAt: "2026-07-19T00:00:00.000Z" }),
        JSON.stringify({ role: "assistant", text: "旧回答", createdAt: "2026-07-19T00:01:00.000Z" }),
      ].join("\n") + "\n"
    );
    const store = new SessionHistoryStore(dir, () => "unused");

    const migrated = store.read(conversationKey);

    expect(migrated).toMatchObject({
      archiveId: "session-codex-old",
      sessionId: "codex-old",
      nativeSessionStarted: true,
      messageCount: 2,
    });
    expect(store.readRecentMessages(migrated!, 20).map((message) => message.text)).toEqual([
      "旧问题",
      "旧回答",
    ]);
    expect(existsSync(join(conversationDir, "session-codex-old", "session.json"))).toBe(true);
  });

  test("resumes an archive and forks its messages into a new archive", () => {
    const ids = ["session-source", "session-empty", "session-fork"];
    const store = new SessionHistoryStore(dir, () => ids.shift()!);
    const source = store.readOrCreate("dm:ou_2", defaults());
    source.sessionId = "codex-source";
    source.nativeSessionStarted = true;
    store.write(source);
    store.appendMessage(source, { role: "user", text: "要保留的需求" });
    store.appendMessage(source, { role: "assistant", text: "已有方案" });
    store.createNewSession("dm:ou_2", defaults());

    expect(store.resumeSession("dm:ou_2", source.archiveId)?.archiveId).toBe("session-source");

    const fork = store.forkSession("dm:ou_2", source.archiveId, defaults());

    expect(fork).toMatchObject({
      archiveId: "session-fork",
      forkedFrom: "session-source",
      nativeSessionStarted: false,
      messageCount: 2,
    });
    expect(fork?.sessionId).toBeUndefined();
    expect(store.readRecentMessages(fork!, 20).map((message) => message.text)).toEqual([
      "要保留的需求",
      "已有方案",
    ]);
    expect(store.read("dm:ou_2")?.archiveId).toBe("session-fork");
  });

  test("invalidates a cached summary when the archive gains a message", () => {
    const store = new SessionHistoryStore(dir, () => "session-summary");
    const session = store.readOrCreate("dm:ou_3", defaults());
    store.appendMessage(session, { role: "user", text: "分析问题" });
    const written = store.writeSessionSummary(session, {
      topic: "问题分析",
      keyInfo: "关键内容",
      recentAction: "等待确认",
    });

    expect(written.messageCount).toBe(1);
    expect(store.readSessionSummary(session)).toEqual(written);

    store.appendMessage(session, { role: "assistant", text: "继续处理" });

    expect(store.readSessionSummary(session)).toBeNull();
  });

  test("prunes the oldest non-current archives beyond the retention limit", () => {
    const ids = ["session-one", "session-two", "session-three"];
    const store = new SessionHistoryStore(dir, () => ids.shift()!, 2);
    const first = store.readOrCreate("dm:ou_retention", defaults());
    first.lastActiveAt = "2026-07-18T00:00:00.000Z";
    store.write(first);
    const second = store.createNewSession("dm:ou_retention", defaults());
    second.lastActiveAt = "2026-07-19T00:00:00.000Z";
    store.write(second);
    const third = store.createNewSession("dm:ou_retention", defaults());
    third.lastActiveAt = "2026-07-20T00:00:00.000Z";
    store.write(third);

    expect(store.listSessions("dm:ou_retention").map((session) => session.archiveId)).toEqual([
      "session-three",
      "session-two",
    ]);
    expect(
      existsSync(join(dir, encodeConversationKey("dm:ou_retention"), "session-one"))
    ).toBe(false);
  });

  test("recovers a corrupt index and current pointer from archive directories", () => {
    const ids = ["session-old", "session-latest"];
    const store = new SessionHistoryStore(dir, () => ids.shift()!);
    const old = store.readOrCreate("dm:ou_recovery", defaults());
    old.lastActiveAt = "2026-07-19T00:00:00.000Z";
    store.write(old);
    const latest = store.createNewSession("dm:ou_recovery", defaults());
    latest.lastActiveAt = "2026-07-20T00:00:00.000Z";
    store.write(latest);
    const conversationDir = join(dir, encodeConversationKey("dm:ou_recovery"));
    writeFileSync(join(conversationDir, "index.json"), "{broken");
    writeFileSync(join(conversationDir, "current.json"), "{broken");

    const recovered = store.listSessions("dm:ou_recovery");

    expect(recovered.map((session) => session.archiveId)).toEqual([
      "session-latest",
      "session-old",
    ]);
    expect(recovered.find((session) => session.current)?.archiveId).toBe("session-latest");
    expect(store.read("dm:ou_recovery")?.archiveId).toBe("session-latest");
  });

  test("forks a session by preserving the stored message records", () => {
    const ids = ["session-source-copy", "session-fork-copy"];
    const store = new SessionHistoryStore(dir, () => ids.shift()!);
    const source = store.readOrCreate("dm:ou_copy", defaults());
    const sourceDir = join(
      dir,
      encodeConversationKey("dm:ou_copy"),
      "session-source-copy"
    );
    const records: SessionMessage[] = [
      { role: "user", text: "原始问题", createdAt: "2026-07-19T00:00:00.000Z" },
      { role: "assistant", text: "原始回答", createdAt: "2026-07-19T00:01:00.000Z" },
    ];
    writeFileSync(
      join(sourceDir, "messages.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    );
    source.messageCount = 2;
    source.preview = "原始问题";
    store.write(source);

    const fork = store.forkSession("dm:ou_copy", source.archiveId, defaults());

    expect(store.readMessages(fork!)).toEqual(records);
    expect(fork).toMatchObject({ messageCount: 2, preview: "原始问题" });
  });

  test("invalidates summaries when their model or prompt version changes", () => {
    const store = new SessionHistoryStore(dir, () => "session-versioned-summary");
    const session = store.readOrCreate("dm:ou_summary_version", defaults());
    store.appendMessage(session, { role: "user", text: "需要总结" });
    store.writeSessionSummary(
      session,
      { topic: "主题", keyInfo: "信息", recentAction: "动作" },
      { model: "gpt-5", promptVersion: 2 }
    );

    expect(
      store.readSessionSummary(session, { model: "gpt-5", promptVersion: 2 })
    ).not.toBeNull();
    expect(
      store.readSessionSummary(session, { model: "gpt-5-mini", promptVersion: 2 })
    ).toBeNull();
    expect(
      store.readSessionSummary(session, { model: "gpt-5", promptVersion: 3 })
    ).toBeNull();
  });
});

function defaults() {
  return { cwd: "/tmp/work", model: "gpt-5" };
}

function encodeConversationKey(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

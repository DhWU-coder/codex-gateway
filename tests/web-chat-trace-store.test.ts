import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  WebChatTraceStore,
} from "../src/web-chat/trace-store.js";
import type { WebChatTurnTrace } from "../src/web-chat/trace-types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat Trace 存储", () => {
  test("原子保存、排序读取并跳过损坏文件", () => {
    const gatewayHome = createRoot();
    const warnings: string[] = [];
    const store = new WebChatTraceStore({
      gatewayHome,
      warn: (message) => warnings.push(message),
    });
    const older = trace("message-old", "2026-07-29T00:00:00.000Z");
    const newer = trace("message-new", "2026-07-29T01:00:00.000Z");

    store.save(older);
    store.save(newer);
    const traceDir = store.tracePath("user-1", "chat-1", "message-new");
    expect(JSON.parse(readFileSync(traceDir, "utf8")).messageId).toBe("message-new");
    writeFileSync(join(traceDir, "..", "broken.json"), "{broken");

    expect(store.list("user-1", "chat-1").map((item) => item.messageId)).toEqual([
      "message-old",
      "message-new",
    ]);
    expect(warnings).toHaveLength(1);
  });

  test("运行中快照节流，最终状态立即写入", () => {
    const gatewayHome = createRoot();
    let now = 1_000;
    const store = new WebChatTraceStore({
      gatewayHome,
      now: () => now,
      throttleMs: 200,
    });
    const current = trace("message-running", "2026-07-29T00:00:00.000Z");

    store.save(current);
    current.latestActivity = "第二次更新";
    store.save(current);
    expect(store.get("user-1", "chat-1", current.messageId)?.latestActivity).toBeUndefined();

    now += 201;
    store.flush();
    expect(store.get("user-1", "chat-1", current.messageId)?.latestActivity).toBe("第二次更新");

    current.status = "failed";
    current.error = "失败";
    store.save(current);
    expect(store.get("user-1", "chat-1", current.messageId)?.status).toBe("failed");
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-gateway-trace-store-"));
  roots.push(root);
  mkdirSync(join(root, "channels", "web", "user-1", "sessions", "chat-1"), {
    recursive: true,
  });
  return root;
}

function trace(messageId: string, startedAt: string): WebChatTurnTrace {
  return {
    messageId,
    assistantMessageId: `${messageId}-assistant`,
    userId: "user-1",
    sessionId: "chat-1",
    status: "running",
    startedAt,
    updatedAt: startedAt,
    steps: { current: 0 },
    fileChanges: { files: 0 },
    entries: [],
  };
}

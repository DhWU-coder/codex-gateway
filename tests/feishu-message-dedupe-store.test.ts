import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { FeishuMessageDedupeStore } from "../src/feishu/message-dedupe-store.js";

describe("Feishu message dedupe store", () => {
  test("领取消息后拒绝同一实例中的重复消息", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-feishu-dedupe-"));
    const path = join(root, "handled-messages.json");
    const store = new FeishuMessageDedupeStore({ path, now: () => 1_000 });

    expect(store.claim("om_1")).toBe(true);
    expect(store.claim("om_1")).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 1,
      messages: { om_1: 1_000 },
    });
    expect(readdirSync(root).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("重建存储实例后仍拒绝已经领取的消息", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-feishu-dedupe-reload-"));
    const path = join(root, "handled-messages.json");

    expect(new FeishuMessageDedupeStore({ path, now: () => 2_000 }).claim("om_1")).toBe(
      true
    );
    expect(new FeishuMessageDedupeStore({ path, now: () => 2_001 }).claim("om_1")).toBe(
      false
    );
  });

  test("清理超过保留期的消息", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-feishu-dedupe-expiry-"));
    const path = join(root, "handled-messages.json");
    let now = 1_000;
    const store = new FeishuMessageDedupeStore({
      path,
      retentionMs: 100,
      now: () => now,
    });

    expect(store.claim("om_1")).toBe(true);
    now = 1_100;
    expect(store.claim("om_1")).toBe(true);
  });

  test("只保留最近的有限条消息", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-feishu-dedupe-limit-"));
    const path = join(root, "handled-messages.json");
    let now = 1_000;
    const store = new FeishuMessageDedupeStore({
      path,
      maxEntries: 2,
      now: () => now,
    });

    expect(store.claim("om_1")).toBe(true);
    now += 1;
    expect(store.claim("om_2")).toBe(true);
    now += 1;
    expect(store.claim("om_3")).toBe(true);

    expect(JSON.parse(readFileSync(path, "utf8")).messages).toEqual({
      om_2: 1_001,
      om_3: 1_002,
    });
  });

  test("损坏的记录文件不会阻止新消息领取", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-feishu-dedupe-broken-"));
    const path = join(root, "handled-messages.json");
    const warnings: string[] = [];
    writeFileSync(path, "{broken", "utf8");

    const store = new FeishuMessageDedupeStore({
      path,
      now: () => 3_000,
      logger: {
        warn(message) {
          warnings.push(String(message));
        },
      },
    });

    expect(store.claim("om_1")).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("飞书消息去重记录读取失败");
    expect(JSON.parse(readFileSync(path, "utf8")).messages).toEqual({ om_1: 3_000 });
  });
});

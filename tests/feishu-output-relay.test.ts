import { describe, expect, test } from "bun:test";
import { FeishuOutputRelay } from "../src/feishu/output-relay.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Feishu output relay", () => {
  test("merges progress fragments until the quiet period", async () => {
    const sent: string[] = [];
    const relay = new FeishuOutputRelay({
      quietMs: 10,
      sendText: async (text) => {
        sent.push(text);
      },
    });

    relay.append("第一段");
    relay.append("第二段");
    expect(sent).toEqual([]);

    await delay(25);
    expect(sent).toEqual(["第一段第二段"]);
  });

  test("flushes immediately and exposes complete scrollback", async () => {
    const sent: string[] = [];
    const relay = new FeishuOutputRelay({
      quietMs: 100,
      maxChunkLength: 3,
      sendText: async (text) => {
        sent.push(text);
      },
    });

    relay.append("abcdef");
    await relay.flush();

    expect(sent).toEqual(["abc", "def"]);
    expect(relay.getScrollback()).toBe("abcdef");
  });

  test("dispose cancels a scheduled reply", async () => {
    const sent: string[] = [];
    const relay = new FeishuOutputRelay({
      quietMs: 5,
      sendText: async (text) => {
        sent.push(text);
      },
    });

    relay.append("不会发送");
    relay.dispose();
    await delay(15);

    expect(sent).toEqual([]);
  });
});

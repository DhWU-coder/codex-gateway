import { describe, expect, test } from "bun:test";
import { sendFeishuText, splitFeishuText } from "../src/feishu/send.js";

describe("Feishu send", () => {
  test("splits long replies into Feishu-sized chunks", () => {
    expect(splitFeishuText("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
  });

  test("replies to the source message when reply id is available", async () => {
    const calls: unknown[] = [];
    await sendFeishuText(
      {
        replyText: async (input) => {
          calls.push(input);
        },
        sendText: async (input) => {
          calls.push(input);
        },
      },
      {
        replyToMessageId: "om_1",
        text: "hello",
      }
    );

    expect(calls).toEqual([{ messageId: "om_1", text: "hello" }]);
  });
});

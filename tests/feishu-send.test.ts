import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createSdkFeishuMessageClient,
  sendFeishuFile,
  sendFeishuText,
  splitFeishuText,
} from "../src/feishu/send.js";

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

  test("uploads and replies with a Feishu file message", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-send-file-"));
    const filePath = join(cwd, "report.pdf");
    writeFileSync(filePath, "pdf-data");
    const calls: unknown[] = [];
    const client = createSdkFeishuMessageClient({
      im: {
        v1: {
          file: {
            async create(input) {
              calls.push(["file.create", input]);
              return { file_key: "file_uploaded" };
            },
          },
          message: {
            async reply(input) {
              calls.push(["message.reply", input]);
            },
            async create(input) {
              calls.push(["message.create", input]);
            },
          },
        },
      },
    });

    await sendFeishuFile(client, { replyToMessageId: "om_1", filePath });

    expect(calls[0]).toMatchObject([
      "file.create",
      { data: { file_type: "pdf", file_name: "report.pdf" } },
    ]);
    expect(calls[1]).toEqual([
      "message.reply",
      {
        path: { message_id: "om_1" },
        data: {
          msg_type: "file",
          content: JSON.stringify({ file_key: "file_uploaded" }),
        },
      },
    ]);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("tests credentials through the tenant access token API", async () => {
    const calls: unknown[] = [];
    const client = createSdkFeishuMessageClient(
      {
        auth: {
          v3: {
            tenantAccessToken: {
              async internal(input) {
                calls.push(input);
                return { code: 0, msg: "ok", tenant_access_token: "token" };
              },
            },
          },
        },
        im: {
          v1: {
            message: {
              async reply() {},
              async create() {},
            },
          },
        },
      },
      { appId: "cli_app", appSecret: "secret" }
    );

    const result = await client.testConnection?.({ expectedBotOpenId: "ou_bot" });

    expect(calls).toEqual([{ data: { app_id: "cli_app", app_secret: "secret" } }]);
    expect(result).toMatchObject({
      ok: true,
      checks: [
        { name: "tenant_access_token", ok: true },
        { name: "bot_open_id", ok: true },
      ],
    });
  });
});

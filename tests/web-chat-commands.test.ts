import { describe, expect, test } from "bun:test";
import {
  WEB_CHAT_COMMANDS,
  normalizeWebChatCommand,
  parseWebChatCommandText,
} from "../src/web-chat/commands.js";

describe("Web Chat 命令", () => {
  test("只公开具有真实 Web Chat 行为的命令", () => {
    expect(WEB_CHAT_COMMANDS.map((command) => command.name)).toEqual([
      "model",
      "effort",
      "fast",
      "goal",
      "plan",
      "new",
      "clear",
      "fork",
      "stop",
      "compact",
      "review",
      "permissions",
      "status",
      "help",
    ]);
    expect(JSON.stringify(WEB_CHAT_COMMANDS)).not.toContain("verbosity");
    expect(JSON.stringify(WEB_CHAT_COMMANDS)).not.toContain("danger-full-access");
  });

  test("解析文本命令并拒绝未知命令", () => {
    expect(parseWebChatCommandText("/goal 完成 Web Chat")).toEqual({
      name: "goal",
      argument: "完成 Web Chat",
    });
    expect(parseWebChatCommandText("普通消息")).toBeNull();
    expect(() => normalizeWebChatCommand("rm", {})).toThrow("不支持");
    expect(normalizeWebChatCommand("plan", { value: "on" })).toEqual({
      name: "plan",
      arguments: { value: "on" },
    });
  });
});

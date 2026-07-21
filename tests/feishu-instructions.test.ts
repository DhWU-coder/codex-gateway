import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  FEISHU_INSTRUCTIONS_MAX_BYTES,
  buildFeishuDeveloperInstructions,
  ensureFeishuInstructionsFile,
  readFeishuInstructionsFile,
  writeFeishuInstructionsFile,
} from "../src/feishu/instructions.js";

describe("飞书账户指令文件", () => {
  test("首次访问会创建空 AGENTS.md 且不会覆盖已有内容", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-instructions-"));
    const filePath = join(root, "channels", "feishu", "personal", "AGENTS.md");

    const initial = ensureFeishuInstructionsFile(filePath);

    expect(existsSync(filePath)).toBe(true);
    expect(initial).toMatchObject({ path: filePath, content: "", configured: false, size: 0 });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);

    writeFileSync(filePath, "保留现有指令", "utf8");
    const existing = ensureFeishuInstructionsFile(filePath);

    expect(existing.content).toBe("保留现有指令");
  });

  test("保存和读取 Markdown 原文并允许清空", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-instructions-save-"));
    const filePath = join(root, "account", "AGENTS.md");

    expect(writeFeishuInstructionsFile(filePath, "# 频道规则\n\n始终使用中文。\n")).toMatchObject({
      content: "# 频道规则\n\n始终使用中文。\n",
      configured: true,
    });
    expect(readFeishuInstructionsFile(filePath).content).toBe("# 频道规则\n\n始终使用中文。\n");

    expect(writeFeishuInstructionsFile(filePath, "")).toMatchObject({
      content: "",
      configured: false,
      size: 0,
    });
    expect(existsSync(filePath)).toBe(true);
  });

  test("内容超过 32 KiB 时拒绝保存且保留原文件", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-instructions-size-"));
    const filePath = join(root, "AGENTS.md");
    writeFeishuInstructionsFile(filePath, "原内容");

    expect(() =>
      writeFeishuInstructionsFile(filePath, "a".repeat(FEISHU_INSTRUCTIONS_MAX_BYTES + 1))
    ).toThrow("32 KiB");
    expect(readFileSync(filePath, "utf8")).toBe("原内容");
  });

  test("仅为非空账户指令生成 developer instructions", () => {
    expect(buildFeishuDeveloperInstructions(" \n ")).toBeUndefined();
    expect(buildFeishuDeveloperInstructions("始终使用中文。\n")).toBe(
      "以下是当前飞书频道的专属指令；如与通用指令冲突，以本频道指令为准。\n\n始终使用中文。"
    );
  });
});


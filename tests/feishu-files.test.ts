import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { saveFeishuFile, saveFeishuImage } from "../src/feishu/files.js";

describe("Feishu files", () => {
  test("saves images under a conversation scoped cache path", () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-images-"));
    const image = saveFeishuImage({
      cwd,
      conversationKey: "dm:ou_1",
      messageId: "om_1",
      imageKey: "img_1",
      buffer: Buffer.from("image"),
      contentType: "image/png",
    });

    expect(image.path.endsWith(".png")).toBe(true);
    expect(existsSync(image.path)).toBe(true);
    expect(readFileSync(image.path, "utf-8")).toBe("image");
  });

  test("saves files with a safe filename", () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-files-"));
    const file = saveFeishuFile({
      cwd,
      messageId: "om_1",
      fileKey: "file_1",
      fileName: "../report.md",
      buffer: Buffer.from("content"),
      contentType: "text/markdown",
    });

    expect(file.path).toContain("report.md");
    expect(readFileSync(file.path, "utf-8")).toBe("content");
  });
});

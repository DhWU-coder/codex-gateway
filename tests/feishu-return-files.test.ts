import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FEISHU_RETURN_FILE_BYTES,
  extractFeishuReturnFileDirectives,
  resolveFeishuReturnFile,
} from "../src/feishu/return-files.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "codex-gateway-return-files-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Feishu return files", () => {
  test("extracts codex file directives and removes them from visible text", () => {
    const filePath = join(cwd, "result.html");
    writeFileSync(filePath, "<html></html>");

    const result = extractFeishuReturnFileDirectives(
      "页面已经生成。\n[[codex:file:result.html]]",
      cwd
    );

    expect(result).toEqual({
      text: "页面已经生成。",
      filePaths: ["result.html"],
    });
  });

  test("extracts an existing cwd absolute path and cleans its code fence", () => {
    const filePath = join(cwd, "金价报告.xlsx");
    writeFileSync(filePath, "xlsx-data");

    const result = extractFeishuReturnFileDirectives(
      ["文件已整理：", "```text", filePath, "```", "请查收。"].join("\n"),
      cwd
    );

    expect(result.filePaths).toEqual([filePath]);
    expect(result.text).toBe("文件已整理：\n请查收。");
  });

  test("deduplicates repeated file paths", () => {
    const filePath = join(cwd, "report.pdf");
    writeFileSync(filePath, "pdf-data");

    const result = extractFeishuReturnFileDirectives(
      `[[codex:file:report.pdf]]\n[[codex:file:report.pdf]]`,
      cwd
    );

    expect(result.filePaths).toEqual(["report.pdf"]);
  });

  test("resolves a non-empty file inside cwd", () => {
    const filePath = join(cwd, "report.pdf");
    writeFileSync(filePath, "pdf-data");

    expect(resolveFeishuReturnFile(cwd, "report.pdf")).toEqual({
      path: filePath,
      fileName: "report.pdf",
    });
  });

  test("rejects paths outside cwd", () => {
    expect(() => resolveFeishuReturnFile(cwd, "../secret.txt")).toThrow(
      "只能回传当前工作目录内的文件"
    );
  });

  test("rejects symlinks that point outside cwd", () => {
    const outside = mkdtempSync(join(tmpdir(), "codex-gateway-return-outside-"));
    const outsideFile = join(outside, "secret.txt");
    writeFileSync(outsideFile, "secret");
    symlinkSync(outsideFile, join(cwd, "linked-secret.txt"));

    expect(() => resolveFeishuReturnFile(cwd, "linked-secret.txt")).toThrow(
      "只能回传当前工作目录内的文件"
    );
    rmSync(outside, { recursive: true, force: true });
  });

  test("rejects missing, empty and directory paths", () => {
    const emptyPath = join(cwd, "empty.txt");
    const directoryPath = join(cwd, "folder");
    writeFileSync(emptyPath, "");
    mkdirSync(directoryPath);

    expect(() => resolveFeishuReturnFile(cwd, "missing.txt")).toThrow("回传文件不存在");
    expect(() => resolveFeishuReturnFile(cwd, "empty.txt")).toThrow("不能回传空文件");
    expect(() => resolveFeishuReturnFile(cwd, "folder")).toThrow("回传路径不是文件");
  });

  test("rejects files larger than 30MB", () => {
    const filePath = join(cwd, "large.bin");
    writeFileSync(filePath, "x");
    truncateSync(filePath, MAX_FEISHU_RETURN_FILE_BYTES + 1);

    expect(() => resolveFeishuReturnFile(cwd, "large.bin")).toThrow("回传文件超过 30MB");
  });
});

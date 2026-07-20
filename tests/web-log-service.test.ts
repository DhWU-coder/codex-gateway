import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readServiceLogTail } from "../src/web/log-service.js";

let directory: string;
let logPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "codex-gateway-log-web-"));
  logPath = join(directory, "service.log");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("Web 服务日志读取", () => {
  test("不存在的日志文件返回空结果", () => {
    expect(readServiceLogTail({ logPath })).toEqual({
      content: "",
      cursor: 0,
      reset: false,
      size: 0,
      updatedAt: null,
    });
  });

  test("首次读取只返回受限的文件尾部", () => {
    writeFileSync(logPath, "first\nsecond\nthird\n");

    const result = readServiceLogTail({ logPath, maxBytes: 13 });

    expect(result.content).toBe("second\nthird\n");
    expect(result.cursor).toBe(Buffer.byteLength("first\nsecond\nthird\n"));
    expect(result.size).toBe(result.cursor);
    expect(result.reset).toBe(true);
    expect(result.updatedAt).toBeString();
  });

  test("游标读取只返回新增内容", () => {
    writeFileSync(logPath, "ready\n");
    const first = readServiceLogTail({ logPath });
    appendFileSync(logPath, "[warn] reconnecting\nconnected\n");

    const next = readServiceLogTail({ logPath, cursor: first.cursor });

    expect(next.content).toBe("[warn] reconnecting\nconnected\n");
    expect(next.reset).toBe(false);
    expect(next.cursor).toBe(next.size);
  });

  test("文件轮转或截断后重置游标", () => {
    writeFileSync(logPath, "a very long old log line\n");
    const first = readServiceLogTail({ logPath });
    writeFileSync(logPath, "new\n");

    const next = readServiceLogTail({ logPath, cursor: first.cursor });

    expect(next).toMatchObject({ content: "new\n", reset: true, cursor: 4, size: 4 });
  });

  test("增量内容超过上限时退化为受限尾部并标记重置", () => {
    writeFileSync(logPath, "base\n");
    const first = readServiceLogTail({ logPath });
    appendFileSync(logPath, "one\ntwo\nthree\n");

    const next = readServiceLogTail({ logPath, cursor: first.cursor, maxBytes: 10 });

    expect(next.content).toBe("two\nthree\n");
    expect(next.reset).toBe(true);
  });
});

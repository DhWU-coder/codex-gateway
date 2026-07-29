import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  MAX_WEB_CHAT_FILE_BYTES,
  WebChatFileRepository,
} from "../src/web-chat/files.js";
import { resolveWebChatWorkspacePath } from "../src/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat 文件仓库", () => {
  test("上传文件使用随机 token 并识别图片", () => {
    const { repository, workspace } = fixture();
    const file = repository.saveUpload("user-1", {
      name: "../截图.png",
      mimeType: "image/png",
      data: new Uint8Array([1, 2, 3]),
    });

    expect(file).toMatchObject({
      id: "file-1",
      name: "截图.png",
      mimeType: "image/png",
      size: 3,
      kind: "upload",
      image: true,
    });
    expect(file).not.toHaveProperty("path");
    const download = repository.open("user-1", file.id);
    expect(download?.path.startsWith(workspace)).toBe(true);
    expect(readFileSync(download!.path)).toEqual(Buffer.from([1, 2, 3]));
  });

  test("拒绝空文件和超过 30MB 的上传", () => {
    const { repository } = fixture({ maxBytes: 3 });

    expect(MAX_WEB_CHAT_FILE_BYTES).toBe(30 * 1024 * 1024);
    expect(() =>
      repository.saveUpload("user-1", {
        name: "empty.txt",
        mimeType: "text/plain",
        data: new Uint8Array(),
      })
    ).toThrow("不能上传空文件");
    expect(() =>
      repository.saveUpload("user-1", {
        name: "large.txt",
        mimeType: "text/plain",
        data: new Uint8Array([1, 2, 3, 4]),
      })
    ).toThrow("上传文件超过 30MB");
  });

  test("注册 Codex 返回文件并重新校验真实路径", () => {
    const { repository, workspace } = fixture();
    mkdirSync(join(workspace, "reports"), { recursive: true });
    writeFileSync(join(workspace, "reports", "result.html"), "<html></html>");

    const relative = repository.registerGenerated(
      "user-1",
      "reports/result.html"
    );
    const absolute = repository.registerGenerated(
      "user-1",
      join(workspace, "reports", "result.html")
    );

    expect(relative).toMatchObject({
      name: "result.html",
      kind: "generated",
      mimeType: "text/html",
    });
    expect(repository.open("user-1", relative.id)?.path).toBe(
      join(workspace, "reports", "result.html")
    );
    expect(repository.open("user-1", absolute.id)).not.toBeNull();
  });

  test("拒绝目录、空文件、超限文件、越界路径和越界符号链接", () => {
    const { repository, workspace, gatewayHome } = fixture({ maxBytes: 4 });
    mkdirSync(join(workspace, "folder"), { recursive: true });
    writeFileSync(join(workspace, "empty.txt"), "");
    writeFileSync(join(workspace, "large.bin"), "x");
    truncateSync(join(workspace, "large.bin"), 5);
    const outside = join(gatewayHome, "secret.txt");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(workspace, "linked-secret.txt"));

    expect(() => repository.registerGenerated("user-1", "folder")).toThrow(
      "路径不是文件"
    );
    expect(() => repository.registerGenerated("user-1", "empty.txt")).toThrow(
      "不能使用空文件"
    );
    expect(() => repository.registerGenerated("user-1", "large.bin")).toThrow(
      "文件超过 30MB"
    );
    expect(() => repository.registerGenerated("user-1", "../secret.txt")).toThrow(
      "只能使用当前用户工作目录内的文件"
    );
    expect(() =>
      repository.registerGenerated("user-1", join(gatewayHome, "secret.txt"))
    ).toThrow("只能使用当前用户工作目录内的文件");
    expect(() =>
      repository.registerGenerated("user-1", "linked-secret.txt")
    ).toThrow("只能使用当前用户工作目录内的文件");
  });

  test("文件 token 按用户隔离且文件变化后下载失败", () => {
    const { repository } = fixture();
    const file = repository.saveUpload("user-1", {
      name: "data.txt",
      mimeType: "text/plain",
      data: new TextEncoder().encode("data"),
    });

    expect(repository.open("user-2", file.id)).toBeNull();
    const own = repository.open("user-1", file.id);
    rmSync(own!.path);
    expect(repository.open("user-1", file.id)).toBeNull();
  });
});

function fixture(options?: { maxBytes?: number }) {
  const gatewayHome = mkdtempSync(join(tmpdir(), "codex-gateway-web-files-"));
  roots.push(gatewayHome);
  let id = 0;
  const workspace = resolveWebChatWorkspacePath("user-1", {
    env: { CODEX_GATEWAY_HOME: gatewayHome },
  });
  mkdirSync(workspace, { recursive: true });
  return {
    gatewayHome,
    workspace,
    repository: new WebChatFileRepository({
      gatewayHome,
      maxBytes: options?.maxBytes,
      createId: () => `file-${++id}`,
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    }),
  };
}

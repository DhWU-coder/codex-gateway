import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  resolveGatewayHome,
  resolveWebChatWorkspacePath,
} from "../paths.js";
import type { SessionAttachment } from "../session/history.js";

export const MAX_WEB_CHAT_FILE_BYTES = 30 * 1024 * 1024;

interface WebChatFileRecord {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "upload" | "generated";
  relativePath: string;
  createdAt: string;
}

interface WebChatFilesIndex {
  version: 1;
  files: WebChatFileRecord[];
}

export interface WebChatFilePublic extends SessionAttachment {
  mimeType: string;
  size: number;
  image: boolean;
  createdAt: string;
}

export interface WebChatOpenedFile {
  file: WebChatFilePublic;
  path: string;
}

export interface WebChatUploadInput {
  name: string;
  mimeType?: string;
  data: Uint8Array;
}

export interface WebChatFileRepositoryOptions {
  gatewayHome?: string;
  maxBytes?: number;
  createId?: () => string;
  now?: () => Date;
}

export class WebChatFileRepository {
  private readonly gatewayHome: string;
  private readonly maxBytes: number;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: WebChatFileRepositoryOptions = {}) {
    this.gatewayHome = options.gatewayHome ?? resolveGatewayHome();
    this.maxBytes = options.maxBytes ?? MAX_WEB_CHAT_FILE_BYTES;
    this.createId = options.createId ?? (() => `file-${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
  }

  saveUpload(userId: string, input: WebChatUploadInput): WebChatFilePublic {
    if (input.data.byteLength <= 0) throw new Error("不能上传空文件。");
    if (input.data.byteLength > this.maxBytes) {
      throw new Error("上传文件超过 30MB。");
    }
    const fileId = assertPathId(this.createId(), "文件");
    const name = safeFileName(input.name);
    const workspace = this.ensureWorkspace(userId);
    const path = resolve(
      workspace,
      ".codex-gateway",
      "web-chat-uploads",
      fileId,
      name
    );
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, input.data, { mode: 0o600 });
    const record: WebChatFileRecord = {
      id: fileId,
      userId: assertPathId(userId, "用户"),
      name,
      mimeType: normalizeMimeType(input.mimeType, name),
      size: input.data.byteLength,
      kind: "upload",
      relativePath: relative(workspace, path),
      createdAt: this.now().toISOString(),
    };
    this.addRecord(record);
    return toPublic(record);
  }

  registerGenerated(userId: string, inputPath: string): WebChatFilePublic {
    const workspace = this.ensureWorkspace(userId);
    const path = this.validateWorkspaceFile(workspace, inputPath);
    const stat = statSync(path);
    const record: WebChatFileRecord = {
      id: assertPathId(this.createId(), "文件"),
      userId: assertPathId(userId, "用户"),
      name: basename(path),
      mimeType: normalizeMimeType(undefined, path),
      size: stat.size,
      kind: "generated",
      relativePath: relative(workspace, path),
      createdAt: this.now().toISOString(),
    };
    this.addRecord(record);
    return toPublic(record);
  }

  get(userId: string, fileId: string): WebChatFilePublic | null {
    const record = this.findRecord(userId, fileId);
    return record ? toPublic(record) : null;
  }

  open(userId: string, fileId: string): WebChatOpenedFile | null {
    const record = this.findRecord(userId, fileId);
    if (!record) return null;
    try {
      const workspace = this.ensureWorkspace(userId);
      const path = this.validateWorkspaceFile(workspace, record.relativePath);
      return { file: toPublic(record), path };
    } catch {
      return null;
    }
  }

  toAttachment(file: WebChatFilePublic): SessionAttachment {
    return {
      id: file.id,
      name: file.name,
      kind: file.kind,
      mimeType: file.mimeType,
      size: file.size,
    };
  }

  private findRecord(userId: string, fileId: string): WebChatFileRecord | null {
    try {
      const safeUserId = assertPathId(userId, "用户");
      const safeFileId = assertPathId(fileId, "文件");
      return (
        this.readRecords(safeUserId).find(
          (record) => record.id === safeFileId && record.userId === safeUserId
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  private addRecord(record: WebChatFileRecord): void {
    const records = this.readRecords(record.userId);
    records.push(record);
    this.writeRecords(record.userId, records);
  }

  private readRecords(userId: string): WebChatFileRecord[] {
    const path = this.indexPath(userId);
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as WebChatFilesIndex;
      if (parsed.version !== 1 || !Array.isArray(parsed.files)) throw new Error();
      return parsed.files.map((record) => ({ ...record }));
    } catch {
      throw new Error("Web Chat 文件索引损坏，已停止读取以避免覆盖。");
    }
  }

  private writeRecords(userId: string, records: WebChatFileRecord[]): void {
    const path = this.indexPath(userId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify({ version: 1, files: records } satisfies WebChatFilesIndex, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      renameSync(temporaryPath, path);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  }

  private validateWorkspaceFile(workspace: string, inputPath: string): string {
    const root = resolve(workspace);
    const path = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath);
    if (isOutside(root, path)) {
      throw new Error("只能使用当前用户工作目录内的文件。");
    }
    if (!existsSync(path)) throw new Error("文件不存在。");
    if (isOutside(realpathSync(root), realpathSync(path))) {
      throw new Error("只能使用当前用户工作目录内的文件。");
    }
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("路径不是文件。");
    if (stat.size <= 0) throw new Error("不能使用空文件。");
    if (stat.size > this.maxBytes) throw new Error("文件超过 30MB。");
    return path;
  }

  private ensureWorkspace(userId: string): string {
    const workspace = resolveWebChatWorkspacePath(assertPathId(userId, "用户"), {
      env: { CODEX_GATEWAY_HOME: this.gatewayHome },
    });
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    return workspace;
  }

  private indexPath(userId: string): string {
    return resolve(
      this.ensureWorkspace(userId),
      ".codex-gateway",
      "web-chat-files.json"
    );
  }
}

function toPublic(record: WebChatFileRecord): WebChatFilePublic {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    mimeType: record.mimeType,
    size: record.size,
    image: record.mimeType.startsWith("image/"),
    createdAt: record.createdAt,
  };
}

function safeFileName(value: string): string {
  const name = value
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!name || name === "." || name === "..") return "file";
  return name.slice(0, 180);
}

function normalizeMimeType(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim().toLocaleLowerCase("en-US");
  const extension = extname(name).toLocaleLowerCase("en-US");
  return (
    {
      ".html": "text/html",
      ".htm": "text/html",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".csv": "text/csv",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".zip": "application/zip",
    }[extension] ?? "application/octet-stream"
  );
}

function isOutside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  );
}

function assertPathId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`${name}标识不合法。`);
  }
  return normalized;
}

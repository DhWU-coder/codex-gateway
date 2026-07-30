import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;

interface FeishuMessageDedupeFile {
  version: 1;
  messages: Record<string, number>;
}

export interface FeishuMessageDedupeStoreOptions {
  path: string;
  retentionMs?: number;
  maxEntries?: number;
  now?: () => number;
  logger?: Pick<Console, "warn">;
}

export class FeishuMessageDedupeStore {
  private readonly path: string;
  private readonly retentionMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "warn">;
  private readonly messages = new Map<string, number>();

  constructor(options: FeishuMessageDedupeStoreOptions) {
    this.path = options.path;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? console;
    this.load();
  }

  claim(messageId: string): boolean {
    const timestamp = this.now();
    this.pruneExpired(timestamp);
    if (this.messages.has(messageId)) return false;

    this.messages.set(messageId, timestamp);
    this.trimToLimit();
    this.persist();
    return true;
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<FeishuMessageDedupeFile>;
      if (parsed.version !== 1 || !isRecord(parsed.messages)) {
        throw new Error("记录格式无效");
      }
      for (const [messageId, handledAt] of Object.entries(parsed.messages)) {
        if (messageId && typeof handledAt === "number" && Number.isFinite(handledAt)) {
          this.messages.set(messageId, handledAt);
        }
      }
      this.pruneExpired(this.now());
      this.trimToLimit();
    } catch (error) {
      this.messages.clear();
      this.logger.warn(`飞书消息去重记录读取失败，将从空记录恢复：${formatError(error)}`);
    }
  }

  private pruneExpired(timestamp: number): void {
    for (const [messageId, handledAt] of this.messages) {
      if (timestamp - handledAt >= this.retentionMs) {
        this.messages.delete(messageId);
      }
    }
  }

  private trimToLimit(): void {
    if (this.messages.size <= this.maxEntries) return;
    const ordered = [...this.messages.entries()].sort(
      ([leftId, leftAt], [rightId, rightAt]) =>
        leftAt - rightAt || leftId.localeCompare(rightId)
    );
    for (const [messageId] of ordered.slice(0, this.messages.size - this.maxEntries)) {
      this.messages.delete(messageId);
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    const content: FeishuMessageDedupeFile = {
      version: 1,
      messages: Object.fromEntries(this.messages),
    };

    // 先完整写入临时文件，再原子替换正式文件，避免进程退出留下半个 JSON。
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(content, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

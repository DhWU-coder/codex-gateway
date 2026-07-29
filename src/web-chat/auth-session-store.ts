import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  resolveGatewayHome,
  resolveWebChatAuthSessionsPath,
} from "../paths.js";

export interface WebChatAuthSessionRecord {
  tokenHash: string;
  csrfToken: string;
  userId: string;
  expiresAt: number;
}

interface WebChatAuthSessionsFile {
  version: 1;
  sessions: WebChatAuthSessionRecord[];
}

export interface WebChatAuthSessionStoreOptions {
  gatewayHome?: string;
  sessionsPath?: string;
}

export class WebChatAuthSessionStore {
  private readonly sessionsPath: string;

  constructor(options: WebChatAuthSessionStoreOptions = {}) {
    const gatewayHome = options.gatewayHome ?? resolveGatewayHome();
    this.sessionsPath =
      options.sessionsPath ??
      resolveWebChatAuthSessionsPath({
        env: { CODEX_GATEWAY_HOME: gatewayHome },
      });
  }

  load(): WebChatAuthSessionRecord[] {
    if (!existsSync(this.sessionsPath)) return [];
    try {
      const parsed = JSON.parse(
        readFileSync(this.sessionsPath, "utf8")
      ) as Partial<WebChatAuthSessionsFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return [];
      return parsed.sessions
        .map(normalizeRecord)
        .filter((record): record is WebChatAuthSessionRecord => record !== null);
    } catch {
      return [];
    }
  }

  save(records: WebChatAuthSessionRecord[]): void {
    const sessions = records
      .map(normalizeRecord)
      .filter((record): record is WebChatAuthSessionRecord => record !== null);
    mkdirSync(dirname(this.sessionsPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.sessionsPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(
          { version: 1, sessions } satisfies WebChatAuthSessionsFile,
          null,
          2
        )}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      renameSync(temporaryPath, this.sessionsPath);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  }
}

function normalizeRecord(value: unknown): WebChatAuthSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<WebChatAuthSessionRecord>;
  if (
    typeof record.tokenHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
    typeof record.csrfToken !== "string" ||
    !record.csrfToken ||
    typeof record.userId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(record.userId) ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt) ||
    record.expiresAt <= 0
  ) {
    return null;
  }
  return {
    tokenHash: record.tokenHash,
    csrfToken: record.csrfToken,
    userId: record.userId,
    expiresAt: record.expiresAt,
  };
}

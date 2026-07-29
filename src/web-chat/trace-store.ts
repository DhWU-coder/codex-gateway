import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveGatewayHome, resolveWebChatSessionsPath } from "../paths.js";
import type { WebChatTurnTrace } from "./trace-types.js";

export interface WebChatTraceStoreOptions {
  gatewayHome?: string;
  now?: () => number;
  throttleMs?: number;
  warn?: (message: string) => void;
}

interface PendingTrace {
  trace: WebChatTurnTrace;
  timer?: ReturnType<typeof setTimeout>;
}

export class WebChatTraceStore {
  private readonly gatewayHome: string;
  private readonly now: () => number;
  private readonly throttleMs: number;
  private readonly warn: (message: string) => void;
  private readonly lastWrittenAt = new Map<string, number>();
  private readonly pending = new Map<string, PendingTrace>();

  constructor(options: WebChatTraceStoreOptions = {}) {
    this.gatewayHome = options.gatewayHome ?? resolveGatewayHome();
    this.now = options.now ?? (() => Date.now());
    this.throttleMs = Math.max(0, options.throttleMs ?? 200);
    this.warn = options.warn ?? (() => undefined);
  }

  save(trace: WebChatTurnTrace): void {
    const key = traceKey(trace.userId, trace.sessionId, trace.messageId);
    const snapshot = cloneTrace(trace);
    if (trace.status !== "running") {
      this.clearPending(key);
      this.write(snapshot);
      this.lastWrittenAt.set(key, this.now());
      return;
    }

    const lastWritten = this.lastWrittenAt.get(key);
    if (lastWritten === undefined || this.now() - lastWritten >= this.throttleMs) {
      this.write(snapshot);
      this.lastWrittenAt.set(key, this.now());
      return;
    }

    const existing = this.pending.get(key);
    if (existing) {
      existing.trace = snapshot;
      return;
    }
    const delay = Math.max(0, this.throttleMs - (this.now() - lastWritten));
    const pending: PendingTrace = { trace: snapshot };
    pending.timer = setTimeout(() => {
      const current = this.pending.get(key);
      if (!current) return;
      this.pending.delete(key);
      this.write(current.trace);
      this.lastWrittenAt.set(key, this.now());
    }, delay);
    pending.timer.unref?.();
    this.pending.set(key, pending);
  }

  flush(): void {
    for (const [key, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      this.write(pending.trace);
      this.lastWrittenAt.set(key, this.now());
    }
    this.pending.clear();
  }

  get(
    userId: string,
    sessionId: string,
    messageId: string
  ): WebChatTurnTrace | null {
    const path = this.tracePath(userId, sessionId, messageId);
    return this.read(path);
  }

  list(userId: string, sessionId: string): WebChatTurnTrace[] {
    const directory = this.traceDirectory(userId, sessionId);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(join(directory, name)))
      .filter((trace): trace is WebChatTurnTrace => trace !== null)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  removeSession(userId: string, sessionId: string): void {
    const prefix = `${assertId(userId, "用户")}:${assertId(sessionId, "Session")}:`;
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) this.clearPending(key);
    }
    rmSync(this.traceDirectory(userId, sessionId), { recursive: true, force: true });
  }

  tracePath(userId: string, sessionId: string, messageId: string): string {
    return join(
      this.traceDirectory(userId, sessionId),
      `${assertId(messageId, "消息")}.json`
    );
  }

  private read(path: string): WebChatTurnTrace | null {
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as WebChatTurnTrace;
      return isTrace(parsed) ? parsed : null;
    } catch (error) {
      this.warn(`忽略损坏的 Web Chat Trace：${path}（${errorMessage(error)}）`);
      return null;
    }
  }

  private write(trace: WebChatTurnTrace): void {
    const path = this.tracePath(trace.userId, trace.sessionId, trace.messageId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(trace, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, path);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  }

  private traceDirectory(userId: string, sessionId: string): string {
    const sessions = resolveWebChatSessionsPath(assertId(userId, "用户"), {
      env: { CODEX_GATEWAY_HOME: this.gatewayHome },
    });
    return join(sessions, assertId(sessionId, "Session"), "traces");
  }

  private clearPending(key: string): void {
    const pending = this.pending.get(key);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pending.delete(key);
  }
}

function cloneTrace(trace: WebChatTurnTrace): WebChatTurnTrace {
  return structuredClone(trace);
}

function traceKey(userId: string, sessionId: string, messageId: string): string {
  return `${assertId(userId, "用户")}:${assertId(sessionId, "Session")}:${assertId(messageId, "消息")}`;
}

function assertId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`${label}标识不合法。`);
  }
  return normalized;
}

function isTrace(value: unknown): value is WebChatTurnTrace {
  if (!value || typeof value !== "object") return false;
  const trace = value as Partial<WebChatTurnTrace>;
  return (
    typeof trace.messageId === "string"
    && typeof trace.assistantMessageId === "string"
    && typeof trace.userId === "string"
    && typeof trace.sessionId === "string"
    && typeof trace.startedAt === "string"
    && typeof trace.updatedAt === "string"
    && Array.isArray(trace.entries)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

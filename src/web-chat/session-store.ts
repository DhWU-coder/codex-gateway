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
import {
  type CodexReasoningEffort,
  type CodexVerbosity,
  normalizeCodexReasoningEffort,
  normalizeCodexVerbosity,
} from "../codex/runtime-settings.js";
import {
  resolveGatewayHome,
  resolveWebChatSessionsPath,
} from "../paths.js";

export interface WebChatSessionRecord {
  id: string;
  userId: string;
  title: string;
  running: boolean;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  threadId?: string;
  goal?: string;
  planMode: boolean;
  permissionProfile?: WebChatPermissionProfile;
  forkedFrom?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebChatSessionInput {
  title?: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  threadId?: string;
  goal?: string;
  planMode?: boolean;
  permissionProfile?: WebChatPermissionProfile;
  forkedFrom?: string;
}

export type WebChatPermissionProfile = "read-only" | "workspace-write";

export interface WebChatThreadStateInput {
  threadId?: string | null;
  goal?: string | null;
  planMode?: boolean;
  permissionProfile?: WebChatPermissionProfile | null;
}

export interface WebChatSessionRuntimeInput {
  model?: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
  fast?: boolean | null;
  verbosity?: CodexVerbosity | null;
}

export interface WebChatSessionStoreOptions {
  gatewayHome?: string;
  now?: () => Date;
  createId?: () => string;
}

export class WebChatSessionStore {
  private readonly gatewayHome: string;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: WebChatSessionStoreOptions = {}) {
    this.gatewayHome = options.gatewayHome ?? resolveGatewayHome();
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => `chat-${randomUUID()}`);
  }

  create(userId: string, input: WebChatSessionInput = {}): WebChatSessionRecord {
    const id = this.createId();
    assertPathId(id, "Session");
    const timestamp = this.now().toISOString();
    const record: WebChatSessionRecord = {
      id,
      userId: assertPathId(userId, "用户"),
      title: normalizeTitle(input.title ?? "新对话"),
      running: false,
      model: normalizeModel(input.model),
      reasoningEffort: normalizeCodexReasoningEffort(input.reasoningEffort),
      fast: typeof input.fast === "boolean" ? input.fast : undefined,
      verbosity: normalizeCodexVerbosity(input.verbosity),
      threadId: normalizeThreadId(input.threadId),
      goal: normalizeGoal(input.goal),
      planMode: input.planMode === true,
      permissionProfile: normalizePermissionProfile(input.permissionProfile),
      forkedFrom: normalizePathId(input.forkedFrom),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    mkdirSync(this.historyPath(userId, id), { recursive: true, mode: 0o700 });
    this.write(record);
    return { ...record };
  }

  list(userId: string): WebChatSessionRecord[] {
    let directory: string;
    try {
      directory = this.sessionsPath(userId);
    } catch {
      return [];
    }
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.read(userId, entry.name))
      .filter((record): record is WebChatSessionRecord => record !== null)
      .sort((left, right) => {
        const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
        if (updatedOrder !== 0) return updatedOrder;
        const createdOrder = right.createdAt.localeCompare(left.createdAt);
        return createdOrder !== 0 ? createdOrder : left.id.localeCompare(right.id);
      });
  }

  get(userId: string, sessionId: string): WebChatSessionRecord | null {
    return this.read(userId, sessionId);
  }

  rename(
    userId: string,
    sessionId: string,
    title: string
  ): WebChatSessionRecord | null {
    const record = this.read(userId, sessionId);
    if (!record) return null;
    record.title = normalizeTitle(title);
    record.updatedAt = this.now().toISOString();
    this.write(record);
    return { ...record };
  }

  setRunning(
    userId: string,
    sessionId: string,
    running: boolean
  ): WebChatSessionRecord | null {
    const record = this.read(userId, sessionId);
    if (!record) return null;
    record.running = running;
    record.updatedAt = this.now().toISOString();
    this.write(record);
    return { ...record };
  }

  updateRuntime(
    userId: string,
    sessionId: string,
    input: WebChatSessionRuntimeInput
  ): WebChatSessionRecord | null {
    const record = this.read(userId, sessionId);
    if (!record || record.running) return null;
    if (Object.prototype.hasOwnProperty.call(input, "model")) {
      record.model = normalizeModel(input.model);
    }
    if (Object.prototype.hasOwnProperty.call(input, "reasoningEffort")) {
      record.reasoningEffort = normalizeCodexReasoningEffort(input.reasoningEffort);
    }
    if (Object.prototype.hasOwnProperty.call(input, "fast")) {
      record.fast = typeof input.fast === "boolean" ? input.fast : undefined;
    }
    if (Object.prototype.hasOwnProperty.call(input, "verbosity")) {
      record.verbosity = normalizeCodexVerbosity(input.verbosity);
    }
    record.updatedAt = this.now().toISOString();
    this.write(record);
    return { ...record };
  }

  updateThreadState(
    userId: string,
    sessionId: string,
    input: WebChatThreadStateInput
  ): WebChatSessionRecord | null {
    const record = this.read(userId, sessionId);
    if (!record) return null;
    if (Object.prototype.hasOwnProperty.call(input, "threadId")) {
      record.threadId = normalizeThreadId(input.threadId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "goal")) {
      record.goal = normalizeGoal(input.goal);
    }
    if (Object.prototype.hasOwnProperty.call(input, "planMode")) {
      record.planMode = input.planMode === true;
    }
    if (Object.prototype.hasOwnProperty.call(input, "permissionProfile")) {
      record.permissionProfile = normalizePermissionProfile(input.permissionProfile);
    }
    record.updatedAt = this.now().toISOString();
    this.write(record);
    return { ...record };
  }

  remove(userId: string, sessionId: string): boolean {
    const record = this.read(userId, sessionId);
    if (!record || record.running) return false;
    rmSync(this.sessionPath(userId, sessionId), { recursive: true, force: true });
    return true;
  }

  historyPath(userId: string, sessionId: string): string {
    return join(this.sessionPath(userId, sessionId), "history");
  }

  private read(userId: string, sessionId: string): WebChatSessionRecord | null {
    let path: string;
    try {
      path = this.recordPath(userId, sessionId);
    } catch {
      return null;
    }
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WebChatSessionRecord>;
      if (
        parsed.id !== sessionId ||
        parsed.userId !== userId ||
        typeof parsed.title !== "string" ||
        typeof parsed.running !== "boolean" ||
        typeof parsed.createdAt !== "string" ||
        typeof parsed.updatedAt !== "string"
      ) {
        return null;
      }
      return {
        id: parsed.id,
        userId: parsed.userId,
        title: normalizeTitle(parsed.title),
        running: parsed.running,
        model: normalizeModel(parsed.model),
        reasoningEffort: normalizeCodexReasoningEffort(parsed.reasoningEffort),
        fast: typeof parsed.fast === "boolean" ? parsed.fast : undefined,
        verbosity: normalizeCodexVerbosity(parsed.verbosity),
        threadId: normalizeThreadId(parsed.threadId),
        goal: normalizeGoal(parsed.goal),
        planMode: parsed.planMode === true,
        permissionProfile: normalizePermissionProfile(parsed.permissionProfile),
        forkedFrom: normalizePathId(parsed.forkedFrom),
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
      };
    } catch {
      return null;
    }
  }

  private write(record: WebChatSessionRecord): void {
    const path = this.recordPath(record.userId, record.id);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, path);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  }

  private sessionsPath(userId: string): string {
    return resolveWebChatSessionsPath(assertPathId(userId, "用户"), {
      env: { CODEX_GATEWAY_HOME: this.gatewayHome },
    });
  }

  private sessionPath(userId: string, sessionId: string): string {
    return join(
      this.sessionsPath(userId),
      assertPathId(sessionId, "Session")
    );
  }

  private recordPath(userId: string, sessionId: string): string {
    return join(this.sessionPath(userId, sessionId), "web-session.json");
  }
}

function normalizeTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title) return "新对话";
  return title.slice(0, 100);
}

function normalizeModel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeThreadId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 256) : undefined;
}

function normalizeGoal(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 4000) : undefined;
}

function normalizePermissionProfile(value: unknown): WebChatPermissionProfile | undefined {
  return value === "read-only" || value === "workspace-write" ? value : undefined;
}

function normalizePathId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return assertPathId(value, "路径");
}

function assertPathId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`${name}标识不合法。`);
  }
  return normalized;
}

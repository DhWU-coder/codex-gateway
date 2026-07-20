import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface SessionDefaults {
  cwd: string;
  model?: string;
}

export interface SessionMetadata {
  archiveId: string;
  conversationKey: string;
  sessionId?: string;
  cwd: string;
  model?: string;
  nativeSessionStarted: boolean;
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
  preview?: string;
  forkedFrom?: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface SessionSummary extends SessionMetadata {
  current: boolean;
  preview: string;
}

export interface SessionAiSummary {
  topic: string;
  keyInfo: string;
  recentAction: string;
  messageCount: number;
  updatedAt: string;
  model?: string;
  promptVersion?: number;
}

export interface SessionAiSummaryInput {
  topic: string;
  keyInfo: string;
  recentAction: string;
}

export interface SessionSummaryCacheContext {
  model?: string;
  promptVersion?: number;
}

interface SessionIndex {
  sessions: Array<{
    archiveId: string;
    sessionId?: string;
    createdAt: string;
    lastActiveAt: string;
    forkedFrom?: string;
  }>;
}

export class SessionHistoryStore {
  constructor(
    private readonly baseDir: string,
    private readonly createArchiveId: () => string = () => `session-${randomUUID()}`,
    private readonly maxSessions = 100
  ) {}

  readOrCreate(conversationKey: string, input: SessionDefaults): SessionMetadata {
    return this.read(conversationKey) ?? this.createNewSession(conversationKey, input);
  }

  createNewSession(conversationKey: string, input: SessionDefaults): SessionMetadata {
    const metadata = this.createMetadata(conversationKey, input);
    this.write(metadata);
    this.writeCurrentArchiveId(conversationKey, metadata.archiveId);
    this.pruneArchives(conversationKey);
    return metadata;
  }

  read(conversationKey: string): SessionMetadata | null {
    this.migrateLegacySession(conversationKey);
    const index = this.readIndex(conversationKey);
    const archiveId = this.resolveCurrentArchiveId(conversationKey, index);
    return archiveId ? this.readSessionArchive(conversationKey, archiveId) : null;
  }

  write(metadata: SessionMetadata): void {
    const normalized: SessionMetadata = {
      ...metadata,
      nativeSessionStarted: Boolean(metadata.sessionId) && metadata.nativeSessionStarted,
      messageCount: Math.max(0, Number(metadata.messageCount) || 0),
    };
    const path = join(
      this.archivedSessionDir(normalized.conversationKey, normalized.archiveId),
      "session.json"
    );
    atomicWriteJson(path, normalized);
    Object.assign(metadata, normalized);
    this.upsertIndex(normalized);
  }

  appendMessage(metadata: SessionMetadata, message: Omit<SessionMessage, "createdAt">): void {
    const dir = this.archivedSessionDir(metadata.conversationKey, metadata.archiveId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const entry: SessionMessage = {
      ...message,
      createdAt: new Date().toISOString(),
    };
    appendFileSync(join(dir, "messages.jsonl"), `${JSON.stringify(entry)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    metadata.messageCount = Math.max(0, metadata.messageCount) + 1;
    if (message.role === "user") metadata.preview = truncatePreview(message.text);
    metadata.lastActiveAt = entry.createdAt;
    this.write(metadata);
  }

  readRecentMessages(metadata: SessionMetadata, limit = 20): SessionMessage[] {
    return this.readMessages(metadata).slice(-limit);
  }

  readMessages(metadata: SessionMetadata): SessionMessage[] {
    return readMessagesFile(this.messagesPath(metadata.conversationKey, metadata.archiveId));
  }

  listSessions(conversationKey: string): SessionSummary[] {
    this.migrateLegacySession(conversationKey);
    const index = this.readIndex(conversationKey);
    const currentArchiveId = this.resolveCurrentArchiveId(conversationKey, index);
    return index.sessions
      .map((entry, indexPosition) => ({
        indexPosition,
        session: this.readSessionArchive(conversationKey, entry.archiveId),
      }))
      .filter(
        (item): item is { indexPosition: number; session: SessionMetadata } =>
          Boolean(item.session)
      )
      .sort((left, right) => {
        const timeOrder = right.session.lastActiveAt.localeCompare(left.session.lastActiveAt);
        return timeOrder === 0 ? right.indexPosition - left.indexPosition : timeOrder;
      })
      .map(({ session }) => {
        let preview = session.preview;
        if (preview === undefined) {
          preview = buildPreview(this.readMessages(session));
          session.preview = preview;
          this.write(session);
        }
        return {
          ...session,
          current: session.archiveId === currentArchiveId,
          preview,
        };
      });
  }

  resumeSession(conversationKey: string, archiveId: string): SessionMetadata | null {
    const session = this.readSessionArchive(conversationKey, archiveId);
    if (!session) return null;
    this.writeCurrentArchiveId(conversationKey, session.archiveId);
    return session;
  }

  forkSession(
    conversationKey: string,
    archiveId: string,
    input: SessionDefaults
  ): SessionMetadata | null {
    const source = this.readSessionArchive(conversationKey, archiveId);
    if (!source) return null;

    const fork: SessionMetadata = {
      ...this.createMetadata(conversationKey, input),
      messageCount: source.messageCount,
      preview: source.preview,
      forkedFrom: source.archiveId,
    };
    const sourceMessages = this.messagesPath(conversationKey, source.archiveId);
    const forkMessages = this.messagesPath(conversationKey, fork.archiveId);
    mkdirSync(dirname(forkMessages), { recursive: true, mode: 0o700 });
    if (existsSync(sourceMessages)) copyFileSync(sourceMessages, forkMessages);
    this.write(fork);
    this.writeCurrentArchiveId(conversationKey, fork.archiveId);
    this.pruneArchives(conversationKey);
    return fork;
  }

  readSessionSummary(
    session: SessionMetadata,
    context: SessionSummaryCacheContext = {}
  ): SessionAiSummary | null {
    const path = this.summaryPath(session.conversationKey, session.archiveId);
    if (!existsSync(path)) return null;
    try {
      const summary = JSON.parse(readFileSync(path, "utf-8")) as SessionAiSummary;
      if (summary.messageCount !== session.messageCount) return null;
      if (context.model !== undefined && summary.model !== context.model) return null;
      if (
        context.promptVersion !== undefined &&
        summary.promptVersion !== context.promptVersion
      ) {
        return null;
      }
      return summary;
    } catch {
      return null;
    }
  }

  writeSessionSummary(
    session: SessionMetadata,
    summary: SessionAiSummaryInput,
    context: SessionSummaryCacheContext = {}
  ): SessionAiSummary {
    const value: SessionAiSummary = {
      ...summary,
      messageCount: session.messageCount,
      updatedAt: new Date().toISOString(),
      ...(context.model ? { model: context.model } : {}),
      ...(context.promptVersion === undefined
        ? {}
        : { promptVersion: context.promptVersion }),
    };
    atomicWriteJson(this.summaryPath(session.conversationKey, session.archiveId), value);
    return value;
  }

  private createMetadata(conversationKey: string, input: SessionDefaults): SessionMetadata {
    const now = new Date().toISOString();
    return {
      archiveId: sanitizeArchiveId(this.createArchiveId()),
      conversationKey,
      cwd: input.cwd,
      model: input.model,
      nativeSessionStarted: false,
      createdAt: now,
      lastActiveAt: now,
      messageCount: 0,
      preview: "",
    };
  }

  private readSessionArchive(
    conversationKey: string,
    archiveId: string
  ): SessionMetadata | null {
    const path = join(this.archivedSessionDir(conversationKey, archiveId), "session.json");
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as SessionMetadata;
      if (typeof parsed.archiveId !== "string") return null;
      return {
        ...parsed,
        conversationKey,
        nativeSessionStarted: Boolean(parsed.sessionId) && parsed.nativeSessionStarted !== false,
        messageCount: Math.max(0, Number(parsed.messageCount) || 0),
      };
    } catch {
      return null;
    }
  }

  private migrateLegacySession(conversationKey: string): void {
    if (this.readCurrentArchiveId(conversationKey)) return;
    if (this.scanArchiveMetadata(conversationKey).length > 0) return;
    const legacyMetadataPath = join(this.sessionDir(conversationKey), "session.json");
    if (!existsSync(legacyMetadataPath)) return;

    try {
      const legacy = JSON.parse(readFileSync(legacyMetadataPath, "utf-8")) as Partial<SessionMetadata>;
      const now = new Date().toISOString();
      const archiveId = legacy.sessionId
        ? archiveIdForSessionId(legacy.sessionId)
        : sanitizeArchiveId(this.createArchiveId());
      const legacyMessagesPath = join(this.sessionDir(conversationKey), "messages.jsonl");
      const messages = readMessagesFile(legacyMessagesPath);
      const metadata: SessionMetadata = {
        archiveId,
        conversationKey,
        sessionId: legacy.sessionId,
        cwd: typeof legacy.cwd === "string" ? legacy.cwd : process.cwd(),
        model: typeof legacy.model === "string" ? legacy.model : undefined,
        nativeSessionStarted: Boolean(legacy.sessionId),
        createdAt: typeof legacy.createdAt === "string" ? legacy.createdAt : now,
        lastActiveAt: typeof legacy.lastActiveAt === "string" ? legacy.lastActiveAt : now,
        messageCount: messages.length,
        preview: buildPreview(messages),
      };
      const archiveMessagesPath = this.messagesPath(conversationKey, archiveId);
      mkdirSync(dirname(archiveMessagesPath), { recursive: true, mode: 0o700 });
      if (existsSync(legacyMessagesPath)) copyFileSync(legacyMessagesPath, archiveMessagesPath);
      this.write(metadata);
      this.writeCurrentArchiveId(conversationKey, archiveId);
    } catch {
      return;
    }
  }

  private readIndex(conversationKey: string): SessionIndex {
    const path = join(this.sessionDir(conversationKey), "index.json");
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf-8")) as SessionIndex;
        if (Array.isArray(parsed.sessions)) return parsed;
      } catch {}
    }
    const recovered = { sessions: this.scanArchiveMetadata(conversationKey).map(indexEntry) };
    if (recovered.sessions.length > 0) this.writeIndex(conversationKey, recovered);
    return recovered;
  }

  private scanArchiveMetadata(conversationKey: string): SessionMetadata[] {
    const dir = this.sessionDir(conversationKey);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const session = this.readSessionArchive(conversationKey, entry.name);
        return session ? [session] : [];
      });
  }

  private resolveCurrentArchiveId(
    conversationKey: string,
    index: SessionIndex
  ): string | null {
    const current = this.readCurrentArchiveId(conversationKey);
    if (current && index.sessions.some((entry) => entry.archiveId === current)) return current;
    const latest = [...index.sessions].sort((left, right) =>
      right.lastActiveAt.localeCompare(left.lastActiveAt)
    )[0];
    if (!latest) return null;
    this.writeCurrentArchiveId(conversationKey, latest.archiveId);
    return latest.archiveId;
  }

  private writeIndex(conversationKey: string, index: SessionIndex): void {
    atomicWriteJson(join(this.sessionDir(conversationKey), "index.json"), index);
  }

  private upsertIndex(session: SessionMetadata): void {
    const index = this.readIndex(session.conversationKey);
    const sessions = index.sessions.filter((entry) => entry.archiveId !== session.archiveId);
    sessions.push(indexEntry(session));
    this.writeIndex(session.conversationKey, { sessions });
  }

  private pruneArchives(conversationKey: string): void {
    const limit = Math.max(1, this.maxSessions);
    const index = this.readIndex(conversationKey);
    if (index.sessions.length <= limit) return;
    const current = this.resolveCurrentArchiveId(conversationKey, index);
    const ordered = [...index.sessions].sort((left, right) =>
      right.lastActiveAt.localeCompare(left.lastActiveAt)
    );
    const kept = ordered.slice(0, limit);
    if (current && !kept.some((entry) => entry.archiveId === current)) {
      kept[kept.length - 1] = index.sessions.find((entry) => entry.archiveId === current)!;
    }
    const keptIds = new Set(kept.map((entry) => entry.archiveId));
    for (const entry of index.sessions) {
      if (keptIds.has(entry.archiveId)) continue;
      rmSync(this.archivedSessionDir(conversationKey, entry.archiveId), {
        recursive: true,
        force: true,
      });
    }
    this.writeIndex(conversationKey, { sessions: kept });
  }

  private readCurrentArchiveId(conversationKey: string): string | null {
    const path = join(this.sessionDir(conversationKey), "current.json");
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as { archiveId?: unknown };
      return typeof parsed.archiveId === "string" ? parsed.archiveId : null;
    } catch {
      return null;
    }
  }

  private writeCurrentArchiveId(conversationKey: string, archiveId: string): void {
    atomicWriteJson(join(this.sessionDir(conversationKey), "current.json"), { archiveId });
  }

  private sessionDir(conversationKey: string): string {
    return join(this.baseDir, encodeConversationKey(conversationKey));
  }

  private archivedSessionDir(conversationKey: string, archiveId: string): string {
    return join(this.sessionDir(conversationKey), sanitizeArchiveId(archiveId));
  }

  private messagesPath(conversationKey: string, archiveId: string): string {
    return join(this.archivedSessionDir(conversationKey, archiveId), "messages.jsonl");
  }

  private summaryPath(conversationKey: string, archiveId: string): string {
    return join(this.archivedSessionDir(conversationKey, archiveId), "summary.json");
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

function indexEntry(session: SessionMetadata): SessionIndex["sessions"][number] {
  return {
    archiveId: session.archiveId,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    ...(session.forkedFrom ? { forkedFrom: session.forkedFrom } : {}),
  };
}

function readMessagesFile(path: string): SessionMessage[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as SessionMessage;
        return (parsed.role === "user" || parsed.role === "assistant") && parsed.text
          ? [parsed]
          : [];
      } catch {
        return [];
      }
    });
}

function buildPreview(messages: SessionMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return truncatePreview(latestUserMessage?.text ?? messages.at(-1)?.text ?? "");
}

function truncatePreview(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function archiveIdForSessionId(sessionId: string): string {
  return sanitizeArchiveId(sessionId.startsWith("session-") ? sessionId : `session-${sessionId}`);
}

function sanitizeArchiveId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "session";
}

function encodeConversationKey(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

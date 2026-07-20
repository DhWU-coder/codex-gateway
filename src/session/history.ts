import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

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
}

export interface SessionAiSummaryInput {
  topic: string;
  keyInfo: string;
  recentAction: string;
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
    private readonly createArchiveId: () => string = () => `session-${randomUUID()}`
  ) {}

  readOrCreate(conversationKey: string, input: SessionDefaults): SessionMetadata {
    return this.read(conversationKey) ?? this.createNewSession(conversationKey, input);
  }

  createNewSession(conversationKey: string, input: SessionDefaults): SessionMetadata {
    const metadata = this.createMetadata(conversationKey, input);
    this.write(metadata);
    this.writeCurrentArchiveId(conversationKey, metadata.archiveId);
    return metadata;
  }

  read(conversationKey: string): SessionMetadata | null {
    this.migrateLegacySession(conversationKey);
    const archiveId = this.readCurrentArchiveId(conversationKey);
    return archiveId ? this.readSessionArchive(conversationKey, archiveId) : null;
  }

  write(metadata: SessionMetadata): void {
    const normalized = {
      ...metadata,
      nativeSessionStarted: Boolean(metadata.sessionId) && metadata.nativeSessionStarted,
    };
    const dir = this.archivedSessionDir(normalized.conversationKey, normalized.archiveId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "session.json"), JSON.stringify(normalized, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    Object.assign(metadata, normalized);
    this.upsertIndex(normalized);
  }

  appendMessage(metadata: SessionMetadata, message: Omit<SessionMessage, "createdAt">): void {
    const dir = this.archivedSessionDir(metadata.conversationKey, metadata.archiveId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(
      join(dir, "messages.jsonl"),
      `${JSON.stringify({ ...message, createdAt: new Date().toISOString() })}\n`,
      { encoding: "utf-8", mode: 0o600 }
    );
    metadata.messageCount = this.readMessages(metadata).length;
    metadata.lastActiveAt = new Date().toISOString();
    this.write(metadata);
  }

  readRecentMessages(metadata: SessionMetadata, limit = 20): SessionMessage[] {
    return this.readMessages(metadata).slice(-limit);
  }

  readMessages(metadata: SessionMetadata): SessionMessage[] {
    return readMessagesFile(
      join(this.archivedSessionDir(metadata.conversationKey, metadata.archiveId), "messages.jsonl")
    );
  }

  listSessions(conversationKey: string): SessionSummary[] {
    this.migrateLegacySession(conversationKey);
    const currentArchiveId = this.readCurrentArchiveId(conversationKey);
    return this.readIndex(conversationKey)
      .sessions.map((entry, index) => ({
        index,
        session: this.readSessionArchive(conversationKey, entry.archiveId),
      }))
      .filter(
        (item): item is { index: number; session: SessionMetadata } => Boolean(item.session)
      )
      .sort((left, right) => {
        const timeOrder = right.session.lastActiveAt.localeCompare(left.session.lastActiveAt);
        return timeOrder === 0 ? right.index - left.index : timeOrder;
      })
      .map(({ session }) => {
        const messages = this.readMessages(session);
        return {
          ...session,
          current: session.archiveId === currentArchiveId,
          messageCount: messages.length,
          preview: buildPreview(messages),
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
      forkedFrom: source.archiveId,
    };
    this.write(fork);
    for (const message of this.readMessages(source)) {
      this.appendMessage(fork, { role: message.role, text: message.text });
    }
    this.writeCurrentArchiveId(conversationKey, fork.archiveId);
    return fork;
  }

  readSessionSummary(session: SessionMetadata): SessionAiSummary | null {
    const path = join(
      this.archivedSessionDir(session.conversationKey, session.archiveId),
      "summary.json"
    );
    if (!existsSync(path)) return null;
    try {
      const summary = JSON.parse(readFileSync(path, "utf-8")) as SessionAiSummary;
      return summary.messageCount === this.readMessages(session).length ? summary : null;
    } catch {
      return null;
    }
  }

  writeSessionSummary(
    session: SessionMetadata,
    summary: SessionAiSummaryInput
  ): SessionAiSummary {
    const dir = this.archivedSessionDir(session.conversationKey, session.archiveId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const value: SessionAiSummary = {
      ...summary,
      messageCount: this.readMessages(session).length,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, "summary.json"), JSON.stringify(value, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
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
      return typeof parsed.archiveId === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  private migrateLegacySession(conversationKey: string): void {
    if (this.readCurrentArchiveId(conversationKey)) return;
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
      };
      const archiveDir = this.archivedSessionDir(conversationKey, archiveId);
      mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
      if (existsSync(legacyMessagesPath)) {
        writeFileSync(join(archiveDir, "messages.jsonl"), readFileSync(legacyMessagesPath));
      }
      this.write(metadata);
      this.writeCurrentArchiveId(conversationKey, archiveId);
    } catch {
      return;
    }
  }

  private readIndex(conversationKey: string): SessionIndex {
    const path = join(this.sessionDir(conversationKey), "index.json");
    if (!existsSync(path)) return { sessions: [] };
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as SessionIndex;
      return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
    } catch {
      return { sessions: [] };
    }
  }

  private writeIndex(conversationKey: string, index: SessionIndex): void {
    const dir = this.sessionDir(conversationKey);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  private upsertIndex(session: SessionMetadata): void {
    const index = this.readIndex(session.conversationKey);
    const sessions = index.sessions.filter((entry) => entry.archiveId !== session.archiveId);
    sessions.push({
      archiveId: session.archiveId,
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      ...(session.forkedFrom ? { forkedFrom: session.forkedFrom } : {}),
    });
    this.writeIndex(session.conversationKey, { sessions });
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
    const dir = this.sessionDir(conversationKey);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "current.json"), JSON.stringify({ archiveId }, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  private sessionDir(conversationKey: string): string {
    return join(this.baseDir, encodeConversationKey(conversationKey));
  }

  private archivedSessionDir(conversationKey: string, archiveId: string): string {
    return join(this.sessionDir(conversationKey), sanitizeArchiveId(archiveId));
  }
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
  const preview = latestUserMessage?.text ?? messages.at(-1)?.text ?? "";
  return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
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

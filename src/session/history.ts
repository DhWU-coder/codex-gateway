import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SessionMetadata {
  conversationKey: string;
  sessionId?: string;
  cwd: string;
  model?: string;
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export class SessionHistoryStore {
  constructor(private readonly baseDir: string) {}

  readOrCreate(conversationKey: string, input: { cwd: string; model?: string }): SessionMetadata {
    const existing = this.read(conversationKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    return {
      conversationKey,
      cwd: input.cwd,
      model: input.model,
      createdAt: now,
      lastActiveAt: now,
      messageCount: 0,
    };
  }

  read(conversationKey: string): SessionMetadata | null {
    const path = this.metadataPath(conversationKey);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as SessionMetadata;
  }

  write(metadata: SessionMetadata): void {
    mkdirSync(this.sessionDir(metadata.conversationKey), { recursive: true, mode: 0o700 });
    writeFileSync(this.metadataPath(metadata.conversationKey), JSON.stringify(metadata, null, 2));
  }

  appendMessage(conversationKey: string, message: Omit<SessionMessage, "createdAt">): void {
    const line = JSON.stringify({ ...message, createdAt: new Date().toISOString() });
    mkdirSync(this.sessionDir(conversationKey), { recursive: true, mode: 0o700 });
    writeFileSync(this.messagesPath(conversationKey), `${line}\n`, { flag: "a" });
  }

  readRecentMessages(conversationKey: string, limit = 20): SessionMessage[] {
    const path = this.messagesPath(conversationKey);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);
    return lines.flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as SessionMessage;
        return parsed.role && parsed.text ? [parsed] : [];
      } catch {
        return [];
      }
    });
  }

  reset(conversationKey: string, input: { cwd: string; model?: string }): SessionMetadata {
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      conversationKey,
      cwd: input.cwd,
      model: input.model,
      createdAt: now,
      lastActiveAt: now,
      messageCount: 0,
    };
    mkdirSync(this.sessionDir(conversationKey), { recursive: true, mode: 0o700 });
    writeFileSync(this.messagesPath(conversationKey), "");
    this.write(metadata);
    return metadata;
  }

  private sessionDir(conversationKey: string): string {
    return join(this.baseDir, encodeConversationKey(conversationKey));
  }

  private metadataPath(conversationKey: string): string {
    return join(this.sessionDir(conversationKey), "session.json");
  }

  private messagesPath(conversationKey: string): string {
    return join(this.sessionDir(conversationKey), "messages.jsonl");
  }
}

function encodeConversationKey(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

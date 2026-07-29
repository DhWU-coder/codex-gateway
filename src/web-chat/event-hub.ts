export const WEB_CHAT_PUBLIC_EVENT_TYPES = [
  "session.created",
  "session.updated",
  "session.deleted",
  "session.running",
  "message.accepted",
  "message.progress",
  "message.activity",
  "message.trace",
  "message.completed",
  "message.failed",
  "file.available",
] as const;

export type WebChatPublicEventType =
  (typeof WEB_CHAT_PUBLIC_EVENT_TYPES)[number];

export interface WebChatPublicEvent {
  id: number;
  sessionId: string;
  type: WebChatPublicEventType;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface WebChatPublicEventInput {
  sessionId: string;
  type: WebChatPublicEventType;
  payload: Record<string, unknown>;
}

export interface WebChatEventReplay {
  events: WebChatPublicEvent[];
  reset: boolean;
}

export interface WebChatEventHubOptions {
  maxEventsPerUser?: number;
  now?: () => number;
}

type WebChatEventListener = (event: WebChatPublicEvent) => void;

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "stderr",
  "stdout",
  "command",
  "commandline",
  "raw",
  "toolinput",
  "tooloutput",
]);

export class WebChatEventHub {
  private readonly maxEventsPerUser: number;
  private readonly now: () => number;
  private readonly buffers = new Map<string, WebChatPublicEvent[]>();
  private readonly evictedThrough = new Map<string, number>();
  private readonly listeners = new Map<string, Set<WebChatEventListener>>();
  private nextId = 1;

  constructor(options: WebChatEventHubOptions = {}) {
    this.maxEventsPerUser = Math.max(1, options.maxEventsPerUser ?? 500);
    this.now = options.now ?? (() => Date.now());
  }

  publish(userId: string, input: WebChatPublicEventInput): WebChatPublicEvent {
    if (!WEB_CHAT_PUBLIC_EVENT_TYPES.includes(input.type)) {
      throw new Error("不支持的公开事件类型。");
    }
    if (!input.sessionId.trim()) throw new Error("公开事件必须包含 Session ID。");
    const forbiddenKey = findForbiddenKey(input.payload);
    if (forbiddenKey) {
      throw new Error(`公开事件不能包含管理员专属字段：${forbiddenKey}。`);
    }
    const event: WebChatPublicEvent = {
      id: this.nextId++,
      sessionId: input.sessionId,
      type: input.type,
      createdAt: new Date(this.now()).toISOString(),
      payload: projectPublicPayload(input.type, input.payload),
    };
    const buffer = this.buffers.get(userId) ?? [];
    buffer.push(event);
    if (buffer.length > this.maxEventsPerUser) {
      const removed = buffer.splice(0, buffer.length - this.maxEventsPerUser);
      const lastRemovedId = removed.at(-1)?.id;
      if (lastRemovedId !== undefined) this.evictedThrough.set(userId, lastRemovedId);
    }
    this.buffers.set(userId, buffer);
    for (const listener of this.listeners.get(userId) ?? []) listener(event);
    return structuredClone(event);
  }

  eventsSince(userId: string, lastEventId?: number): WebChatEventReplay {
    if (lastEventId === undefined) return { events: [], reset: false };
    const buffer = this.buffers.get(userId) ?? [];
    if (buffer.length === 0) return { events: [], reset: false };
    if (lastEventId < (this.evictedThrough.get(userId) ?? 0)) {
      return { events: [], reset: true };
    }
    return {
      events: buffer
        .filter((event) => event.id > lastEventId)
        .map((event) => structuredClone(event)),
      reset: false,
    };
  }

  subscribe(userId: string, listener: WebChatEventListener): () => void {
    const listeners = this.listeners.get(userId) ?? new Set<WebChatEventListener>();
    listeners.add(listener);
    this.listeners.set(userId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(userId);
    };
  }

  currentEventId(): number {
    return this.nextId - 1;
  }
}

function findForbiddenKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLocaleLowerCase("en-US"))) return key;
    const found = findForbiddenKey(nestedValue);
    if (found) return found;
  }
  return null;
}

function projectPublicPayload(
  type: WebChatPublicEventType,
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (type === "message.activity") {
    return compactObject({
      messageId: primitive(payload.messageId),
      activity: projectActivity(payload.activity),
    });
  }
  if (type === "message.trace") {
    return compactObject({
      messageId: primitive(payload.messageId),
      trace: projectTraceSummary(payload.trace),
    });
  }
  if (type === "message.accepted") {
    return compactObject({
      messageId: primitive(payload.messageId),
      text: primitive(payload.text),
      attachments: projectAttachments(payload.attachments),
      references: projectReferences(payload.references),
    });
  }
  if (type === "message.completed") {
    return compactObject({
      messageId: primitive(payload.messageId),
      text: primitive(payload.text),
      attachments: projectAttachments(payload.attachments),
    });
  }
  const allowed =
    type.startsWith("session.")
      ? ["session", "title", "running"]
      : type === "message.progress"
          ? ["messageId", "text"]
          : type === "message.failed"
              ? ["messageId", "message"]
              : type === "file.available"
                ? ["file"]
                : [];
  return pickPayload(payload, allowed);
}

function projectAttachments(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    return [
      pickPayload(item as Record<string, unknown>, [
        "id",
        "name",
        "kind",
        "mimeType",
        "size",
        "downloadUrl",
        "image",
      ]),
    ];
  });
}

function projectReferences(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    return [
      pickPayload(item as Record<string, unknown>, ["id", "name", "kind"]),
    ];
  });
}

function projectActivity(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return pickPayload(value as Record<string, unknown>, [
    "id",
    "type",
    "title",
    "status",
    "createdAt",
    "updatedAt",
    "durationMs",
  ]);
}

function projectTraceSummary(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return pickPayload(value as Record<string, unknown>, [
    "status",
    "summary",
    "latestActivity",
    "steps",
    "fileChanges",
    "updatedAt",
    "completedAt",
  ]);
}

function pickPayload(
  payload: Record<string, unknown>,
  allowed: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (payload[key] !== undefined) result[key] = structuredClone(payload[key]);
  }
  return result;
}

function compactObject(
  value: Record<string, unknown | undefined>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, unknown] => entry[1] !== undefined)
  );
}

function primitive(value: unknown): string | number | boolean | undefined {
  return typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    ? value
    : undefined;
}

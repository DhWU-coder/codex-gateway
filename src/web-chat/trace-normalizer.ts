import type { CodexProgressEvent } from "../codex/json-events.js";
import type {
  CreateWebChatTraceInput,
  WebChatTraceActivity,
  WebChatTraceEntry,
  WebChatTraceStatus,
  WebChatTraceToolGroupEntry,
  WebChatTurnTrace,
} from "./trace-types.js";

const MAX_TEXT_LENGTH = 4_000;
const MAX_TRACE_ENTRIES = 200;
const SENSITIVE_KEY =
  /^(authorization|cookie|password|passwd|secret|token|access_?token|refresh_?token|api_?key|app_?secret)$/i;

export interface WebChatTraceNormalizerOptions {
  now?: () => Date;
  createId?: () => string;
}

export class WebChatTraceNormalizer {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: WebChatTraceNormalizerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createId =
      options.createId ?? (() => `activity-${crypto.randomUUID()}`);
  }

  create(input: CreateWebChatTraceInput): WebChatTurnTrace {
    const timestamp = this.timestamp();
    return {
      messageId: input.messageId,
      assistantMessageId: input.assistantMessageId,
      userId: input.userId ?? "user-1",
      sessionId: input.sessionId ?? "chat-1",
      threadId: input.threadId,
      turnId: input.turnId,
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp,
      steps: { current: 0 },
      fileChanges: { files: 0 },
      entries: [],
    };
  }

  append(trace: WebChatTurnTrace, event: CodexProgressEvent): WebChatTurnTrace {
    const timestamp = this.timestamp();
    trace.updatedAt = timestamp;

    if (event.type === "assistant_text") {
      if (event.phase !== "final_answer" && event.text.trim()) {
        this.appendMessage(trace, "commentary", event.text, timestamp);
      }
    } else if (event.type === "reasoning") {
      this.appendMessage(trace, "reasoning", event.text, timestamp);
    } else if (event.type === "plan") {
      this.appendMessage(trace, "plan", event.text, timestamp);
      if (Array.isArray(event.steps)) trace.steps.total = event.steps.length;
    } else if (event.type === "tool_start") {
      this.appendTool(trace, {
        id: event.toolUseId ?? this.createId(),
        kind: activityKind(event.name),
        title: activityTitle(event.name, "running"),
        status: "running",
        startedAt: timestamp,
        input: sanitizeValue(event.input),
      }, timestamp);
    } else if (event.type === "tool_result") {
      this.completeTool(trace, event, timestamp);
    } else if (event.type === "file_change") {
      const counts = fileChangeCounts(event.changes);
      trace.fileChanges.files += counts.files;
      trace.fileChanges.additions =
        (trace.fileChanges.additions ?? 0) + counts.additions;
      trace.fileChanges.deletions =
        (trace.fileChanges.deletions ?? 0) + counts.deletions;
      this.appendTool(trace, {
        id: event.toolUseId ?? this.createId(),
        kind: "file_change",
        title: `已修改 ${counts.files} 个文件`,
        status: "completed",
        startedAt: timestamp,
        completedAt: timestamp,
        input: sanitizeValue(event.changes),
      }, timestamp);
    } else if (event.type === "web_search") {
      this.appendTool(trace, {
        id: event.toolUseId ?? this.createId(),
        kind: "web_search",
        title: event.query ? `已搜索：${sanitizeText(event.query)}` : "已完成 Web 搜索",
        status: "completed",
        startedAt: timestamp,
        completedAt: timestamp,
      }, timestamp);
    } else if (event.type === "context_compaction") {
      this.appendEntry(trace, {
        id: this.createId(),
        type: "context_compaction",
        title: "上下文已自动压缩",
        text: event.text ? sanitizeText(event.text) : undefined,
        createdAt: timestamp,
      });
      trace.latestActivity = "上下文已自动压缩";
    } else if (event.type === "stderr" && event.text.trim()) {
      this.appendTool(trace, {
        id: this.createId(),
        kind: "warning",
        title: "Codex 警告",
        status: "completed",
        startedAt: timestamp,
        completedAt: timestamp,
        output: sanitizeText(event.text),
      }, timestamp);
    }

    this.refreshGroupState(trace);
    return trace;
  }

  finalize(
    trace: WebChatTurnTrace,
    status: Exclude<WebChatTraceStatus, "running">,
    error?: string
  ): WebChatTurnTrace {
    const timestamp = this.timestamp();
    trace.status = status;
    trace.updatedAt = timestamp;
    trace.completedAt = timestamp;
    if (error) trace.error = sanitizeText(error);
    for (const entry of trace.entries) {
      if (entry.type !== "tool_group") continue;
      for (const activity of entry.activities) {
        if (activity.status !== "running") continue;
        activity.status = status === "failed" ? "failed" : "completed";
        activity.completedAt = timestamp;
      }
    }
    this.refreshGroupState(trace);
    const label =
      status === "completed" ? "完成" : status === "failed" ? "失败" : "已停止";
    trace.summary = `${label} · ${trace.steps.current} 个工具 · ${trace.entries.length} 条过程`;
    trace.latestActivity = status === "completed" ? "处理完成" : label;
    return trace;
  }

  private appendMessage(
    trace: WebChatTurnTrace,
    kind: "commentary" | "reasoning" | "plan",
    text: string,
    timestamp: string
  ): void {
    this.appendEntry(trace, {
      id: this.createId(),
      type: "message",
      kind,
      text: sanitizeText(text),
      createdAt: timestamp,
    });
    trace.latestActivity =
      kind === "plan" ? "已更新计划" : kind === "reasoning" ? "正在推理" : "Codex 正在回复";
  }

  private appendTool(
    trace: WebChatTurnTrace,
    activity: WebChatTraceActivity,
    timestamp: string
  ): void {
    let group = trace.entries.at(-1);
    if (!group || group.type !== "tool_group") {
      group = {
        id: this.createId(),
        type: "tool_group",
        title: activity.title,
        status: activity.status,
        createdAt: timestamp,
        updatedAt: timestamp,
        activities: [],
      };
      this.appendEntry(trace, group);
    }
    group.activities.push(activity);
    group.updatedAt = timestamp;
    trace.steps.current += 1;
    trace.latestActivity = activity.title;
  }

  private completeTool(
    trace: WebChatTurnTrace,
    event: Extract<CodexProgressEvent, { type: "tool_result" }>,
    timestamp: string
  ): void {
    const activity = findActivity(trace.entries, event.toolUseId);
    if (!activity) {
      this.appendTool(trace, {
        id: event.toolUseId ?? this.createId(),
        kind: activityKind(event.name),
        title: activityTitle(event.name, event.isError ? "failed" : "completed"),
        status: event.isError ? "failed" : "completed",
        startedAt: timestamp,
        completedAt: timestamp,
        durationMs: event.durationMs,
        output: sanitizeText(event.text),
      }, timestamp);
      return;
    }
    activity.status = event.isError ? "failed" : "completed";
    activity.title = activityTitle(event.name ?? activity.kind, activity.status);
    activity.completedAt = timestamp;
    activity.durationMs = event.durationMs;
    activity.output = sanitizeText(event.text);
    trace.latestActivity = activity.title;
  }

  private appendEntry(trace: WebChatTurnTrace, entry: WebChatTraceEntry): void {
    trace.entries.push(entry);
    if (trace.entries.length > MAX_TRACE_ENTRIES) {
      trace.entries.splice(0, trace.entries.length - MAX_TRACE_ENTRIES);
    }
  }

  private refreshGroupState(trace: WebChatTurnTrace): void {
    for (const entry of trace.entries) {
      if (entry.type !== "tool_group") continue;
      entry.status = entry.activities.some((activity) => activity.status === "failed")
        ? "failed"
        : entry.activities.some((activity) => activity.status === "running")
          ? "running"
          : "completed";
      entry.title = summarizeGroup(entry);
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function findActivity(
  entries: WebChatTraceEntry[],
  toolUseId?: string
): WebChatTraceActivity | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "tool_group") continue;
    const matched = toolUseId
      ? entry.activities.find((activity) => activity.id === toolUseId)
      : [...entry.activities].reverse().find((activity) => activity.status === "running");
    if (matched) return matched;
  }
  return undefined;
}

function summarizeGroup(group: WebChatTraceToolGroupEntry): string {
  const count = group.activities.length;
  const running = [...group.activities].reverse().find((item) => item.status === "running");
  if (running) return running.title;
  const failed = group.activities.filter((item) => item.status === "failed").length;
  return failed > 0
    ? `${count} 个工具调用，${failed} 个失败`
    : `${count} 个工具调用已完成`;
}

function activityKind(name?: string): WebChatTraceActivity["kind"] {
  const value = (name ?? "").toLowerCase();
  if (value.includes("command")) return "command";
  if (value.includes("file")) return "file_change";
  if (value.includes("search")) return "web_search";
  if (value.includes("mcp")) return "mcp";
  if (value.includes("dynamic")) return "dynamic_tool";
  if (value.includes("image")) return "image_view";
  return "tool";
}

function activityTitle(
  name: string | undefined,
  status: "running" | "completed" | "failed"
): string {
  const kind = activityKind(name);
  const label =
    kind === "command"
      ? "命令"
      : kind === "file_change"
        ? "文件修改"
        : kind === "web_search"
          ? "Web 搜索"
          : kind === "mcp"
            ? "MCP 工具"
            : kind === "dynamic_tool"
              ? "插件工具"
              : kind === "image_view"
                ? "图片查看"
                : name || "工具";
  return status === "running"
    ? `正在运行${label}`
    : status === "failed"
      ? `${label}执行失败`
      : `已完成${label}`;
}

function fileChangeCounts(changes: unknown[]): {
  files: number;
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    if (!isRecord(change)) continue;
    additions += finiteNumber(change.additions);
    deletions += finiteNumber(change.deletions);
  }
  return { files: changes.length, additions, deletions };
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") return sanitizeText(value);
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object") return sanitizeText(String(value));
  if (seen.has(value)) return "[循环引用]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[已隐藏]" : sanitizeValue(item, seen);
  }
  return output;
}

function sanitizeText(value: string): string {
  const redacted = value
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [已隐藏]")
    .replace(
      /\b(password|passwd|secret|token|api_?key|authorization)\s*[:=]\s*[^\s,;"']+/gi,
      "$1=[已隐藏]"
    );
  return redacted.length > MAX_TEXT_LENGTH
    ? `${redacted.slice(0, MAX_TEXT_LENGTH)}...`
    : redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

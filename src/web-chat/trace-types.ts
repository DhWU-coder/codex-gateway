export type WebChatTraceStatus = "running" | "completed" | "failed" | "stopped";

export interface WebChatTraceMessageEntry {
  id: string;
  type: "message";
  kind: "commentary" | "reasoning" | "plan";
  text: string;
  createdAt: string;
}

export interface WebChatTraceActivity {
  id: string;
  kind:
    | "command"
    | "file_change"
    | "web_search"
    | "mcp"
    | "dynamic_tool"
    | "image_view"
    | "tool"
    | "warning";
  title: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: string;
}

export interface WebChatTraceToolGroupEntry {
  id: string;
  type: "tool_group";
  title: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  activities: WebChatTraceActivity[];
}

export interface WebChatTraceContextEntry {
  id: string;
  type: "context_compaction";
  title: string;
  text?: string;
  createdAt: string;
}

export type WebChatTraceEntry =
  | WebChatTraceMessageEntry
  | WebChatTraceToolGroupEntry
  | WebChatTraceContextEntry;

export interface WebChatTurnTrace {
  messageId: string;
  assistantMessageId: string;
  userId: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  status: WebChatTraceStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  latestActivity?: string;
  steps: { current: number; total?: number };
  fileChanges: { files: number; additions?: number; deletions?: number };
  entries: WebChatTraceEntry[];
  summary?: string;
  error?: string;
}

export interface CreateWebChatTraceInput {
  messageId: string;
  assistantMessageId: string;
  userId?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
}

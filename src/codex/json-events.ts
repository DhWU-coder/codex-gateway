export interface ParsedCodexJsonEvents {
  sessionId?: string;
  assistantText: string;
}

export function parseCodexJsonEvents(output: string): ParsedCodexJsonEvents {
  let sessionId: string | undefined;
  let assistantText = "";

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    sessionId ??= findSessionId(parsed);
    assistantText += extractAssistantText(parsed);
  }

  return {
    sessionId,
    assistantText: assistantText.trim(),
  };
}

function findSessionId(event: Record<string, unknown>): string | undefined {
  const direct =
    stringField(event.session_id) ||
    stringField(event.sessionId) ||
    stringField(event.conversation_id) ||
    stringField(event.conversationId);
  if (direct) return direct;

  const nestedKeys = ["session", "conversation", "thread", "msg", "message"];
  for (const key of nestedKeys) {
    const nested = event[key];
    if (!isRecord(nested)) continue;
    const id =
      stringField(nested.id) ||
      stringField(nested.session_id) ||
      stringField(nested.sessionId) ||
      stringField(nested.conversation_id) ||
      stringField(nested.conversationId);
    if (id) return id;
  }
  return undefined;
}

function extractAssistantText(event: Record<string, unknown>): string {
  const type = stringField(event.type);
  if (type === "agent_message" || type === "assistant_message") {
    return (
      stringField(event.message) ||
      stringField(event.text) ||
      stringField(event.content) ||
      extractTextFromMessage(event.message)
    );
  }
  if (type === "assistant_delta" || type === "agent_message_delta") {
    return stringField(event.delta) || stringField(event.text);
  }
  if (type === "response.completed" || type === "result") {
    return stringField(event.result) || stringField(event.text);
  }
  return "";
}

function extractTextFromMessage(input: unknown): string {
  if (typeof input === "string") return input;
  if (!isRecord(input)) return "";
  return stringField(input.text) || stringField(input.content);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function stringField(input: unknown): string {
  return typeof input === "string" ? input : "";
}

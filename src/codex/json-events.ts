export interface ParsedCodexJsonEvents {
  sessionId?: string;
  assistantText: string;
  model?: string;
  requestId?: string;
  usage?: CodexUsage;
}

export interface CodexUsage {
  total: number;
  input: number;
  output: number;
  cached?: number;
  reasoning?: number;
}

export function parseCodexJsonEvents(output: string): ParsedCodexJsonEvents {
  let sessionId: string | undefined;
  let assistantText = "";
  let model: string | undefined;
  let requestId: string | undefined;
  let usage: CodexUsage | undefined;

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
    model ??= findModel(parsed);
    requestId ??= findRequestId(parsed);
    usage = findUsage(parsed) ?? usage;
  }

  return {
    sessionId,
    assistantText: assistantText.trim(),
    model,
    requestId,
    usage,
  };
}

function findSessionId(event: Record<string, unknown>): string | undefined {
  const direct =
    stringField(event.session_id) ||
    stringField(event.sessionId) ||
    stringField(event.thread_id) ||
    stringField(event.threadId) ||
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
      stringField(nested.thread_id) ||
      stringField(nested.threadId) ||
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

function findModel(event: Record<string, unknown>): string | undefined {
  const model =
    stringField(event.model) ||
    stringField(event.model_name) ||
    stringField(event.modelName) ||
    findNestedString(event, "model") ||
    findNestedString(event, "model_name");
  return model || undefined;
}

function findRequestId(event: Record<string, unknown>): string | undefined {
  const requestId =
    stringField(event.request_id) ||
    stringField(event.requestId) ||
    stringField(event.response_id) ||
    stringField(event.responseId);
  return requestId || undefined;
}

function findUsage(event: Record<string, unknown>): CodexUsage | undefined {
  const directUsage = isRecord(event.usage) ? event.usage : undefined;
  const response = isRecord(event.response) ? event.response : undefined;
  const responseUsage = response && isRecord(response.usage) ? response.usage : undefined;
  const usage = directUsage ?? responseUsage;
  if (!usage) return undefined;

  const input = firstNumber(usage.input_tokens, usage.prompt_tokens, usage.input);
  const output = firstNumber(usage.output_tokens, usage.completion_tokens, usage.output);
  const total = firstNumber(usage.total_tokens, usage.total);
  if (input === undefined || output === undefined || total === undefined) return undefined;

  const promptDetails = isRecord(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : undefined;
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
  const outputDetails = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : undefined;
  const cached = firstNumber(
    usage.cached_input_tokens,
    usage.cached_tokens,
    usage.cached,
    promptDetails?.cached_tokens,
    inputDetails?.cached_tokens
  );
  const reasoning = firstNumber(
    usage.reasoning_output_tokens,
    usage.reasoning_tokens,
    usage.reasoning,
    outputDetails?.reasoning_tokens
  );

  return {
    total,
    input,
    output,
    ...(cached === undefined ? {} : { cached }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

function findNestedString(event: Record<string, unknown>, key: string): string {
  for (const value of Object.values(event)) {
    if (!isRecord(value)) continue;
    const found = stringField(value[key]);
    if (found) return found;
  }
  return "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
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

export type WebChatCommandName =
  | "model"
  | "effort"
  | "fast"
  | "goal"
  | "plan"
  | "new"
  | "clear"
  | "fork"
  | "stop"
  | "compact"
  | "review"
  | "permissions"
  | "status"
  | "help";

export interface WebChatCommandDefinition {
  name: WebChatCommandName;
  description: string;
  takesArgument?: boolean;
}

export interface WebChatCommandRequest {
  name: WebChatCommandName;
  arguments: Record<string, unknown>;
}

export const WEB_CHAT_COMMANDS: WebChatCommandDefinition[] = [
  { name: "model", description: "选择当前会话模型", takesArgument: true },
  { name: "effort", description: "选择当前模型的推理强度", takesArgument: true },
  { name: "fast", description: "切换标准或 Fast 速度", takesArgument: true },
  { name: "goal", description: "查看、设置或清除当前目标", takesArgument: true },
  { name: "plan", description: "查看或切换 Plan Mode", takesArgument: true },
  { name: "new", description: "创建新会话" },
  { name: "clear", description: "清空当前 Codex 上下文" },
  { name: "fork", description: "分支当前会话" },
  { name: "stop", description: "停止当前执行" },
  { name: "compact", description: "压缩当前上下文" },
  { name: "review", description: "启动代码审查", takesArgument: true },
  { name: "permissions", description: "选择安全权限配置", takesArgument: true },
  { name: "status", description: "查看当前会话状态" },
  { name: "help", description: "查看可用命令" },
];

const COMMAND_NAMES = new Set<WebChatCommandName>(
  WEB_CHAT_COMMANDS.map((command) => command.name)
);

export function parseWebChatCommandText(
  text: string
): { name: WebChatCommandName; argument: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const matched = trimmed.match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!matched) throw new Error("命令格式不正确。");
  const name = matched[1]?.toLowerCase() as WebChatCommandName;
  if (!COMMAND_NAMES.has(name)) throw new Error(`不支持命令 /${name}。`);
  return { name, argument: matched[2]?.trim() ?? "" };
}

export function normalizeWebChatCommand(
  name: string,
  argumentsValue: unknown
): WebChatCommandRequest {
  const normalized = name.trim().toLowerCase() as WebChatCommandName;
  if (!COMMAND_NAMES.has(normalized)) {
    throw new Error(`不支持命令 /${normalized || name}。`);
  }
  return {
    name: normalized,
    arguments: isRecord(argumentsValue) ? { ...argumentsValue } : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

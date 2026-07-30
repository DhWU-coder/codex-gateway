import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INSTALLED_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function expandHomePath(value: string | undefined, homeDir = homedir()): string | undefined {
  if (!value) return undefined;
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return join(homeDir, value.slice(2));
  return value;
}

export function resolveGatewayHome(input?: { env?: NodeJS.ProcessEnv; homeDir?: string }): string {
  const env = input?.env ?? process.env;
  const homeDir = input?.homeDir ?? homedir();
  return expandHomePath(env.CODEX_GATEWAY_HOME, homeDir) ?? join(homeDir, ".codex-gateway");
}

export function resolveDefaultConfigPath(input?: {
  projectRoot?: string;
}): string {
  return resolve(input?.projectRoot ?? INSTALLED_PROJECT_ROOT, "config.yaml");
}

export function resolveConfigPath(
  value: string | undefined,
  input?: { cwd?: string; homeDir?: string; projectRoot?: string }
): string {
  const expanded = expandHomePath(value, input?.homeDir);
  return expanded
    ? resolve(input?.cwd ?? process.cwd(), expanded)
    : resolveDefaultConfigPath({ projectRoot: input?.projectRoot });
}

export function resolveDefaultWorkspacePath(input?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  accountId?: string;
}): string {
  const base = join(resolveGatewayHome(input), "workspace");
  return input?.accountId ? join(base, input.accountId) : base;
}

export function resolveDefaultHistoryPath(input?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  accountId?: string;
}): string {
  const accountId = input?.accountId ?? "default";
  return join(resolveGatewayHome(input), "channels", "feishu", accountId, "sessions");
}

export function resolveDefaultFeishuInstructionsPath(input?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  accountId?: string;
}): string {
  const accountId = input?.accountId ?? "default";
  return join(resolveGatewayHome(input), "channels", "feishu", accountId, "AGENTS.md");
}

export function resolveWebChatUsersPath(input?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): string {
  return join(resolveGatewayHome(input), "web-chat", "users.json");
}

export function resolveWebChatAuthSessionsPath(input?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): string {
  return join(resolveGatewayHome(input), "web-chat", "auth-sessions.json");
}

export function resolveWebChatUserRoot(
  userId: string,
  input?: { env?: NodeJS.ProcessEnv; homeDir?: string }
): string {
  return join(resolveGatewayHome(input), "channels", "web", safePathSegment(userId));
}

export function resolveWebChatWorkspacePath(
  userId: string,
  input?: { env?: NodeJS.ProcessEnv; homeDir?: string }
): string {
  return join(resolveWebChatUserRoot(userId, input), "workspace");
}

export function resolveWebChatSessionsPath(
  userId: string,
  input?: { env?: NodeJS.ProcessEnv; homeDir?: string }
): string {
  return join(resolveWebChatUserRoot(userId, input), "sessions");
}

function safePathSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error("路径标识只能包含字母、数字、下划线和连字符。");
  }
  return normalized;
}

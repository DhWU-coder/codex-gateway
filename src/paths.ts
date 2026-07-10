import { homedir } from "node:os";
import { join } from "node:path";

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
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): string {
  return join(resolveGatewayHome(input), "config.yaml");
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

import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  type CodexReasoningEffort,
  type CodexVerbosity,
  normalizeCodexReasoningEffort,
  normalizeCodexVerbosity,
} from "./codex/runtime-settings.js";
import {
  expandHomePath,
  resolveDefaultConfigPath,
  resolveDefaultFeishuInstructionsPath,
  resolveDefaultHistoryPath,
  resolveDefaultWorkspacePath,
} from "./paths.js";
import { DEFAULT_SERVICE_PORT, resolvePreferredServicePort } from "./service/ports.js";

export type FeishuDomain = "feishu" | "lark";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexConfig {
  command: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  sandbox?: CodexSandboxMode;
  profile?: string;
  search: boolean;
  skipGitRepoCheck: boolean;
  dangerouslyBypassApprovalsAndSandbox: boolean;
  extraArgs: string[];
}

export interface FeishuAccountConfig {
  id: string;
  enabled: boolean;
  appId?: string;
  appSecret?: string;
  botOpenId?: string;
  domain: FeishuDomain;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  cwd: string;
  historyBaseDir: string;
  instructionsPath?: string;
  sendProgressReplies: boolean;
  history?: FeishuHistoryConfig;
  summary?: FeishuSummaryConfig;
  messageDedupeTtlMs?: number;
}

export interface FeishuHistoryConfig {
  maxMessages: number;
  maxSessions: number;
}

export interface FeishuSummaryConfig {
  model?: string;
  maxMessages: number;
  concurrency: number;
}

export interface GatewayConfig {
  service: {
    port: number;
    cwd: string;
  };
  codex: CodexConfig;
  channels: {
    feishu: {
      accounts: FeishuAccountConfig[];
    };
  };
}

export interface LoadGatewayConfigOptions {
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function loadGatewayConfig(options: LoadGatewayConfigOptions = {}): GatewayConfig {
  const configPath = options.configPath ?? resolveDefaultConfigPath({ cwd: options.cwd });
  const raw = existsSync(configPath) ? parse(readFileSync(configPath, "utf-8")) : {};
  return loadGatewayConfigFromObject(raw, options);
}

export function loadGatewayConfigFromObject(
  rawInput: unknown,
  options: LoadGatewayConfigOptions = {}
): GatewayConfig {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir;
  const raw = asRecord(rawInput);
  const serviceRaw = asRecord(raw.service);
  const codexRaw = asRecord(raw.codex);
  const channelsRaw = asRecord(raw.channels);
  const feishuRaw = asRecord(channelsRaw.feishu);

  const serviceCwd =
    expandHomePath(readString(serviceRaw.cwd), homeDir) ??
    resolveDefaultWorkspacePath({ env, homeDir });
  const codex = loadCodexConfig(codexRaw, env);
  const accounts = loadFeishuAccounts({
    raw: feishuRaw,
    env,
    homeDir,
    defaultModel: codex.model,
    defaultReasoningEffort: codex.reasoningEffort,
    defaultFast: codex.fast,
    defaultVerbosity: codex.verbosity,
  });

  return {
    service: {
      port: readPort(serviceRaw.port) ?? resolvePreferredServicePort(env),
      cwd: serviceCwd,
    },
    codex,
    channels: {
      feishu: {
        accounts,
      },
    },
  };
}

function loadCodexConfig(raw: Record<string, unknown>, env: NodeJS.ProcessEnv): CodexConfig {
  return {
    command: readString(raw.command) || env.CODEX_COMMAND || "codex",
    model: readString(raw.model) || env.CODEX_MODEL || undefined,
    reasoningEffort: normalizeCodexReasoningEffort(raw.reasoningEffort),
    fast: readBoolean(raw.fast),
    verbosity: normalizeCodexVerbosity(raw.verbosity),
    sandbox: normalizeSandbox(readString(raw.sandbox)) ?? "danger-full-access",
    profile: readString(raw.profile),
    search: readBoolean(raw.search) ?? true,
    skipGitRepoCheck: readBoolean(raw.skipGitRepoCheck) ?? true,
    dangerouslyBypassApprovalsAndSandbox:
      readBoolean(raw.dangerouslyBypassApprovalsAndSandbox) ?? true,
    extraArgs: readStringArray(raw.extraArgs),
  };
}

function loadFeishuAccounts(input: {
  raw: Record<string, unknown>;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
  defaultModel?: string;
  defaultReasoningEffort?: CodexReasoningEffort;
  defaultFast?: boolean;
  defaultVerbosity?: CodexVerbosity;
}): FeishuAccountConfig[] {
  const accountInputs = Array.isArray(input.raw.accounts) ? input.raw.accounts : [input.raw];
  return accountInputs
    .map((accountRaw, index) =>
      normalizeFeishuAccount(asRecord(accountRaw), {
        env: input.env,
        homeDir: input.homeDir,
        defaultModel: input.defaultModel,
        defaultReasoningEffort: input.defaultReasoningEffort,
        defaultFast: input.defaultFast,
        defaultVerbosity: input.defaultVerbosity,
        defaultId: index === 0 ? "default" : `account-${index + 1}`,
      })
    )
    .filter((account) => account.id !== "default" || account.enabled || account.appId || account.appSecret);
}

function normalizeFeishuAccount(
  raw: Record<string, unknown>,
  input: {
    env: NodeJS.ProcessEnv;
    homeDir?: string;
    defaultModel?: string;
    defaultReasoningEffort?: CodexReasoningEffort;
    defaultFast?: boolean;
    defaultVerbosity?: CodexVerbosity;
    defaultId: string;
  }
): FeishuAccountConfig {
  const id = normalizeAccountId(readString(raw.id) || input.defaultId);
  const appId = readString(raw.appId) || input.env.FEISHU_APP_ID || undefined;
  const appSecret = readString(raw.appSecret) || input.env.FEISHU_APP_SECRET || undefined;
  const explicitEnabled = readBoolean(raw.enabled);
  const historyRaw = asRecord(raw.history);
  const summaryRaw = asRecord(raw.summary);
  const cwd =
    expandHomePath(readString(raw.cwd), input.homeDir) ??
    resolveDefaultWorkspacePath({
      env: input.env,
      homeDir: input.homeDir,
      accountId: id === "default" ? undefined : id,
    });

  return {
    id,
    enabled: explicitEnabled ?? Boolean(appId && appSecret),
    appId,
    appSecret,
    botOpenId:
      readString(raw.botOpenId) ||
      input.env.CODEX_GATEWAY_FEISHU_BOT_OPEN_ID ||
      input.env.FEISHU_BOT_OPEN_ID ||
      undefined,
    domain: normalizeDomain(readString(raw.domain) || input.env.FEISHU_DOMAIN),
    model: readString(raw.model) || input.defaultModel,
    reasoningEffort:
      normalizeCodexReasoningEffort(raw.reasoningEffort) ?? input.defaultReasoningEffort,
    fast: readBoolean(raw.fast) ?? input.defaultFast,
    verbosity: normalizeCodexVerbosity(raw.verbosity) ?? input.defaultVerbosity,
    cwd,
    historyBaseDir:
      expandHomePath(readString(raw.historyBaseDir), input.homeDir) ??
      resolveDefaultHistoryPath({ env: input.env, homeDir: input.homeDir, accountId: id }),
    instructionsPath: resolveDefaultFeishuInstructionsPath({
      env: input.env,
      homeDir: input.homeDir,
      accountId: id,
    }),
    sendProgressReplies: readBoolean(raw.sendProgressReplies) ?? false,
    history: {
      maxMessages: readPositiveInteger(historyRaw.maxMessages) ?? 50,
      maxSessions: readPositiveInteger(historyRaw.maxSessions) ?? 100,
    },
    summary: {
      model: readString(summaryRaw.model),
      maxMessages: readPositiveInteger(summaryRaw.maxMessages) ?? 50,
      concurrency: readPositiveInteger(summaryRaw.concurrency) ?? 5,
    },
    messageDedupeTtlMs: readPositiveInteger(raw.messageDedupeTtlMs) ?? 10 * 60 * 1000,
  };
}

export function normalizeAccountId(value: string): string {
  const id = value.trim() || "default";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`Invalid Feishu account id: ${id}`);
  }
  return id;
}

function normalizeDomain(value: string | undefined): FeishuDomain {
  return value?.trim().toLowerCase() === "lark" ? "lark" : "feishu";
}

function normalizeSandbox(value: string | undefined): CodexSandboxMode | undefined {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readPort(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const port = typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return DEFAULT_SERVICE_PORT;
  return port;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

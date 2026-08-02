import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
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
    host: string;
    port: number;
    cwd: string;
  };
  webChat: {
    registrationEnabled: boolean;
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
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export function loadGatewayConfig(options: LoadGatewayConfigOptions = {}): GatewayConfig {
  const configPath = resolve(
    options.configPath ??
      resolveDefaultConfigPath({ projectRoot: options.projectRoot })
  );
  const raw = existsSync(configPath) ? parse(readFileSync(configPath, "utf-8")) : {};
  return loadGatewayConfigFromObject(raw, {
    ...options,
    projectRoot: options.projectRoot ?? dirname(configPath),
  });
}

export function loadGatewayConfigFromObject(
  rawInput: unknown,
  options: LoadGatewayConfigOptions = {}
): GatewayConfig {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir;
  const projectRoot = options.projectRoot ?? dirname(resolveDefaultConfigPath());
  const platform = options.platform ?? process.platform;
  const raw = asRecord(rawInput);
  const serviceRaw = asRecord(raw.service);
  const webChatRaw = asRecord(raw.webChat);
  const codexRaw = asRecord(raw.codex);
  const channelsRaw = asRecord(raw.channels);
  const feishuRaw = asRecord(channelsRaw.feishu);

  const serviceCwd =
    resolveConfiguredPath(readString(serviceRaw.cwd), homeDir, projectRoot) ??
    resolveDefaultWorkspacePath({ env, homeDir, projectRoot });
  const codex = loadCodexConfig(codexRaw, env, platform);
  const accounts = loadFeishuAccounts({
    raw: feishuRaw,
    env,
    homeDir,
    projectRoot,
    defaultModel: codex.model,
    defaultReasoningEffort: codex.reasoningEffort,
    defaultFast: codex.fast,
    defaultVerbosity: codex.verbosity,
  });

  return {
    service: {
      host: normalizeServiceHost(readString(serviceRaw.host) || env.CODEX_GATEWAY_SERVICE_HOST),
      port: readPort(serviceRaw.port) ?? resolvePreferredServicePort(env),
      cwd: serviceCwd,
    },
    webChat: {
      registrationEnabled: readBoolean(webChatRaw.registrationEnabled) ?? false,
    },
    codex,
    channels: {
      feishu: {
        accounts,
      },
    },
  };
}

function normalizeServiceHost(value: string | undefined): string {
  return value === "0.0.0.0" ? value : "127.0.0.1";
}

function loadCodexConfig(
  raw: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): CodexConfig {
  const configuredCommand = readString(raw.command) || env.CODEX_COMMAND || "codex";
  return {
    command:
      platform === "win32" && configuredCommand.toLowerCase() === "codex"
        ? "codex.cmd"
        : configuredCommand,
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
  projectRoot: string;
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
        projectRoot: input.projectRoot,
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
    projectRoot: string;
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
    resolveConfiguredPath(readString(raw.cwd), input.homeDir, input.projectRoot) ??
    resolveDefaultWorkspacePath({
      env: input.env,
      homeDir: input.homeDir,
      projectRoot: input.projectRoot,
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
      resolveConfiguredPath(readString(raw.historyBaseDir), input.homeDir, input.projectRoot) ??
      resolveDefaultHistoryPath({
        env: input.env,
        homeDir: input.homeDir,
        projectRoot: input.projectRoot,
        accountId: id,
      }),
    instructionsPath: resolveDefaultFeishuInstructionsPath({
      env: input.env,
      homeDir: input.homeDir,
      projectRoot: input.projectRoot,
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
    messageDedupeTtlMs:
      readPositiveInteger(raw.messageDedupeTtlMs) ?? 7 * 24 * 60 * 60 * 1000,
  };
}

function resolveConfiguredPath(
  value: string | undefined,
  homeDir: string | undefined,
  projectRoot: string
): string | undefined {
  const expanded = expandHomePath(value, homeDir);
  if (!expanded) return undefined;
  return isAbsolute(expanded) ? expanded : resolve(projectRoot, expanded);
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

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { parse, parseDocument } from "yaml";
import {
  type CodexReasoningEffort,
  type CodexVerbosity,
  normalizeCodexReasoningEffort,
  normalizeCodexVerbosity,
} from "../codex/runtime-settings.js";

export interface FeishuAccountEditorState {
  id: string;
  originalId: string;
  enabled: boolean;
  appId: string;
  appSecret: string;
  hasAppSecret: boolean;
  botOpenId: string;
  domain: "feishu" | "lark";
  sendProgressReplies: boolean;
  model?: string;
  reasoningEffort?: CodexReasoningEffort | "";
  fast?: boolean | null;
  verbosity?: CodexVerbosity | "";
  cwd?: string;
  historyBaseDir?: string;
}

export interface FeishuAccountsEditorState {
  accounts: FeishuAccountEditorState[];
}

export interface CodexModelEditorState {
  model: string;
  reasoningEffort: CodexReasoningEffort | "";
  fast: boolean | null;
  verbosity: CodexVerbosity | "";
}

export interface SaveCodexModelInput {
  model?: unknown;
  reasoningEffort?: unknown;
  fast?: unknown;
  verbosity?: unknown;
}

export interface SaveFeishuAccountsInput {
  accounts?: Array<Partial<FeishuAccountEditorState>>;
}

type RawAccount = Record<string, unknown>;
type RawConfig = Record<string, unknown> & {
  codex?: Record<string, unknown>;
  channels?: {
    feishu?: Record<string, unknown> & { accounts?: unknown[] };
  };
};

export function getCodexModelEditorState(configPath: string): CodexModelEditorState {
  const codex = readRawConfig(configPath).codex;
  return {
    model: readString(codex?.model) ?? "",
    reasoningEffort: normalizeCodexReasoningEffort(codex?.reasoningEffort) ?? "",
    fast: typeof codex?.fast === "boolean" ? codex.fast : null,
    verbosity: normalizeCodexVerbosity(codex?.verbosity) ?? "",
  };
}

export function saveCodexModelEditorState(
  input: SaveCodexModelInput,
  configPath: string
): CodexModelEditorState {
  if (typeof input.model !== "string") throw new Error("model 必须是字符串");
  const text = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const document = parseDocument(text || "{}\n");
  const model = readString(input.model);
  if (model) document.setIn(["codex", "model"], model);
  else document.deleteIn(["codex", "model"]);
  updateGlobalEnum(
    document,
    input,
    "reasoningEffort",
    normalizeCodexReasoningEffort
  );
  updateGlobalFast(document, input);
  updateGlobalEnum(document, input, "verbosity", normalizeCodexVerbosity);
  writeConfigAtomically(configPath, document.toString());
  return getCodexModelEditorState(configPath);
}

export function getFeishuAccountsEditorState(configPath: string): FeishuAccountsEditorState {
  return {
    accounts: readRawAccounts(readRawConfig(configPath)).map(toEditorAccount),
  };
}

export function getFeishuAccountSecret(
  accountId: string,
  configPath: string
): { appSecret: string } | undefined {
  const id = normalizeId(accountId);
  const account = readRawAccounts(readRawConfig(configPath)).find(
    (item) => readAccountId(item) === id
  );
  const appSecret = readString(account?.appSecret);
  return appSecret ? { appSecret } : undefined;
}

export function saveFeishuAccountsEditorState(
  input: SaveFeishuAccountsInput,
  configPath: string
): FeishuAccountsEditorState {
  if (!Array.isArray(input.accounts)) throw new Error("accounts 必须是数组");
  const text = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const existingAccounts = readRawAccounts(readRawConfig(configPath));
  const existingById = new Map(
    existingAccounts.map((account) => [readAccountId(account), account])
  );
  const seen = new Set<string>();
  const accounts = input.accounts.map((account) => {
    const id = normalizeId(account.id);
    if (seen.has(id)) throw new Error(`飞书账号 ID 重复：${id}`);
    seen.add(id);
    const originalId = normalizeId(account.originalId ?? account.id);
    return normalizeSavedAccount(id, account, existingById.get(originalId));
  });
  const document = parseDocument(text || "{}\n");
  document.setIn(["channels", "feishu", "accounts"], accounts);
  writeConfigAtomically(configPath, document.toString());
  return getFeishuAccountsEditorState(configPath);
}

function normalizeSavedAccount(
  id: string,
  input: Partial<FeishuAccountEditorState>,
  existing: RawAccount | undefined
): RawAccount {
  const appId = readString(input.appId);
  if (!appId) throw new Error(`账号 ${id} 缺少 App ID`);
  const appSecret = readString(input.appSecret) ?? readString(existing?.appSecret);
  if (!appSecret) throw new Error(`账号 ${id} 缺少 App Secret`);
  const domain = readDomain(input.domain, id);
  const next: RawAccount = {
    ...(existing ?? {}),
    id,
    enabled: input.enabled !== false,
    appId,
    appSecret,
    domain,
    sendProgressReplies: input.sendProgressReplies === true,
  };
  const botOpenId = readString(input.botOpenId);
  if (botOpenId) next.botOpenId = botOpenId;
  else delete next.botOpenId;
  if (Object.prototype.hasOwnProperty.call(input, "model")) {
    const model = readString(input.model);
    if (model) next.model = model;
    else delete next.model;
  }
  if (Object.prototype.hasOwnProperty.call(input, "reasoningEffort")) {
    const value = readOptionalEnum(
      input.reasoningEffort,
      normalizeCodexReasoningEffort,
      `账号 ${id} 的 reasoningEffort`
    );
    if (value) next.reasoningEffort = value;
    else delete next.reasoningEffort;
  }
  if (Object.prototype.hasOwnProperty.call(input, "fast")) {
    if (input.fast === null || input.fast === undefined) delete next.fast;
    else if (typeof input.fast === "boolean") next.fast = input.fast;
    else throw new Error(`账号 ${id} 的 fast 必须是布尔值或 null`);
  }
  if (Object.prototype.hasOwnProperty.call(input, "verbosity")) {
    const value = readOptionalEnum(
      input.verbosity,
      normalizeCodexVerbosity,
      `账号 ${id} 的 verbosity`
    );
    if (value) next.verbosity = value;
    else delete next.verbosity;
  }
  return next;
}

function toEditorAccount(account: RawAccount): FeishuAccountEditorState {
  const id = readAccountId(account);
  const appSecret = readString(account.appSecret);
  const state: FeishuAccountEditorState = {
    id,
    originalId: id,
    enabled: account.enabled !== false,
    appId: readString(account.appId) ?? "",
    appSecret: "",
    hasAppSecret: Boolean(appSecret),
    botOpenId: readString(account.botOpenId) ?? "",
    domain: readDomain(account.domain, id),
    sendProgressReplies: account.sendProgressReplies === true,
  };
  copyOptionalString(account, state, "model");
  const reasoningEffort = normalizeCodexReasoningEffort(account.reasoningEffort);
  if (reasoningEffort) state.reasoningEffort = reasoningEffort;
  if (typeof account.fast === "boolean") state.fast = account.fast;
  const verbosity = normalizeCodexVerbosity(account.verbosity);
  if (verbosity) state.verbosity = verbosity;
  copyOptionalString(account, state, "cwd");
  copyOptionalString(account, state, "historyBaseDir");
  return state;
}

function copyOptionalString(
  source: RawAccount,
  target: FeishuAccountEditorState,
  key: "model" | "cwd" | "historyBaseDir"
): void {
  const value = readString(source[key]);
  if (value) target[key] = value;
}

function readRawConfig(configPath: string): RawConfig {
  if (!existsSync(configPath)) return {};
  const value = parse(readFileSync(configPath, "utf-8"));
  return isRecord(value) ? (value as RawConfig) : {};
}

function readRawAccounts(config: RawConfig): RawAccount[] {
  const feishu = config.channels?.feishu;
  if (!isRecord(feishu)) return [];
  if (Array.isArray(feishu.accounts)) {
    return feishu.accounts.filter(isRecord);
  }
  if (readString(feishu.appId) || feishu.enabled !== undefined) {
    return [{ ...feishu, id: readString(feishu.id) ?? "default" }];
  }
  return [];
}

function writeConfigAtomically(configPath: string, content: string): void {
  const directory = dirname(configPath);
  const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf-8", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, configPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function updateGlobalEnum<T extends string>(
  document: ReturnType<typeof parseDocument>,
  input: SaveCodexModelInput,
  key: "reasoningEffort" | "verbosity",
  normalize: (value: unknown) => T | undefined
): void {
  if (!Object.prototype.hasOwnProperty.call(input, key)) return;
  const value = readOptionalEnum(input[key], normalize, key);
  if (value) document.setIn(["codex", key], value);
  else document.deleteIn(["codex", key]);
}

function updateGlobalFast(
  document: ReturnType<typeof parseDocument>,
  input: SaveCodexModelInput
): void {
  if (!Object.prototype.hasOwnProperty.call(input, "fast")) return;
  if (input.fast === null || input.fast === undefined) {
    document.deleteIn(["codex", "fast"]);
    return;
  }
  if (typeof input.fast !== "boolean") throw new Error("fast 必须是布尔值或 null");
  document.setIn(["codex", "fast"], input.fast);
}

function readOptionalEnum<T extends string>(
  value: unknown,
  normalize: (value: unknown) => T | undefined,
  label: string
): T | undefined {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = normalize(trimmed);
  if (!normalized) throw new Error(`${label} 无效：${trimmed}`);
  return normalized;
}

function readDomain(value: unknown, id: string): "feishu" | "lark" {
  const domain = readString(value)?.toLowerCase() ?? "feishu";
  if (domain === "feishu" || domain === "lark") return domain;
  throw new Error(`飞书账号 ${id} 的域名无效：${domain}`);
}

function readAccountId(account: RawAccount): string {
  return normalizeId(account.id);
}

function normalizeId(value: unknown): string {
  return readString(value) ?? "default";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

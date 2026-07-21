import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  type CodexReasoningEffort,
  normalizeCodexReasoningEffort,
} from "./runtime-settings.js";

export interface CodexModelOption {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  defaultReasoningEffort?: CodexReasoningEffort;
  additionalSpeedTiers: string[];
  serviceTiers: CodexModelServiceTier[];
  supportsFast: boolean;
  isDefault: boolean;
}

export interface CodexReasoningEffortOption {
  reasoningEffort: CodexReasoningEffort;
  description: string;
}

export interface CodexModelServiceTier {
  id: string;
  name: string;
  description: string;
}

export interface ReadCodexModelsOptions {
  command?: string;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}

export interface CodexModelCatalog {
  list(): Promise<CodexModelOption[]>;
}

export interface CreateCodexModelCatalogOptions extends ReadCodexModelsOptions {
  ttlMs?: number;
  now?: () => number;
}

const INITIALIZE_REQUEST_ID = 1;
const MODEL_LIST_REQUEST_ID = 2;

export async function readCodexModels(
  options: ReadCodexModelsOptions = {}
): Promise<CodexModelOption[]> {
  const command = options.command?.trim() || "codex";
  const timeoutMs = positiveNumber(options.timeoutMs, 10_000);
  const spawnProcess = options.spawnProcess ?? spawn;

  return new Promise<CodexModelOption[]>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(command, ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      reject(new Error(`无法启动 Codex 模型目录：${formatError(error)}`));
      return;
    }

    const lines = createInterface({ input: child.stdout });
    let settled = false;
    let stderr = "";
    const timer = setTimeout(() => {
      finish(new Error(`读取 Codex 模型列表超时（${timeoutMs} ms）`));
    }, timeoutMs);

    const finish = (error?: Error, models?: CodexModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      if (error) reject(error);
      else resolve(models ?? []);
    };

    const send = (message: unknown) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(new Error(`Codex 模型目录进程启动失败：${formatError(error)}`));
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      const detail = stderr.trim();
      finish(
        new Error(
          `Codex 模型目录进程提前退出：${code ?? signal ?? "unknown"}${
            detail ? `；${detail}` : ""
          }`
        )
      );
    });
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line);
        if (!isRecord(parsed)) return;
        message = parsed;
      } catch {
        finish(new Error("Codex 模型列表响应不是有效 JSON。"));
        return;
      }

      if (message.id === INITIALIZE_REQUEST_ID) {
        const protocolError = readProtocolError(message);
        if (protocolError) {
          finish(new Error(`Codex app-server 初始化失败：${protocolError}`));
          return;
        }
        send({ method: "initialized", params: {} });
        send({
          id: MODEL_LIST_REQUEST_ID,
          method: "model/list",
          params: { includeHidden: false, limit: 100 },
        });
        return;
      }

      if (message.id === MODEL_LIST_REQUEST_ID) {
        const protocolError = readProtocolError(message);
        if (protocolError) {
          finish(new Error(`读取 Codex 模型列表失败：${protocolError}`));
          return;
        }
        try {
          finish(undefined, normalizeModelList(message.result));
        } catch (error) {
          finish(new Error(`Codex 模型列表格式无效：${formatError(error)}`));
        }
      }
    });

    send({
      id: INITIALIZE_REQUEST_ID,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex_gateway",
          title: "Codex Gateway",
          version: "0.1.0",
        },
      },
    });
  });
}

export function createCodexModelCatalog(
  options: CreateCodexModelCatalogOptions = {}
): CodexModelCatalog {
  const ttlMs = positiveNumber(options.ttlMs, 5 * 60_000);
  const now = options.now ?? Date.now;
  let cached: { expiresAt: number; models: CodexModelOption[] } | undefined;
  let pending: Promise<CodexModelOption[]> | undefined;

  return {
    async list() {
      if (cached && cached.expiresAt > now()) return cached.models;
      if (pending) return pending;
      pending = readCodexModels(options)
        .then((models) => {
          cached = { expiresAt: now() + ttlMs, models };
          return models;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}

function normalizeModelList(value: unknown): CodexModelOption[] {
  const result = isRecord(value) ? value : {};
  if (!Array.isArray(result.data)) throw new Error("缺少 data 数组");
  const seen = new Set<string>();
  const models: CodexModelOption[] = [];
  for (const raw of result.data) {
    if (!isRecord(raw) || raw.hidden === true) continue;
    const model = readString(raw.model) ?? readString(raw.id);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const supportedReasoningEfforts = normalizeReasoningEfforts(raw.supportedReasoningEfforts);
    const defaultReasoningEffort = normalizeCodexReasoningEffort(raw.defaultReasoningEffort);
    const additionalSpeedTiers = normalizeStringList(raw.additionalSpeedTiers);
    const serviceTiers = normalizeServiceTiers(raw.serviceTiers);
    models.push({
      id: readString(raw.id) ?? model,
      model,
      displayName: readString(raw.displayName) ?? model,
      description: readString(raw.description) ?? "",
      supportedReasoningEfforts,
      ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
      additionalSpeedTiers,
      serviceTiers,
      supportsFast:
        additionalSpeedTiers.includes("fast") ||
        serviceTiers.some(
          (tier) => tier.id === "fast" || tier.id === "priority" || tier.name.toLowerCase() === "fast"
        ),
      isDefault: raw.isDefault === true,
    });
  }
  return models.sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}

function normalizeReasoningEfforts(value: unknown): CodexReasoningEffortOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<CodexReasoningEffort>();
  const options: CodexReasoningEffortOption[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const reasoningEffort = normalizeCodexReasoningEffort(raw.reasoningEffort);
    if (!reasoningEffort || seen.has(reasoningEffort)) continue;
    seen.add(reasoningEffort);
    options.push({
      reasoningEffort,
      description: readString(raw.description) ?? "",
    });
  }
  return options;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(readString).filter((item): item is string => Boolean(item))));
}

function normalizeServiceTiers(value: unknown): CodexModelServiceTier[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const id = readString(raw.id);
    if (!id) return [];
    return [
      {
        id,
        name: readString(raw.name) ?? id,
        description: readString(raw.description) ?? "",
      },
    ];
  });
}

function readProtocolError(message: Record<string, unknown>): string | undefined {
  if (!isRecord(message.error)) return undefined;
  return readString(message.error.message) ?? JSON.stringify(message.error);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

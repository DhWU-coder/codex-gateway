import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ChannelManager } from "./channel-manager.js";
import { loadGatewayConfig } from "./config.js";
import type {
  CodexModelOption,
  CodexRuntimeDefaults,
} from "./codex/model-catalog.js";
import type { ServiceState } from "./service/state.js";
import {
  getCodexModelEditorState,
  getFeishuAccountSecret,
  getFeishuAccountsEditorState,
  saveCodexModelEditorState,
  saveFeishuAccountsEditorState,
  type SaveCodexModelInput,
  type SaveFeishuAccountsInput,
} from "./web/config-editor.js";
import { readServiceLogTail } from "./web/log-service.js";
import { getUsageDashboard } from "./web/usage-service.js";
import { renderAdminPage } from "./web/page.js";

export interface WebServerOptions {
  port: number;
  stateProvider: () => ServiceState | null;
  channelStatusProvider: () => ReturnType<ChannelManager["getStatus"]>;
  channelManager?: WebChannelManager;
  stopService?: () => Promise<void> | void;
  restartService?: () => Promise<void> | void;
  projectRoot?: string;
  configPath?: string;
  logPath?: string;
  configReloadStateProvider?: () => unknown;
  modelCatalogProvider?: () => Promise<CodexModelOption[]>;
  codexRuntimeDefaultsProvider?: () => Promise<CodexRuntimeDefaults>;
}

export interface WebRequestOptions {
  stateProvider: () => ServiceState | null;
  channelStatusProvider: () => ReturnType<ChannelManager["getStatus"]>;
  channelManager?: WebChannelManager;
  stopService?: () => Promise<void> | void;
  restartService?: () => Promise<void> | void;
  projectRoot?: string;
  configPath?: string;
  logPath?: string;
  configReloadStateProvider?: () => unknown;
  modelCatalogProvider?: () => Promise<CodexModelOption[]>;
  codexRuntimeDefaultsProvider?: () => Promise<CodexRuntimeDefaults>;
}

export interface WebChannelManager {
  updateChannelConfig(id: string, config: { sendProgressReplies?: boolean }): boolean;
  testChannelConnection(id: string): Promise<unknown>;
  listChannelArchives(id: string, conversationKey: string): unknown;
  getChannelArchiveDetail(
    id: string,
    conversationKey: string,
    selection?: number | string
  ): unknown;
  summarizeChannelArchive(
    id: string,
    conversationKey: string,
    selection?: number | string,
    refresh?: boolean
  ): Promise<unknown>;
}

export function startWebServer(options: WebServerOptions): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    fetch: (request) => handleWebRequest(request, options),
  });
}

export async function handleWebRequest(
  request: Request,
  options: WebRequestOptions
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return htmlResponse(renderAdminPage());
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return jsonResponse({
      state: options.stateProvider(),
      channels: options.channelStatusProvider(),
    });
  }
  if (request.method === "GET" && url.pathname === "/api/channels") {
    return jsonResponse(options.channelStatusProvider());
  }
  if (request.method === "GET" && url.pathname === "/api/overview") {
    const channels = options.channelStatusProvider();
    return jsonResponse({
      state: options.stateProvider(),
      configPath: options.configPath ? resolve(options.configPath) : null,
      reload: options.configReloadStateProvider?.() ?? { status: "idle" },
      stats: summarizeChannels(channels.channels),
      channels,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/usage") {
    return jsonResponse(
      getUsageDashboard({
        projectRoot: resolveProjectRoot(options),
        preset: url.searchParams.get("preset") ?? undefined,
        recentValue: url.searchParams.get("recentValue") ?? undefined,
        startDate: url.searchParams.get("startDate") ?? undefined,
        endDate: url.searchParams.get("endDate") ?? undefined,
        bucket: url.searchParams.get("bucket") ?? undefined,
      })
    );
  }
  if (request.method === "GET" && url.pathname === "/api/models") {
    if (!options.modelCatalogProvider) {
      return jsonResponse({ error: "Codex 模型目录不可用。" }, 503);
    }
    try {
      const models = await options.modelCatalogProvider();
      let defaults: CodexRuntimeDefaults = { verbosity: "medium" };
      try {
        defaults = (await options.codexRuntimeDefaultsProvider?.()) ?? defaults;
      } catch {}
      return jsonResponse({ models, defaults });
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/config") {
    if (!options.configPath) return jsonResponse({ error: "配置路径不可用。" }, 503);
    try {
      return jsonResponse(getPublicConfig(options.configPath));
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/codex-config") {
    if (!options.configPath) return jsonResponse({ error: "配置路径不可用。" }, 503);
    try {
      return jsonResponse(getCodexModelEditorState(options.configPath));
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/codex-config") {
    if (!options.configPath) return jsonResponse({ error: "配置路径不可用。" }, 503);
    try {
      const body = (await readJsonObject(request)) as SaveCodexModelInput;
      return jsonResponse(saveCodexModelEditorState(body, options.configPath));
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 400);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/feishu-config") {
    if (!options.configPath) return jsonResponse({ error: "配置路径不可用。" }, 503);
    try {
      return jsonResponse(getFeishuAccountsEditorState(options.configPath));
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  const secretAccountId = parseSecretAccountId(url.pathname);
  if (request.method === "GET" && secretAccountId !== null) {
    if (!options.configPath) return jsonResponse({ error: "配置路径不可用。" }, 503);
    try {
      const secret = getFeishuAccountSecret(secretAccountId, options.configPath);
      return secret
        ? jsonResponse(secret)
        : jsonResponse({ error: "没有找到对应账号的 App Secret。" }, 404);
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/feishu-config") {
    if (!options.configPath) return jsonResponse({ error: "配置路径不可用。" }, 503);
    try {
      const body = (await readJsonObject(request)) as SaveFeishuAccountsInput;
      return jsonResponse(saveFeishuAccountsEditorState(body, options.configPath));
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 400);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/logs") {
    const logPath = resolveLogPath(options);
    if (!logPath) return jsonResponse({ error: "服务日志路径不可用。" }, 503);
    try {
      return jsonResponse(
        readServiceLogTail({
          logPath,
          cursor: parseNonNegativeNumber(url.searchParams.get("cursor")),
          maxBytes: parsePositiveNumber(url.searchParams.get("maxBytes")),
        })
      );
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/logs/download") {
    const logPath = resolveLogPath(options);
    if (!logPath || !existsSync(logPath)) {
      return jsonResponse({ error: "服务日志尚不存在。" }, 404);
    }
    try {
      return new Response(readFileSync(logPath), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": 'attachment; filename="service.log"',
        },
      });
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  const channelRoute = parseChannelRoute(url.pathname);
  if (channelRoute && options.channelManager) {
    try {
      if (request.method === "POST" && channelRoute.action === "test") {
        return jsonResponse(
          await options.channelManager.testChannelConnection(channelRoute.channelId)
        );
      }
      if (request.method === "PATCH" && channelRoute.action === "config") {
        const body = await readJsonObject(request);
        if (typeof body.sendProgressReplies !== "boolean") {
          return jsonResponse({ error: "sendProgressReplies 必须是布尔值。" }, 400);
        }
        const ok = options.channelManager.updateChannelConfig(channelRoute.channelId, {
          sendProgressReplies: body.sendProgressReplies,
        });
        return jsonResponse({ ok }, ok ? 200 : 404);
      }
      if (request.method === "GET" && channelRoute.action === "archives") {
        const conversationKey = url.searchParams.get("conversationKey")?.trim();
        if (!conversationKey) return jsonResponse({ error: "缺少 conversationKey。" }, 400);
        const selection = parseArchiveSelection(url.searchParams.get("selection"));
        if (selection !== undefined) {
          return jsonResponse({
            detail: options.channelManager.getChannelArchiveDetail(
              channelRoute.channelId,
              conversationKey,
              selection
            ),
          });
        }
        return jsonResponse({
          sessions: options.channelManager.listChannelArchives(
            channelRoute.channelId,
            conversationKey
          ),
        });
      }
      if (request.method === "POST" && channelRoute.action === "archives/summary") {
        const body = await readJsonObject(request);
        const conversationKey = readNonEmptyString(body.conversationKey);
        if (!conversationKey) return jsonResponse({ error: "缺少 conversationKey。" }, 400);
        const selection = parseBodyArchiveSelection(body.selection);
        return jsonResponse({
          summary: await options.channelManager.summarizeChannelArchive(
            channelRoute.channelId,
            conversationKey,
            selection,
            body.refresh === true
          ),
        });
      }
    } catch (error) {
      return jsonResponse({ error: formatError(error) }, 500);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/service/stop") {
    await options.stopService?.();
    return jsonResponse({ ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/service/restart") {
    if (!options.restartService) {
      return jsonResponse({ error: "当前服务不支持 Web 重启。" }, 503);
    }
    setTimeout(() => {
      Promise.resolve(options.restartService?.()).catch((error) => {
        console.error(`[codex-gateway] Web 重启失败：${formatError(error)}`);
      });
    }, 50);
    return jsonResponse({ ok: true, status: "restarting" }, 202);
  }
  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }
  return jsonResponse({ error: "Not found" }, 404);
}

function summarizeChannels(
  channels: Array<{ status?: unknown; activeSessions?: unknown }>
): { channels: number; connectedChannels: number; activeSessions: number } {
  return {
    channels: channels.length,
    connectedChannels: channels.filter((item) => item.status === "connected").length,
    activeSessions: channels.reduce(
      (total, item) =>
        total +
        (typeof item.activeSessions === "number" && Number.isFinite(item.activeSessions)
          ? item.activeSessions
          : 0),
      0
    ),
  };
}

function getPublicConfig(configPath: string): unknown {
  const config = loadGatewayConfig({ configPath });
  return {
    configPath: resolve(configPath),
    service: config.service,
    codex: config.codex,
    channels: {
      feishu: {
        configuredAccounts: config.channels.feishu.accounts.length,
        enabledAccounts: config.channels.feishu.accounts.filter((account) => account.enabled)
          .length,
      },
    },
  };
}

function resolveProjectRoot(options: WebRequestOptions): string {
  if (options.projectRoot) return resolve(options.projectRoot);
  if (options.configPath) return dirname(resolve(options.configPath));
  return process.cwd();
}

function resolveLogPath(options: WebRequestOptions): string | undefined {
  return options.logPath ?? options.stateProvider()?.logPath;
}

function parseSecretAccountId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/feishu-config\/([^/]+)\/secret$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseNonNegativeNumber(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function parsePositiveNumber(value: string | null): number | undefined {
  const number = parseNonNegativeNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function parseChannelRoute(
  pathname: string
): { channelId: string; action: "test" | "config" | "archives" | "archives/summary" } | null {
  const match = pathname.match(/^\/api\/channels\/([^/]+)\/(test|config|archives(?:\/summary)?)$/);
  if (!match) return null;
  return {
    channelId: decodeURIComponent(match[1]),
    action: match[2] as "test" | "config" | "archives" | "archives/summary",
  };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求体必须是 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

function parseArchiveSelection(value: string | null): number | string | undefined {
  if (!value?.trim()) return undefined;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function parseBodyArchiveSelection(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

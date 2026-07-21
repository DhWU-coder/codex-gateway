import { mkdirSync, watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { ChannelManager, type ChannelReloadResult } from "../channel-manager.js";
import {
  createCodexModelCatalog,
  type CreateCodexModelCatalogOptions,
  type CodexModelCatalog,
} from "../codex/model-catalog.js";
import { loadGatewayConfig, type GatewayConfig } from "../config.js";
import { startWebServer } from "../web-server.js";
import { getServiceLogPath } from "./paths.js";
import {
  spawnDetachedServiceRestart,
  type SpawnRestartOptions,
} from "./process.js";
import { type ServiceState, removeServiceState, writeServiceState } from "./state.js";

export interface StartServiceDaemonOptions {
  port: number;
  cwd?: string;
  configPath?: string;
  projectRoot?: string;
  config?: GatewayConfig;
  now?: () => Date;
  createChannelManager?: (config: GatewayConfig) => ChannelManager;
  startWebServer?: typeof startWebServer;
  createConfigWatcher?: (options: ServiceConfigWatcherOptions) => ServiceConfigWatcher;
  spawnServiceRestart?: (options: SpawnRestartOptions) => number;
  createModelCatalog?: (options: CreateCodexModelCatalogOptions) => CodexModelCatalog;
}

export interface ServiceDaemonController {
  state: ServiceState;
  configReloadState(): ConfigReloadState;
  stop(): Promise<void>;
}

export interface ServiceConfigWatcher {
  close(): void;
}

export interface ServiceConfigWatcherOptions {
  configPath: string;
  onChange(): Promise<void> | void;
}

export type ConfigReloadState =
  | { status: "idle" }
  | { status: "success"; updatedAt: string; result: ChannelReloadResult }
  | {
      status: "error";
      updatedAt: string;
      error: string;
      result?: ChannelReloadResult;
    };

export async function startServiceDaemon(
  options: StartServiceDaemonOptions
): Promise<ServiceDaemonController> {
  const configPath = options.configPath ? resolve(options.configPath) : undefined;
  const config =
    options.config ??
    loadGatewayConfig({
      configPath,
    });
  const cwd = options.cwd ?? config.service.cwd;
  const projectRoot =
    options.projectRoot ?? (configPath ? dirname(configPath) : process.cwd());
  const logPath = getServiceLogPath();
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const channelManager =
    options.createChannelManager?.(config) ?? new ChannelManager({ config, projectRoot });
  const modelCatalog = (options.createModelCatalog ?? createCodexModelCatalog)({
    command: config.codex.command,
  });
  await channelManager.start();

  let configReloadState: ConfigReloadState = { status: "idle" };
  const configWatcher =
    !options.config && configPath
      ? (options.createConfigWatcher ?? watchGatewayConfig)({
          configPath,
          onChange: async () => {
            try {
              const nextConfig = loadGatewayConfig({ configPath });
              const result = await channelManager.reloadConfig(nextConfig);
              const updatedAt = new Date().toISOString();
              configReloadState = result.errors.length
                ? {
                    status: "error",
                    updatedAt,
                    error: result.errors
                      .map((item) => `${item.channelId}: ${item.error}`)
                      .join("\n"),
                    result,
                  }
                : { status: "success", updatedAt, result };
            } catch (error) {
              configReloadState = {
                status: "error",
                updatedAt: new Date().toISOString(),
                error: formatError(error),
              };
              console.warn(`[codex-gateway] 配置热更新失败：${formatError(error)}`);
            }
          },
        })
      : undefined;

  let stopped = false;
  let state: ServiceState;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    configWatcher?.close();
    await channelManager.stop();
    webServer.stop();
    removeServiceState();
  };
  const webServer = (options.startWebServer ?? startWebServer)({
    port: options.port,
    stateProvider: () => state,
    channelStatusProvider: () => channelManager.getStatus(),
    channelManager,
    stopService: stop,
    restartService: () => {
      (options.spawnServiceRestart ?? spawnDetachedServiceRestart)({
        cwd: projectRoot,
        configPath,
        logPath,
      });
    },
    projectRoot,
    configPath,
    logPath,
    configReloadStateProvider: () => configReloadState,
    modelCatalogProvider: () => modelCatalog.list(),
  });
  const host = "127.0.0.1";
  const boundPort = webServer.port ?? options.port;
  state = {
    pid: process.pid,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    host,
    port: boundPort,
    webUrl: `http://${host}:${boundPort}/`,
    logPath,
    cwd,
    channels: Object.fromEntries(
      channelManager.getStatus().channels.map((channel) => [channel.id, channel])
    ),
  };
  writeServiceState(state);

  process.once("SIGTERM", () => {
    stop().finally(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    stop().finally(() => process.exit(0));
  });

  return { state, configReloadState: () => configReloadState, stop };
}

export function watchGatewayConfig(
  options: ServiceConfigWatcherOptions
): ServiceConfigWatcher {
  const directory = dirname(options.configPath);
  const fileName = basename(options.configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(directory, (_eventType, changedFileName) => {
    if (changedFileName && String(changedFileName) !== fileName) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      Promise.resolve(options.onChange()).catch((error) => {
        console.warn(`[codex-gateway] 配置热更新失败：${formatError(error)}`);
      });
    }, 500);
  });
  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

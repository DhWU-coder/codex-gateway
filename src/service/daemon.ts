import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ChannelManager } from "../channel-manager.js";
import { loadGatewayConfig, type GatewayConfig } from "../config.js";
import { startWebServer } from "../web-server.js";
import { getServiceLogPath } from "./paths.js";
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
}

export interface ServiceDaemonController {
  state: ServiceState;
  stop(): Promise<void>;
}

export async function startServiceDaemon(
  options: StartServiceDaemonOptions
): Promise<ServiceDaemonController> {
  const config =
    options.config ??
    loadGatewayConfig({
      configPath: options.configPath,
    });
  const cwd = options.cwd ?? config.service.cwd;
  const projectRoot =
    options.projectRoot ?? (options.configPath ? dirname(resolve(options.configPath)) : process.cwd());
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const channelManager =
    options.createChannelManager?.(config) ?? new ChannelManager({ config, projectRoot });
  await channelManager.start();

  let stopped = false;
  let state: ServiceState;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
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
  });
  const host = "127.0.0.1";
  const boundPort = webServer.port ?? options.port;
  state = {
    pid: process.pid,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    host,
    port: boundPort,
    webUrl: `http://${host}:${boundPort}/`,
    logPath: getServiceLogPath(),
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

  return { state, stop };
}

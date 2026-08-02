import { mkdirSync } from "node:fs";
import { loadGatewayConfig } from "../config.js";
import { resolveConfigPath } from "../paths.js";
import { listLanIpv4Addresses, resolveServiceUrls } from "./addresses.js";
import { getServiceLogPath } from "./paths.js";
import {
  findServicePort,
  type ServicePortResult,
  type ServicePortState,
  waitForServicePortState,
} from "./ports.js";
import { spawnDetachedServiceDaemon } from "./process.js";
import {
  isProcessRunning,
  isStateRunning,
  readServiceState,
  removeServiceState,
  type ServiceState,
  writeServiceState,
} from "./state.js";

export interface StartServiceResult {
  state: ServiceState;
  warning?: string;
  alreadyRunning?: boolean;
}

export interface ServiceCommandOptions {
  configPath?: string;
  cwd?: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  readState?: () => ServiceState | null;
  writeState?: (state: ServiceState) => void;
  removeState?: () => void;
  isStateRunning?: (state: ServiceState | null) => boolean;
  isProcessRunning?: (pid: number) => boolean;
  killProcess?: (pid: number, signal?: NodeJS.Signals) => void;
  waitForProcessExit?: (
    pid: number,
    checkRunning: (pid: number) => boolean,
    timeoutMs: number
  ) => Promise<boolean>;
  waitForPortState?: (
    port: number,
    host: string,
    expectedState: ServicePortState,
    timeoutMs: number
  ) => Promise<boolean>;
  findPort?: (preferredPort: number, host: string) => Promise<ServicePortResult>;
  networkAddresses?: () => string[];
  spawnDaemon?: (options: {
    cwd: string;
    port: number;
    logPath: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
  }) => number;
}

export function formatStatus(state: ServiceState | null): string {
  if (!state) return "codex-gateway service stopped";
  if (!isStateRunning(state)) return `codex-gateway service stopped (stale pid ${state.pid})`;
  return [
    `codex-gateway service running (pid ${state.pid})`,
    `Web UI: ${state.webUrl}`,
    ...(state.chatUrls ?? []).map((url) => `Chat UI: ${url}`),
    `CWD: ${state.cwd}`,
    `Log: ${state.logPath}`,
  ].join("\n");
}

export function formatStartResult(result: StartServiceResult): string {
  const lines: string[] = [];
  if (result.warning) lines.push(result.warning);
  lines.push(
    result.alreadyRunning
      ? `codex-gateway service already running (pid ${result.state.pid})`
      : `codex-gateway service started (pid ${result.state.pid})`
  );
  lines.push(`Web UI: ${result.state.webUrl}`);
  for (const url of result.state.chatUrls ?? []) lines.push(`Chat UI: ${url}`);
  lines.push(`Log: ${result.state.logPath}`);
  return lines.join("\n");
}

export async function startServiceCommand(
  options: ServiceCommandOptions = {}
): Promise<StartServiceResult> {
  const readState = options.readState ?? readServiceState;
  const stateRunning = options.isStateRunning ?? isStateRunning;
  const existing = readState();
  if (stateRunning(existing)) {
    return { state: existing as ServiceState, alreadyRunning: true };
  }

  const configPath = resolveConfigPath(options.configPath, {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const config = loadGatewayConfig({ configPath, env: options.env });
  const cwd = config.service.cwd;
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const portResult = await (options.findPort ?? findServicePort)(
    config.service.port,
    config.service.host
  );
  const logPath = getServiceLogPath({ env: options.env });
  const pid = (options.spawnDaemon ?? spawnDetachedServiceDaemon)({
    cwd,
    port: portResult.port,
    logPath,
    configPath,
    env: options.env,
  });
  const host = config.service.host;
  const urls = resolveServiceUrls(
    host,
    portResult.port,
    (options.networkAddresses ?? listLanIpv4Addresses)()
  );
  const state: ServiceState = {
    pid,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    host,
    port: portResult.port,
    webUrl: urls.webUrl,
    chatUrls: urls.chatUrls,
    logPath,
    cwd,
    channels: {},
  };
  (options.writeState ?? writeServiceState)(state);
  return {
    state,
    warning: portResult.warning,
  };
}

export async function stopServiceCommand(options: ServiceCommandOptions = {}): Promise<string> {
  const state = (options.readState ?? readServiceState)();
  if (!state) return "codex-gateway service already stopped";
  const checkRunning = options.isProcessRunning ?? isProcessRunning;
  if (checkRunning(state.pid)) {
    const killProcess = options.killProcess ?? ((pid, signal = "SIGTERM") => {
      process.kill(pid, signal);
    });
    try {
      killProcess(state.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const waitForExit = options.waitForProcessExit ?? waitForProcessExit;
    let exited = await waitForExit(state.pid, checkRunning, 3_000);
    if (!exited) {
      try {
        killProcess(state.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      exited = await waitForExit(state.pid, checkRunning, 2_000);
    }
    if (!exited) {
      throw new Error(`codex-gateway service process ${state.pid} did not exit`);
    }
  }
  (options.removeState ?? removeServiceState)();
  return `codex-gateway service stopped (pid ${state.pid})`;
}

export async function restartServiceCommand(options: ServiceCommandOptions = {}): Promise<string> {
  const configPath = resolveConfigPath(options.configPath, {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const config = loadGatewayConfig({ configPath, env: options.env });
  await stopServiceCommand(options);
  const waitForPortState = options.waitForPortState ?? ((port, host, state, timeoutMs) =>
    waitForServicePortState(port, host, state, { timeoutMs }));
  const preferredPort = config.service.port;
  const host = config.service.host;
  const released = await waitForPortState(preferredPort, host, "available", 10_000);
  if (!released) {
    throw new Error(`service port ${preferredPort} was not released after stopping`);
  }

  const findPort = options.findPort ?? findServicePort;
  const result = await startServiceCommand({
    ...options,
    configPath,
    findPort: async (port, listenHost) => {
      const selected = await findPort(port, listenHost);
      if (selected.port !== port) {
        throw new Error(`service port ${port} became unavailable during restart`);
      }
      return selected;
    },
  });
  const listening = await waitForPortState(preferredPort, host, "occupied", 10_000);
  if (!listening) {
    throw new Error(`service did not start listening on port ${preferredPort}`);
  }
  return formatStartResult(result);
}

export function statusServiceCommand(options: ServiceCommandOptions = {}): string {
  return formatStatus((options.readState ?? readServiceState)());
}

async function waitForProcessExit(
  pid: number,
  checkRunning: (pid: number) => boolean,
  timeoutMs: number
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!checkRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !checkRunning(pid);
}

import { mkdirSync } from "node:fs";
import { loadGatewayConfig } from "../config.js";
import { getServiceLogPath } from "./paths.js";
import { findServicePort, type ServicePortResult } from "./ports.js";
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
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  readState?: () => ServiceState | null;
  writeState?: (state: ServiceState) => void;
  removeState?: () => void;
  isStateRunning?: (state: ServiceState | null) => boolean;
  isProcessRunning?: (pid: number) => boolean;
  killProcess?: (pid: number) => void;
  findPort?: (preferredPort: number) => Promise<ServicePortResult>;
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

  const config = loadGatewayConfig({ configPath: options.configPath, env: options.env });
  const cwd = config.service.cwd;
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const portResult = await (options.findPort ?? findServicePort)(config.service.port);
  const logPath = getServiceLogPath({ env: options.env });
  const pid = (options.spawnDaemon ?? spawnDetachedServiceDaemon)({
    cwd,
    port: portResult.port,
    logPath,
    configPath: options.configPath,
    env: options.env,
  });
  const host = "127.0.0.1";
  const state: ServiceState = {
    pid,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    host,
    port: portResult.port,
    webUrl: `http://${host}:${portResult.port}/`,
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
    try {
      (options.killProcess ?? ((pid) => process.kill(pid, "SIGTERM")))(state.pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await waitForProcessExit(state.pid, checkRunning, 3000);
  }
  (options.removeState ?? removeServiceState)();
  return `codex-gateway service stopped (pid ${state.pid})`;
}

export async function restartServiceCommand(options: ServiceCommandOptions = {}): Promise<string> {
  await stopServiceCommand(options);
  return formatStartResult(await startServiceCommand(options));
}

export function statusServiceCommand(options: ServiceCommandOptions = {}): string {
  return formatStatus((options.readState ?? readServiceState)());
}

async function waitForProcessExit(
  pid: number,
  checkRunning: (pid: number) => boolean,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!checkRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

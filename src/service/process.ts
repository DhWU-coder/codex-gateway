import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

export interface BuildDaemonArgsOptions {
  cwd: string;
  port: number;
  configPath?: string;
}

export interface SpawnDaemonOptions extends BuildDaemonArgsOptions {
  logPath: string;
  entrypoint?: string;
  runtime?: string;
  env?: NodeJS.ProcessEnv;
}

export interface BuildRestartArgsOptions {
  configPath?: string;
}

export interface SpawnRestartOptions extends BuildRestartArgsOptions {
  cwd: string;
  logPath: string;
  entrypoint?: string;
  runtime?: string;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: typeof spawn;
}

export function buildRestartArgs(options: BuildRestartArgsOptions): string[] {
  const args = ["restart"];
  if (options.configPath) args.push("--config", options.configPath);
  return args;
}

export function spawnDetachedServiceRestart(options: SpawnRestartOptions): number {
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  const logFd = openSync(options.logPath, "a", 0o600);
  try {
    const child = (options.spawnProcess ?? spawn)(
      options.runtime ?? process.execPath,
      [
        options.entrypoint ?? resolveDaemonEntrypoint(),
        ...buildRestartArgs(options),
      ],
      {
        cwd: options.cwd,
        detached: true,
        env: options.env ?? process.env,
        stdio: ["ignore", logFd, logFd],
      }
    );
    child.unref();
    if (!child.pid) throw new Error("无法启动 codex-gateway 重启辅助进程");
    return child.pid;
  } finally {
    closeSync(logFd);
  }
}

export function buildDaemonArgs(options: BuildDaemonArgsOptions): string[] {
  const args = [
    "--service-daemon",
    "--service-port",
    String(options.port),
    "--service-cwd",
    options.cwd,
  ];
  if (options.configPath) args.push("--config", options.configPath);
  return args;
}

export function resolveDaemonEntrypoint(argv = process.argv): string {
  return argv[1] || import.meta.url;
}

export function spawnDetachedServiceDaemon(options: SpawnDaemonOptions): number {
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  const logFd = openSync(options.logPath, "a", 0o600);
  const child = spawn(
    options.runtime ?? process.execPath,
    [options.entrypoint ?? resolveDaemonEntrypoint(), ...buildDaemonArgs(options)],
    {
      cwd: options.cwd,
      detached: true,
      env: options.env ?? process.env,
      stdio: ["ignore", logFd, logFd],
    }
  );
  child.unref();
  closeSync(logFd);
  if (!child.pid) throw new Error("Failed to start codex-gateway service daemon");
  return child.pid;
}

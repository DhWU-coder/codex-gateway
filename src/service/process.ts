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

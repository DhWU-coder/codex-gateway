import type { SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

export interface ResolvedSpawnCommand {
  command: string;
  args: string[];
}

export interface ResolveCodexSpawnCommandOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fileExists?: (path: string) => boolean;
}

export function getWindowsHideSpawnOptions(
  platform: NodeJS.Platform = process.platform
): Pick<SpawnOptions, "windowsHide"> {
  return platform === "win32" ? { windowsHide: true } : {};
}

/**
 * npm exposes Codex on Windows through codex.cmd. Spawning that wrapper from
 * Bun creates an intermediate cmd.exe window even when windowsHide is set.
 * Resolve the wrapper to the same Node.js entry point so no shell is needed.
 */
export function resolveCodexSpawnCommand(
  command: string,
  args: readonly string[],
  options: ResolveCodexSpawnCommandOptions = {}
): ResolvedSpawnCommand {
  const original = { command, args: [...args] };
  if ((options.platform ?? process.platform) !== "win32") return original;

  const trimmedCommand = command.trim();
  const commandName = pathWin32.basename(trimmedCommand).toLowerCase();
  if (commandName !== "codex" && commandName !== "codex.cmd") return original;

  const fileExists = options.fileExists ?? existsSync;
  const env = options.env ?? process.env;
  const pathEntries = readWindowsPathEntries(env);
  const hasDirectory = pathWin32.dirname(trimmedCommand) !== ".";
  const wrapperPath = hasDirectory
    ? resolveWindowsCommandPath(trimmedCommand, options.cwd, fileExists)
    : findWindowsExecutable("codex.cmd", pathEntries, fileExists);
  if (!wrapperPath) return original;

  const wrapperDirectory = pathWin32.dirname(wrapperPath);
  const codexEntry = pathWin32.join(
    wrapperDirectory,
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js"
  );
  if (!fileExists(codexEntry)) return original;

  const adjacentNode = pathWin32.join(wrapperDirectory, "node.exe");
  const nodeCommand = fileExists(adjacentNode)
    ? adjacentNode
    : findWindowsExecutable("node.exe", pathEntries, fileExists);
  if (!nodeCommand) return original;

  return {
    command: nodeCommand,
    args: [codexEntry, ...args],
  };
}

function readWindowsPathEntries(env: NodeJS.ProcessEnv): string[] {
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1];
  if (!pathValue) return [];
  return pathValue
    .split(";")
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function findWindowsExecutable(
  fileName: string,
  pathEntries: readonly string[],
  fileExists: (path: string) => boolean
): string | undefined {
  for (const directory of pathEntries) {
    const candidate = pathWin32.join(directory, fileName);
    if (fileExists(candidate)) return candidate;
  }
  return undefined;
}

function resolveWindowsCommandPath(
  command: string,
  cwd: string | undefined,
  fileExists: (path: string) => boolean
): string | undefined {
  const candidate = pathWin32.isAbsolute(command)
    ? pathWin32.normalize(command)
    : pathWin32.resolve(cwd ?? process.cwd(), command);
  return fileExists(candidate) ? candidate : undefined;
}

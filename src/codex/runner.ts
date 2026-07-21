import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexSandboxMode } from "../config.js";
import type { CodexReasoningEffort, CodexVerbosity } from "./runtime-settings.js";
import {
  type CodexProgressEvent,
  parseCodexJsonEvents,
  parseCodexProgressLine,
} from "./json-events.js";
import { appendCodexUsageLog } from "./usage-log.js";

export interface CodexRunInput {
  cwd: string;
  prompt: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  sessionId?: string;
  resume?: boolean;
  imagePaths?: string[];
  outputFile?: string;
  command?: string;
  sandbox?: CodexSandboxMode;
  profile?: string;
  search?: boolean;
  skipGitRepoCheck?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  projectRoot?: string;
  onProgress?: (event: CodexProgressEvent) => void;
}

export interface CodexRunResult {
  text: string;
  sessionId?: string;
  rawOutput?: string;
}

export type CodexRunner = (input: CodexRunInput) => Promise<CodexRunResult>;

export interface CodexCommand {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  outputFile: string;
}

export function buildCodexCommand(input: CodexRunInput & { outputFile: string }): CodexCommand {
  const resume = Boolean(input.sessionId && input.resume !== false);
  const args = resume ? ["exec", "resume"] : ["exec"];
  args.push("--json");

  if (input.skipGitRepoCheck !== false) args.push("--skip-git-repo-check");
  if (!resume) args.push("-C", input.cwd);
  if (input.model) args.push("--model", input.model);
  if (input.reasoningEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`);
  }
  if (input.verbosity) {
    args.push("-c", `model_verbosity=${JSON.stringify(input.verbosity)}`);
  }
  if (input.fast === true) {
    args.push("--enable", "fast_mode", "-c", 'service_tier="fast"');
  } else if (input.fast === false) {
    args.push("--disable", "fast_mode");
  }
  if (input.profile && !resume) args.push("--profile", input.profile);
  if (input.sandbox && !resume && !input.dangerouslyBypassApprovalsAndSandbox) {
    args.push("--sandbox", input.sandbox);
  }
  if (input.search) args.push("-c", 'web_search="live"');
  if (input.dangerouslyBypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  args.push(...(input.extraArgs ?? []));
  args.push("--output-last-message", input.outputFile);
  for (const imagePath of input.imagePaths ?? []) {
    args.push("--image", imagePath);
  }
  if (resume && input.sessionId) args.push(input.sessionId);
  args.push("-");

  return {
    command: input.command || "codex",
    args,
    cwd: input.cwd,
    env: input.env ?? process.env,
    stdin: input.prompt,
    outputFile: input.outputFile,
  };
}

export async function runCodex(input: CodexRunInput): Promise<CodexRunResult> {
  const tempDir = input.outputFile ? undefined : mkdtempSync(join(tmpdir(), "codex-gateway-"));
  const outputFile = input.outputFile ?? join(tempDir!, "last-message.txt");
  const command = buildCodexCommand({ ...input, outputFile });

  try {
    const { stdout, stderr, exitCode } = await runChildProcess(
      command,
      input.signal,
      input.onProgress
    );
    if (exitCode !== 0) {
      throw new Error(formatCodexFailure(exitCode, stdout, stderr));
    }

    const parsed = parseCodexJsonEvents(stdout);
    const text = readOutputMessage(outputFile) || parsed.assistantText || stdout.trim();
    if (parsed.usage) {
      try {
        appendCodexUsageLog({
          projectRoot: input.projectRoot ?? process.cwd(),
          cwd: input.cwd,
          sessionId: parsed.sessionId || input.sessionId,
          requestId: parsed.requestId,
          model: parsed.model || input.model,
          usage: parsed.usage,
        });
      } catch (error) {
        console.warn(`Codex 用量日志写入失败：${formatError(error)}`);
      }
    }
    return {
      text: text.trim(),
      sessionId: parsed.sessionId || input.sessionId,
      rawOutput: stdout,
    };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runChildProcess(
  command: CodexCommand,
  signal?: AbortSignal,
  onProgress?: (event: CodexProgressEvent) => void
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: "pipe",
  });

  if (signal?.aborted) child.kill("SIGTERM");
  const abort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });

  let stdout = "";
  let stderr = "";
  let stdoutLineBuffer = "";
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    stdoutLineBuffer = consumeJsonLines(stdoutLineBuffer + chunk, (line) => {
      for (const event of parseCodexProgressLine(line)) emitProgress(onProgress, event);
    });
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    const text = String(chunk).trim();
    if (text) emitProgress(onProgress, { type: "stderr", text });
  });
  child.stdin.write(command.stdin);
  child.stdin.end();

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  }).finally(() => {
    signal?.removeEventListener("abort", abort);
  });

  if (signal?.aborted) throw new Error("Codex session stopped");
  if (stdoutLineBuffer.trim()) {
    for (const event of parseCodexProgressLine(stdoutLineBuffer)) emitProgress(onProgress, event);
  }
  return { stdout, stderr, exitCode };
}

function consumeJsonLines(input: string, onLine: (line: string) => void): string {
  const lines = input.split(/\r?\n/);
  const rest = lines.pop() ?? "";
  for (const line of lines) onLine(line);
  return rest;
}

function emitProgress(
  onProgress: ((event: CodexProgressEvent) => void) | undefined,
  event: CodexProgressEvent
): void {
  try {
    onProgress?.(event);
  } catch (error) {
    console.warn(`Codex 进度回调失败：${formatError(error)}`);
  }
}

function readOutputMessage(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8").trim();
}

function formatCodexFailure(exitCode: number, stdout: string, stderr: string): string {
  const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  return details ? `Codex CLI failed (${exitCode}): ${details}` : `Codex CLI failed (${exitCode})`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

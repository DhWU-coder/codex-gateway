import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexSandboxMode } from "../config.js";
import { parseCodexJsonEvents } from "./json-events.js";

export interface CodexRunInput {
  cwd: string;
  prompt: string;
  model?: string;
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
  if (input.profile && !resume) args.push("--profile", input.profile);
  if (input.sandbox && !resume) args.push("--sandbox", input.sandbox);
  if (input.search && !resume) args.push("--search");
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
    const { stdout, stderr, exitCode } = await runChildProcess(command, input.signal);
    if (exitCode !== 0) {
      throw new Error(formatCodexFailure(exitCode, stdout, stderr));
    }

    const parsed = parseCodexJsonEvents(stdout);
    const text = readOutputMessage(outputFile) || parsed.assistantText || stdout.trim();
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
  signal?: AbortSignal
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
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
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
  return { stdout, stderr, exitCode };
}

function readOutputMessage(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8").trim();
}

function formatCodexFailure(exitCode: number, stdout: string, stderr: string): string {
  const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  return details ? `Codex CLI failed (${exitCode}): ${details}` : `Codex CLI failed (${exitCode})`;
}

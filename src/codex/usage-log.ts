import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { CodexUsage } from "./json-events.js";

export interface CodexUsageLogInput {
  projectRoot: string;
  cwd: string;
  sessionId?: string;
  requestId?: string;
  model?: string;
  usage: CodexUsage;
  timestamp?: string;
}

export function appendCodexUsageLog(input: CodexUsageLogInput): string {
  const projectRoot = resolve(input.projectRoot);
  const logDirectory = join(projectRoot, ".codex-usage");
  const logPath = join(logDirectory, "usage.jsonl");
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });

  const event = {
    schema_version: "codex-usage.project-log.v1",
    timestamp: input.timestamp ?? new Date().toISOString(),
    source: "codex-gateway",
    channel: "Codex Gateway",
    provider: "openai-codex",
    auth: "codex-oauth",
    api_surface: "chatgpt-codex-responses",
    project_root: projectRoot,
    cwd: resolve(input.cwd),
    session_id: input.sessionId ?? randomUUID(),
    ...(input.requestId ? { request_id: input.requestId } : {}),
    model: input.model ?? "unknown",
    usage: input.usage,
  };

  appendFileSync(logPath, `${JSON.stringify(event)}\n`, { encoding: "utf-8", mode: 0o600 });
  return logPath;
}

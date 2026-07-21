import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const FEISHU_INSTRUCTIONS_MAX_BYTES = 32 * 1024;

const CHANNEL_INSTRUCTIONS_PREFIX =
  "以下是当前飞书频道的专属指令；如与通用指令冲突，以本频道指令为准。";

export interface FeishuInstructionsState {
  path: string;
  content: string;
  configured: boolean;
  size: number;
  updatedAt: string;
}

export function ensureFeishuInstructionsFile(filePath: string): FeishuInstructionsState {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(filePath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }
  return readFeishuInstructionsFile(filePath, false);
}

export function readFeishuInstructionsFile(
  filePath: string,
  ensureFile = true
): FeishuInstructionsState {
  if (ensureFile) return ensureFeishuInstructionsFile(filePath);
  const content = readFileSync(filePath, "utf8");
  validateInstructionsSize(content);
  const stats = statSync(filePath);
  return {
    path: filePath,
    content,
    configured: Boolean(content.trim()),
    size: Buffer.byteLength(content, "utf8"),
    updatedAt: stats.mtime.toISOString(),
  };
}

export function writeFeishuInstructionsFile(
  filePath: string,
  content: string
): FeishuInstructionsState {
  validateInstructionsSize(content);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
  return readFeishuInstructionsFile(filePath, false);
}

export function buildFeishuDeveloperInstructions(content: string): string | undefined {
  const normalized = content.trim();
  if (!normalized) return undefined;
  return `${CHANNEL_INSTRUCTIONS_PREFIX}\n\n${normalized}`;
}

function validateInstructionsSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > FEISHU_INSTRUCTIONS_MAX_BYTES) {
    throw new Error("飞书频道 AGENTS.md 不能超过 32 KiB。");
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}


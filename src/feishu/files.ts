import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

export interface SaveFeishuImageInput {
  cwd: string;
  conversationKey: string;
  messageId: string;
  imageKey: string;
  buffer: Buffer | Uint8Array;
  contentType: string;
}

export interface SaveFeishuFileInput {
  cwd: string;
  messageId: string;
  fileKey: string;
  fileName?: string;
  buffer: Buffer | Uint8Array;
  contentType: string;
}

export interface SavedFeishuResource {
  path: string;
  contentType: string;
}

export function saveFeishuImage(input: SaveFeishuImageInput): SavedFeishuResource {
  const extension = inferImageExtension(input.contentType);
  const baseDir = resolve(input.cwd, ".codex-gateway", "feishu-images", safeName(input.conversationKey));
  const fileName = `${safeName(input.messageId)}-${safeName(input.imageKey)}${extension}`;
  const path = resolve(baseDir, fileName);
  assertInside(baseDir, path);
  mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, input.buffer);
  return { path, contentType: input.contentType };
}

export function saveFeishuFile(input: SaveFeishuFileInput): SavedFeishuResource {
  const baseDir = resolve(input.cwd, ".codex-gateway", "feishu-files", safeName(input.messageId));
  const originalName = basename(input.fileName || input.fileKey || "file");
  const fallbackExtension = inferFileExtension(input.contentType);
  const extension = extname(originalName) || fallbackExtension;
  const stem = safeName(originalName.replace(new RegExp(`${escapeRegExp(extname(originalName))}$`), ""));
  const fileName = `${stem || safeName(input.fileKey) || "file"}${extension}`;
  const path = resolve(baseDir, fileName);
  assertInside(baseDir, path);
  mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, input.buffer);
  return { path, contentType: input.contentType };
}

function inferImageExtension(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("gif")) return ".gif";
  if (normalized.includes("webp")) return ".webp";
  return ".png";
}

function inferFileExtension(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("markdown")) return ".md";
  if (normalized.includes("json")) return ".json";
  if (normalized.includes("pdf")) return ".pdf";
  if (normalized.includes("plain")) return ".txt";
  return "";
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function assertInside(baseDir: string, path: string): void {
  if (!path.startsWith(`${baseDir}/`) && path !== baseDir) {
    throw new Error("Invalid Feishu resource path");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

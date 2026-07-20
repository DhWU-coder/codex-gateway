import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_ALLOWED_BYTES = 1024 * 1024;

export interface ReadServiceLogTailOptions {
  logPath: string;
  cursor?: number;
  maxBytes?: number;
}

export interface ServiceLogTail {
  content: string;
  cursor: number;
  reset: boolean;
  size: number;
  updatedAt: string | null;
}

export function readServiceLogTail(options: ReadServiceLogTailOptions): ServiceLogTail {
  if (!existsSync(options.logPath)) return emptyLogTail();
  try {
    const stats = statSync(options.logPath);
    const size = stats.size;
    const maxBytes = normalizeMaxBytes(options.maxBytes);
    const requestedCursor = normalizeCursor(options.cursor);
    const selection = selectReadRange(size, requestedCursor, maxBytes);
    if (selection.length === 0) {
      return {
        content: "",
        cursor: size,
        reset: selection.reset,
        size,
        updatedAt: stats.mtime.toISOString(),
      };
    }

    const descriptor = openSync(options.logPath, "r");
    try {
      const buffer = Buffer.alloc(selection.length);
      const bytesRead = readSync(descriptor, buffer, 0, selection.length, selection.start);
      return {
        content: buffer.subarray(0, bytesRead).toString("utf-8"),
        cursor: selection.start + bytesRead,
        reset: selection.reset,
        size,
        updatedAt: stats.mtime.toISOString(),
      };
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLogTail();
    throw error;
  }
}

function selectReadRange(
  size: number,
  cursor: number | undefined,
  maxBytes: number
): { start: number; length: number; reset: boolean } {
  if (cursor === undefined) {
    const start = Math.max(0, size - maxBytes);
    return { start, length: size - start, reset: start > 0 };
  }
  if (cursor > size) {
    const start = Math.max(0, size - maxBytes);
    return { start, length: size - start, reset: true };
  }
  if (size - cursor > maxBytes) {
    const start = size - maxBytes;
    return { start, length: maxBytes, reset: true };
  }
  return { start: cursor, length: size - cursor, reset: false };
}

function emptyLogTail(): ServiceLogTail {
  return { content: "", cursor: 0, reset: false, size: 0, updatedAt: null };
}

function normalizeMaxBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_BYTES;
  return Math.min(MAX_ALLOWED_BYTES, Math.max(1, Math.floor(value!)));
}

function normalizeCursor(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || value! < 0) return undefined;
  return Math.floor(value!);
}

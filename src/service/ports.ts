import { createServer } from "node:net";

export const DEFAULT_SERVICE_PORT = 18788;

export interface ServicePortResult {
  port: number;
  warning?: string;
}

export type ServicePortState = "available" | "occupied";

export interface WaitForServicePortStateOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  checkAvailable?: (port: number, host: string) => Promise<boolean>;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export function resolvePreferredServicePort(env: NodeJS.ProcessEnv = process.env): number {
  const rawPort = env.CODEX_GATEWAY_SERVICE_PORT;
  if (!rawPort) return DEFAULT_SERVICE_PORT;
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return DEFAULT_SERVICE_PORT;
  return port;
}

export async function findServicePort(
  preferredPort: number,
  host = "127.0.0.1"
): Promise<ServicePortResult> {
  if (await isServicePortAvailable(preferredPort, host)) return { port: preferredPort };
  for (let port = preferredPort + 1; port <= 65535; port += 1) {
    if (await isServicePortAvailable(port, host)) {
      return {
        port,
        warning: `Warning: service port ${preferredPort} is unavailable, using ${port} instead.`,
      };
    }
  }
  throw new Error(`No available service ports found after ${preferredPort}`);
}

export async function waitForServicePortState(
  port: number,
  host: string,
  expectedState: ServicePortState,
  options: WaitForServicePortStateOptions = {}
): Promise<boolean> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10_000);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 50);
  const checkAvailable = options.checkAvailable ?? isServicePortAvailable;
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const now = options.now ?? Date.now;
  const startedAt = now();

  while (true) {
    const available = await checkAvailable(port, host);
    if ((expectedState === "available") === available) return true;
    const remaining = timeoutMs - (now() - startedAt);
    if (remaining <= 0) return false;
    await delay(Math.min(pollIntervalMs, remaining));
  }
}

export function isServicePortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

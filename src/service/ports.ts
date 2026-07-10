import { createServer } from "node:net";

export const DEFAULT_SERVICE_PORT = 18788;

export interface ServicePortResult {
  port: number;
  warning?: string;
}

export function resolvePreferredServicePort(env: NodeJS.ProcessEnv = process.env): number {
  const rawPort = env.CODEX_GATEWAY_SERVICE_PORT;
  if (!rawPort) return DEFAULT_SERVICE_PORT;
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return DEFAULT_SERVICE_PORT;
  return port;
}

export async function findServicePort(preferredPort: number): Promise<ServicePortResult> {
  if (await isPortAvailable(preferredPort)) return { port: preferredPort };
  for (let port = preferredPort + 1; port <= 65535; port += 1) {
    if (await isPortAvailable(port)) {
      return {
        port,
        warning: `Warning: service port ${preferredPort} is unavailable, using ${port} instead.`,
      };
    }
  }
  throw new Error(`No available service ports found after ${preferredPort}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

import { join } from "node:path";
import { resolveGatewayHome } from "../paths.js";

export function getServiceStatePath(input?: { env?: NodeJS.ProcessEnv; homeDir?: string }): string {
  return join(resolveGatewayHome(input), "service.json");
}

export function getServiceLogPath(input?: { env?: NodeJS.ProcessEnv; homeDir?: string }): string {
  return join(resolveGatewayHome(input), "logs", "service.log");
}

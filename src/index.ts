import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createExampleConfig, parseCliArgs, renderHelp } from "./cli.js";
import { loadGatewayConfig } from "./config.js";
import { resolveConfigPath, resolveDefaultConfigPath } from "./paths.js";
import {
  formatStartResult,
  restartServiceCommand,
  startServiceCommand,
  statusServiceCommand,
  stopServiceCommand,
} from "./service/commands.js";
import { startServiceDaemon } from "./service/daemon.js";

export async function main(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);

  if (args.command === "help") {
    console.log(renderHelp());
    return;
  }

  if (args.command === "init-config") {
    const configPath = args.configPath ? resolveConfigPath(args.configPath) : resolveDefaultConfigPath();
    if (existsSync(configPath)) {
      console.log(`配置已存在：${configPath}`);
      return;
    }
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    writeFileSync(configPath, createExampleConfig(), { mode: 0o600 });
    console.log(`已写入示例配置：${configPath}`);
    return;
  }

  if (args.command === "doctor") {
    await runDoctor(args.configPath);
    return;
  }

  if (args.command === "run" || args.command === "start") {
    console.log(formatStartResult(await startServiceCommand({ configPath: args.configPath })));
    return;
  }

  if (args.command === "restart") {
    console.log(await restartServiceCommand({ configPath: args.configPath }));
    return;
  }

  if (args.command === "stop") {
    console.log(await stopServiceCommand());
    return;
  }

  if (args.command === "status") {
    console.log(statusServiceCommand());
    return;
  }

  if (args.command === "service-daemon") {
    await runServiceDaemon(args);
  }
}

async function runDoctor(configPath: string | undefined): Promise<void> {
  const config = loadGatewayConfig({ configPath });
  const command = config.codex.command || "codex";
  const result = spawnSync(command, ["--version"], {
    encoding: "utf-8",
  });
  const version = result.error
    ? `不可用：${result.error.message}`
    : (result.stdout || result.stderr || "").trim();
  console.log(`Codex CLI：${version || "未知"}`);
  console.log(`飞书账号数：${config.channels.feishu.accounts.length}`);
  console.log(`启用账号数：${config.channels.feishu.accounts.filter((account) => account.enabled).length}`);
}

async function runServiceDaemon(args: {
  configPath?: string;
  servicePort?: number;
  serviceCwd?: string;
}): Promise<void> {
  if (!args.servicePort) throw new Error("Missing --service-port");
  await startServiceDaemon({
    port: args.servicePort,
    cwd: args.serviceCwd,
    configPath: args.configPath,
  });
  await new Promise(() => undefined);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

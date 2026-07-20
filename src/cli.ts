export type CliCommand =
  | "run"
  | "start"
  | "restart"
  | "stop"
  | "status"
  | "init-config"
  | "doctor"
  | "help"
  | "service-daemon";

export interface ParsedCliArgs {
  command: CliCommand;
  configPath?: string;
  servicePort?: number;
  serviceCwd?: string;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  const command = normalizeCommand(args[0]);
  let configPath: string | undefined;
  let servicePort: number | undefined;
  let serviceCwd: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config" || arg === "-c") {
      configPath = args[index + 1];
      index += 1;
    } else if (arg === "--service-port") {
      servicePort = Number.parseInt(args[index + 1] ?? "", 10);
      index += 1;
    } else if (arg === "--service-cwd") {
      serviceCwd = args[index + 1];
      index += 1;
    }
  }

  return {
    command,
    ...(configPath ? { configPath } : {}),
    ...(servicePort ? { servicePort } : {}),
    ...(serviceCwd ? { serviceCwd } : {}),
  };
}

export function createExampleConfig(): string {
  return `# Codex Gateway 示例配置
# 默认实际配置文件是项目根目录下的 config.yaml

service:
  port: 18788
  cwd: ~/.codex-gateway/workspace

codex:
  command: codex
  model: gpt-5
  sandbox: workspace-write
  skipGitRepoCheck: true
  search: false
  dangerouslyBypassApprovalsAndSandbox: false
  extraArgs: []

channels:
  feishu:
    accounts:
      - id: donghao
        enabled: true
        appId: cli_xxx
        appSecret: your_app_secret
        botOpenId: ou_xxx
        domain: feishu
        model: gpt-5
        cwd: ~/.codex-gateway/workspace/donghao
        historyBaseDir: ~/.codex-gateway/channels/feishu/donghao/sessions
        sendProgressReplies: false
        messageDedupeTtlMs: 600000
        history:
          maxMessages: 50
          maxSessions: 100
        summary:
          model: gpt-5
          maxMessages: 50
          concurrency: 5
`;
}

export function renderHelp(): string {
  return `codex-gateway

Usage:
  codex-gateway run [--config <path>]
  codex-gateway start [--config <path>]
  codex-gateway restart [--config <path>]
  codex-gateway stop
  codex-gateway status
  codex-gateway init-config [--config <path>]
  codex-gateway doctor [--config <path>]

Commands:
  run          后台启动飞书 WebSocket 到 Codex CLI 的服务
  start        后台启动飞书 WebSocket 到 Codex CLI 的服务
  restart      重启后台服务
  stop         停止后台服务
  status       查看后台服务状态
  init-config  写入示例配置
  doctor       检查 Codex CLI 和配置加载情况
`;
}

function normalizeCommand(value: string | undefined): CliCommand {
  if (
    value === "run" ||
    value === "start" ||
    value === "restart" ||
    value === "stop" ||
    value === "status" ||
    value === "init-config" ||
    value === "doctor" ||
    value === "help"
  ) {
    return value;
  }
  if (value === "--service-daemon") return "service-daemon";
  if (value === "--help" || value === "-h") return "help";
  return "help";
}

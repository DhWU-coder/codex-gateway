import type { FeishuAccountConfig, GatewayConfig } from "./config.js";
import { FeishuChannel } from "./feishu/channel.js";
import { createFeishuSdkClients } from "./feishu/client.js";

export interface ManagedChannel {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ManagedChannelStatus;
}

export interface ManagedChannelStatus {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface ChannelManagerOptions {
  config: GatewayConfig;
  projectRoot?: string;
  createFeishuChannel?: (account: FeishuAccountConfig) => ManagedChannel;
}

export class ChannelManager {
  private readonly channels: ManagedChannel[];

  constructor(private readonly options: ChannelManagerOptions) {
    this.channels = options.config.channels.feishu.accounts.map((account) =>
      (options.createFeishuChannel ?? ((item) =>
        createDefaultFeishuChannel(item, options.config, options.projectRoot)))(account)
    );
  }

  async start(): Promise<void> {
    for (const channel of this.channels) {
      await channel.start();
    }
  }

  async stop(): Promise<void> {
    for (const channel of this.channels) {
      await channel.stop();
    }
  }

  getStatus(): { channels: ManagedChannelStatus[] } {
    return {
      channels: this.channels.map((channel) => channel.getStatus()),
    };
  }
}

function createDefaultFeishuChannel(
  account: FeishuAccountConfig,
  config: GatewayConfig,
  projectRoot?: string
): ManagedChannel {
  return new FeishuChannel({
    account,
    codex: config.codex,
    projectRoot,
    ...(account.enabled ? createFeishuSdkClients(account) : {}),
  });
}

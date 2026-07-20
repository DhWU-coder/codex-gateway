import type { FeishuAccountConfig, GatewayConfig } from "./config.js";
import { FeishuChannel } from "./feishu/channel.js";
import { createFeishuSdkClients } from "./feishu/client.js";
import type { FeishuConnectionTestResult } from "./feishu/send.js";
import type { SessionSummary } from "./session/history.js";
import type {
  ArchivedSessionDetail,
  SessionSummaryWithAi,
} from "./session/router.js";

export interface ManagedChannel {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ManagedChannelStatus;
  updateConfig?(config: { sendProgressReplies?: boolean }): void;
  testConnection?(): Promise<FeishuConnectionTestResult> | FeishuConnectionTestResult;
  listArchivedSessions?(conversationKey: string): SessionSummary[];
  getArchivedSessionDetail?(
    conversationKey: string,
    selection?: number | string
  ): ArchivedSessionDetail | null;
  summarizeArchivedSession?(
    conversationKey: string,
    selection?: number | string,
    refresh?: boolean
  ): Promise<SessionSummaryWithAi | null>;
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

  updateChannelConfig(
    id: string,
    config: { sendProgressReplies?: boolean }
  ): boolean {
    const channel = this.findChannel(id);
    if (!channel?.updateConfig) return false;
    channel.updateConfig(config);
    return true;
  }

  async testChannelConnection(id: string): Promise<FeishuConnectionTestResult> {
    const channel = this.findChannel(id);
    if (!channel) return { ok: false, checks: [], error: "没有找到对应的 channel。" };
    if (!channel.testConnection) {
      return { ok: false, checks: [], error: "这个 channel 不支持连接测试。" };
    }
    return channel.testConnection();
  }

  listChannelArchives(id: string, conversationKey: string): SessionSummary[] {
    return this.findChannel(id)?.listArchivedSessions?.(conversationKey) ?? [];
  }

  getChannelArchiveDetail(
    id: string,
    conversationKey: string,
    selection?: number | string
  ): ArchivedSessionDetail | null {
    return (
      this.findChannel(id)?.getArchivedSessionDetail?.(conversationKey, selection) ?? null
    );
  }

  async summarizeChannelArchive(
    id: string,
    conversationKey: string,
    selection?: number | string,
    refresh = false
  ): Promise<SessionSummaryWithAi | null> {
    return (
      (await this.findChannel(id)?.summarizeArchivedSession?.(
        conversationKey,
        selection,
        refresh
      )) ?? null
    );
  }

  private findChannel(id: string): ManagedChannel | undefined {
    return this.channels.find((channel) => channel.id === id);
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

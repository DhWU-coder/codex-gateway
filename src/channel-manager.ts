import type { FeishuAccountConfig, GatewayConfig } from "./config.js";
import type { CodexReasoningEffort, CodexVerbosity } from "./codex/runtime-settings.js";
import { FeishuChannel } from "./feishu/channel.js";
import { createFeishuSdkClients } from "./feishu/client.js";
import type { FeishuInstructionsState } from "./feishu/instructions.js";
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
  updateConfig?(config: ManagedChannelRuntimeConfig): void;
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
  getInstructions?(): FeishuInstructionsState;
  saveInstructions?(content: string): FeishuInstructionsState;
}

export interface ManagedChannelRuntimeConfig {
  sendProgressReplies?: boolean;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
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

export interface ChannelReloadResult {
  added: string[];
  removed: string[];
  restarted: string[];
  updated: string[];
  unchanged: string[];
  ignoredNonHotFields: string[];
  errors: Array<{ channelId: string; error: string }>;
}

export class ChannelManager {
  private readonly channels = new Map<string, ManagedChannel>();
  private readonly feishuConfigs = new Map<string, FeishuAccountConfig>();
  private readonly createFeishuChannel: (account: FeishuAccountConfig) => ManagedChannel;
  private started = false;

  constructor(private readonly options: ChannelManagerOptions) {
    this.createFeishuChannel =
      options.createFeishuChannel ??
      ((item) => createDefaultFeishuChannel(item, options.config, options.projectRoot));
    for (const account of options.config.channels.feishu.accounts) {
      const channel = this.createFeishuChannel(account);
      this.channels.set(channel.id, channel);
      this.feishuConfigs.set(channel.id, { ...account });
    }
  }

  async start(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
    this.started = false;
  }

  getStatus(): { channels: ManagedChannelStatus[] } {
    return {
      channels: Array.from(this.channels.values()).map((channel) => channel.getStatus()),
    };
  }

  updateChannelConfig(
    id: string,
    config: ManagedChannelRuntimeConfig
  ): boolean {
    const channel = this.findChannel(id);
    if (!channel?.updateConfig) return false;
    channel.updateConfig(config);
    const previous = this.feishuConfigs.get(id);
    if (previous) {
      const next = { ...previous };
      for (const key of [
        "sendProgressReplies",
        "model",
        "reasoningEffort",
        "fast",
        "verbosity",
      ] as const) {
        if (Object.prototype.hasOwnProperty.call(config, key)) {
          Object.assign(next, { [key]: config[key] });
        }
      }
      this.feishuConfigs.set(id, next);
    }
    return true;
  }

  async reloadConfig(config: GatewayConfig): Promise<ChannelReloadResult> {
    const result = createReloadResult();
    const nextConfigs = new Map<string, FeishuAccountConfig>();
    for (const account of config.channels.feishu.accounts) {
      nextConfigs.set(resolveFeishuChannelId(account.id), { ...account });
    }

    for (const channelId of Array.from(this.feishuConfigs.keys())) {
      if (nextConfigs.has(channelId)) continue;
      try {
        await this.removeChannel(channelId);
        result.removed.push(channelId);
      } catch (error) {
        result.errors.push({ channelId, error: formatError(error) });
      }
    }

    for (const [channelId, nextConfig] of nextConfigs) {
      try {
        await this.reloadChannel(channelId, nextConfig, result);
      } catch (error) {
        result.errors.push({ channelId, error: formatError(error) });
      }
    }
    result.ignoredNonHotFields = Array.from(new Set(result.ignoredNonHotFields));
    return result;
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

  getChannelInstructions(id: string): FeishuInstructionsState | null {
    return this.findChannel(id)?.getInstructions?.() ?? null;
  }

  saveChannelInstructions(id: string, content: string): FeishuInstructionsState | null {
    return this.findChannel(id)?.saveInstructions?.(content) ?? null;
  }

  private findChannel(id: string): ManagedChannel | undefined {
    return this.channels.get(id);
  }

  private async reloadChannel(
    channelId: string,
    nextConfig: FeishuAccountConfig,
    result: ChannelReloadResult
  ): Promise<void> {
    const previousConfig = this.feishuConfigs.get(channelId);
    if (!previousConfig) {
      await this.addChannel(nextConfig);
      result.added.push(channelId);
      return;
    }

    result.ignoredNonHotFields.push(
      ...collectIgnoredNonHotFields(previousConfig, nextConfig).map(
        (field) => `${channelId}.${field}`
      )
    );
    const effectiveConfig = preserveNonHotFields(previousConfig, nextConfig);
    if (requiresRestart(previousConfig, effectiveConfig)) {
      await this.replaceChannel(channelId, effectiveConfig);
      result.restarted.push(channelId);
      return;
    }
    const runtimeConfig: ManagedChannelRuntimeConfig = {};
    if (previousConfig.sendProgressReplies !== effectiveConfig.sendProgressReplies) {
      runtimeConfig.sendProgressReplies = effectiveConfig.sendProgressReplies;
    }
    if (previousConfig.model !== effectiveConfig.model) {
      runtimeConfig.model = effectiveConfig.model;
    }
    if (previousConfig.reasoningEffort !== effectiveConfig.reasoningEffort) {
      runtimeConfig.reasoningEffort = effectiveConfig.reasoningEffort;
    }
    if (previousConfig.fast !== effectiveConfig.fast) {
      runtimeConfig.fast = effectiveConfig.fast;
    }
    if (previousConfig.verbosity !== effectiveConfig.verbosity) {
      runtimeConfig.verbosity = effectiveConfig.verbosity;
    }
    if (Object.keys(runtimeConfig).length > 0) {
      const channel = this.channels.get(channelId);
      if (!channel?.updateConfig) {
        await this.replaceChannel(channelId, effectiveConfig);
        result.restarted.push(channelId);
        return;
      }
      await channel.updateConfig(runtimeConfig);
      this.feishuConfigs.set(channelId, effectiveConfig);
      result.updated.push(channelId);
      return;
    }
    this.feishuConfigs.set(channelId, effectiveConfig);
    result.unchanged.push(channelId);
  }

  private async addChannel(config: FeishuAccountConfig): Promise<void> {
    const channel = this.createFeishuChannel(config);
    try {
      if (this.started) await channel.start();
    } catch (error) {
      await Promise.resolve(channel.stop()).catch(() => undefined);
      throw error;
    }
    this.channels.set(channel.id, channel);
    this.feishuConfigs.set(channel.id, config);
  }

  private async removeChannel(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (channel) await channel.stop();
    this.channels.delete(channelId);
    this.feishuConfigs.delete(channelId);
  }

  private async replaceChannel(
    channelId: string,
    config: FeishuAccountConfig
  ): Promise<void> {
    const previousChannel = this.channels.get(channelId);
    if (previousChannel) await previousChannel.stop();
    const nextChannel = this.createFeishuChannel(config);
    try {
      if (this.started) await nextChannel.start();
    } catch (error) {
      await Promise.resolve(nextChannel.stop()).catch(() => undefined);
      if (previousChannel && this.started) {
        await previousChannel.start().catch(() => undefined);
      }
      throw error;
    }
    this.channels.set(channelId, nextChannel);
    this.feishuConfigs.set(channelId, config);
  }
}

function createReloadResult(): ChannelReloadResult {
  return {
    added: [],
    removed: [],
    restarted: [],
    updated: [],
    unchanged: [],
    ignoredNonHotFields: [],
    errors: [],
  };
}

function resolveFeishuChannelId(accountId: string): string {
  return accountId === "default" ? "feishu" : `feishu:${accountId}`;
}

function preserveNonHotFields(
  previous: FeishuAccountConfig,
  next: FeishuAccountConfig
): FeishuAccountConfig {
  return {
    ...previous,
    enabled: next.enabled,
    appId: next.appId,
    appSecret: next.appSecret,
    botOpenId: next.botOpenId,
    domain: next.domain,
    model: next.model,
    reasoningEffort: next.reasoningEffort,
    fast: next.fast,
    verbosity: next.verbosity,
    sendProgressReplies: next.sendProgressReplies,
  };
}

function requiresRestart(
  previous: FeishuAccountConfig,
  next: FeishuAccountConfig
): boolean {
  return (
    previous.enabled !== next.enabled ||
    previous.appId !== next.appId ||
    previous.appSecret !== next.appSecret ||
    previous.botOpenId !== next.botOpenId ||
    previous.domain !== next.domain
  );
}

function collectIgnoredNonHotFields(
  previous: FeishuAccountConfig,
  next: FeishuAccountConfig
): string[] {
  const fields: string[] = [];
  if (previous.cwd !== next.cwd) fields.push("cwd");
  if (previous.historyBaseDir !== next.historyBaseDir) fields.push("historyBaseDir");
  if (JSON.stringify(previous.history) !== JSON.stringify(next.history)) fields.push("history");
  if (JSON.stringify(previous.summary) !== JSON.stringify(next.summary)) fields.push("summary");
  if (previous.messageDedupeTtlMs !== next.messageDedupeTtlMs) {
    fields.push("messageDedupeTtlMs");
  }
  return fields;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

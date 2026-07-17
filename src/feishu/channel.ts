import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import type { CodexConfig, FeishuAccountConfig } from "../config.js";
import { CodexSessionRouter } from "../session/router.js";
import {
  buildCodexPromptForFeishu,
  extractFileResources,
  extractImageKeys,
  parseFeishuMessageEvent,
  resolveConversationKey,
  shouldHandleMessage,
  stripBotMention,
} from "./events.js";
import { saveFeishuFile, saveFeishuImage } from "./files.js";
import { type FeishuMessageClient, sendFeishuText } from "./send.js";

export interface FeishuEventClient {
  start(onEvent: (payload: unknown) => Promise<void> | void): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface FeishuMediaClient {
  downloadImage(
    imageKey: string,
    messageId: string
  ): Promise<{ buffer: Buffer | Uint8Array; contentType: string }>;
  downloadFile?(
    fileKey: string,
    messageId: string
  ): Promise<{ buffer: Buffer | Uint8Array; contentType: string }>;
}

export interface FeishuRouterLike {
  send(conversationKey: string, prompt: string, imagePaths?: string[]): Promise<void>;
  resetSession(conversationKey: string): void;
  stopSession(conversationKey: string): boolean;
  stopAll(): void;
  getStatus(conversationKey: string): { running: boolean; sessionId?: string };
}

export interface FeishuChannelOptions {
  account: FeishuAccountConfig;
  codex?: CodexConfig;
  eventClient?: FeishuEventClient;
  mediaClient?: FeishuMediaClient;
  messageClient?: FeishuMessageClient;
  router?: FeishuRouterLike;
  projectRoot?: string;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export class FeishuChannel {
  readonly id: string;
  private readonly account: FeishuAccountConfig;
  private readonly codex?: CodexConfig;
  private readonly projectRoot?: string;
  private readonly eventClient: FeishuEventClient;
  private readonly mediaClient?: FeishuMediaClient;
  private readonly messageClient?: FeishuMessageClient;
  private readonly router: FeishuRouterLike;
  private readonly logger: Pick<Console, "log" | "warn" | "error">;
  private readonly replyTargets = new Map<string, string>();
  private readonly handledMessageIds = new Set<string>();
  private status: "not_configured" | "connecting" | "connected" | "stopped";

  constructor(options: FeishuChannelOptions) {
    this.account = options.account;
    this.codex = options.codex;
    this.projectRoot = options.projectRoot;
    this.id = options.account.id === "default" ? "feishu" : `feishu:${options.account.id}`;
    this.eventClient = options.eventClient ?? noopEventClient();
    this.mediaClient = options.mediaClient;
    this.messageClient = options.messageClient;
    this.logger = options.logger ?? console;
    this.router = options.router ?? this.createDefaultRouter();
    this.status = options.account.enabled ? "stopped" : "not_configured";
  }

  async start(): Promise<void> {
    if (!this.account.enabled) {
      this.status = "not_configured";
      return;
    }
    mkdirSync(this.account.cwd, { recursive: true, mode: 0o700 });
    mkdirSync(this.account.historyBaseDir, { recursive: true, mode: 0o700 });
    this.status = "connecting";
    await this.eventClient.start((payload) => this.handleEvent(payload));
    this.status = "connected";
  }

  async stop(): Promise<void> {
    await this.eventClient.stop();
    this.router.stopAll();
    this.status = this.account.enabled ? "stopped" : "not_configured";
  }

  getStatus() {
    return {
      id: this.id,
      status: this.status,
      accountId: this.account.id,
      cwd: this.account.cwd,
      model: this.account.model,
    };
  }

  async handleEvent(payload: unknown): Promise<void> {
    const event = parseFeishuMessageEvent(payload);
    if (!event) return;
    if (!shouldHandleMessage(event, this.account.botOpenId ?? "")) return;
    if (event.messageId && this.handledMessageIds.has(event.messageId)) return;
    if (event.messageId) this.handledMessageIds.add(event.messageId);

    try {
      await this.processMessageEvent(event);
    } catch (error) {
      this.logger.error(formatError(error));
      const conversationKey = resolveConversationKey(event);
      await this.reply(conversationKey, event.messageId, `处理失败：${formatError(error)}`);
    }
  }

  handleSessionOutput(conversationKey: string, text: string): void {
    const replyToMessageId = this.replyTargets.get(conversationKey);
    if (!replyToMessageId || !this.messageClient) return;
    sendFeishuText(this.messageClient, { replyToMessageId, text }).catch((error) => {
      this.logger.error(`飞书回复失败：${formatError(error)}`);
    });
  }

  private async processMessageEvent(event: NonNullable<ReturnType<typeof parseFeishuMessageEvent>>) {
    const conversationKey = resolveConversationKey(event);
    const text = stripBotMention(event.text, event.mentions, this.account.botOpenId ?? "");
    const imageKeys = extractImageKeys(event);
    const fileResources = extractFileResources(event);
    if (!text && imageKeys.length === 0 && fileResources.length === 0) return;

    this.replyTargets.set(conversationKey, event.messageId);
    const command = parseCommand(text);
    if (command) {
      await this.handleCommand(conversationKey, event.messageId, command);
      return;
    }

    const imagePaths = await this.saveImages(event, conversationKey);
    const filePaths = await this.saveFiles(event);
    const prompt = buildCodexPromptForFeishu({
      chatKind: event.chatKind,
      chatId: event.chatId,
      senderName: event.senderName || event.senderOpenId,
      text,
      imagePaths,
      filePaths,
    });
    await this.router.send(conversationKey, prompt, imagePaths);
  }

  private async handleCommand(
    conversationKey: string,
    replyToMessageId: string,
    command: FeishuCommand
  ): Promise<void> {
    if (command === "new") {
      this.router.resetSession(conversationKey);
      await this.reply(conversationKey, replyToMessageId, "已开启新会话。");
      return;
    }
    if (command === "stop") {
      const stopped = this.router.stopSession(conversationKey);
      await this.reply(conversationKey, replyToMessageId, stopped ? "已停止当前会话。" : "当前没有运行中的会话。");
      return;
    }
    const status = this.router.getStatus(conversationKey);
    await this.reply(
      conversationKey,
      replyToMessageId,
      [`状态：${status.running ? "运行中" : "空闲"}`, status.sessionId ? `Codex session：${status.sessionId}` : ""]
        .filter(Boolean)
        .join("\n")
    );
  }

  private async saveImages(
    event: NonNullable<ReturnType<typeof parseFeishuMessageEvent>>,
    conversationKey: string
  ): Promise<string[]> {
    if (!this.mediaClient) return [];
    const paths: string[] = [];
    for (const imageKey of extractImageKeys(event)) {
      try {
        const image = await this.mediaClient.downloadImage(imageKey, event.messageId);
        paths.push(
          saveFeishuImage({
            cwd: this.account.cwd,
            conversationKey,
            messageId: event.messageId,
            imageKey,
            buffer: image.buffer,
            contentType: image.contentType,
          }).path
        );
      } catch (error) {
        this.logger.warn(`图片下载失败：${formatError(error)}`);
      }
    }
    return paths;
  }

  private async saveFiles(
    event: NonNullable<ReturnType<typeof parseFeishuMessageEvent>>
  ): Promise<string[]> {
    if (!this.mediaClient?.downloadFile) return [];
    const paths: string[] = [];
    for (const fileResource of extractFileResources(event)) {
      try {
        const file = await this.mediaClient.downloadFile(fileResource.fileKey, event.messageId);
        const saved = saveFeishuFile({
          cwd: this.account.cwd,
          messageId: event.messageId,
          fileKey: fileResource.fileKey,
          fileName: fileResource.fileName,
          buffer: file.buffer,
          contentType: file.contentType,
        });
        paths.push(saved.path);
      } catch (error) {
        this.logger.warn(`文件下载失败：${basename(fileResource.fileName ?? fileResource.fileKey)} ${formatError(error)}`);
      }
    }
    return paths;
  }

  private async reply(
    conversationKey: string,
    replyToMessageId: string,
    text: string
  ): Promise<void> {
    this.replyTargets.set(conversationKey, replyToMessageId);
    if (!this.messageClient) return;
    await sendFeishuText(this.messageClient, { replyToMessageId, text });
  }

  private createDefaultRouter(): FeishuRouterLike {
    return new CodexSessionRouter({
      cwd: this.account.cwd,
      model: this.account.model,
      historyBaseDir: this.account.historyBaseDir,
      command: this.codex?.command,
      sandbox: this.codex?.sandbox,
      profile: this.codex?.profile,
      search: this.codex?.search,
      skipGitRepoCheck: this.codex?.skipGitRepoCheck,
      dangerouslyBypassApprovalsAndSandbox: this.codex?.dangerouslyBypassApprovalsAndSandbox,
      extraArgs: this.codex?.extraArgs,
      projectRoot: this.projectRoot,
      onOutput: (conversationKey, text) => this.handleSessionOutput(conversationKey, text),
    });
  }
}

type FeishuCommand = "new" | "stop" | "status";

function parseCommand(text: string): FeishuCommand | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "/new" || normalized === "/clear") return "new";
  if (normalized === "/stop") return "stop";
  if (normalized === "/status") return "status";
  return null;
}

function noopEventClient(): FeishuEventClient {
  return {
    start: async () => undefined,
    stop: async () => undefined,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

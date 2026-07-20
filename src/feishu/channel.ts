import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import type { CodexConfig, FeishuAccountConfig } from "../config.js";
import type { SessionAiSummary, SessionSummary } from "../session/history.js";
import {
  type ArchivedSessionDetail,
  type ArchivedSessionSwitchResult,
  CodexSessionRouter,
  type CodexSessionOutputHandler,
  type SessionSummaryWithAi,
} from "../session/router.js";
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
import {
  extractFeishuReturnFileDirectives,
  type FeishuReturnFile,
  resolveFeishuReturnFile,
} from "./return-files.js";
import { type FeishuMessageClient, sendFeishuFile, sendFeishuText } from "./send.js";

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
  send(
    conversationKey: string,
    prompt: string,
    imagePaths?: string[],
    onOutput?: CodexSessionOutputHandler
  ): Promise<void>;
  resetSession(conversationKey: string): void;
  stopSession(conversationKey: string): boolean;
  stopAll(): void;
  getStatus(conversationKey: string): {
    running: boolean;
    sessionId?: string;
    archiveId?: string;
    cwd?: string;
    model?: string;
    messageCount?: number;
  };
  listArchivedSessions?(conversationKey: string): SessionSummary[];
  getCurrentArchivedSession?(conversationKey: string): SessionSummary | null;
  getArchivedSessionDetail?(
    conversationKey: string,
    selection?: number | string
  ): ArchivedSessionDetail | null;
  resumeArchivedSession?(
    conversationKey: string,
    selection: number | string
  ): ArchivedSessionSwitchResult;
  forkArchivedSession?(
    conversationKey: string,
    selection: number | string
  ): ArchivedSessionSwitchResult;
  summarizeArchivedSessions?(
    conversationKey: string,
    count: number | "all"
  ): Promise<SessionSummaryWithAi[]>;
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

  async handleSessionOutput(
    conversationKey: string,
    text: string,
    sourceMessageId?: string
  ): Promise<void> {
    const replyToMessageId = sourceMessageId ?? this.replyTargets.get(conversationKey);
    if (!replyToMessageId || !this.messageClient) return;

    const extracted = extractFeishuReturnFileDirectives(text, this.account.cwd);
    const files: FeishuReturnFile[] = [];
    for (const filePath of extracted.filePaths) {
      try {
        files.push(resolveFeishuReturnFile(this.account.cwd, filePath));
      } catch (error) {
        this.logger.error(`飞书文件回传已忽略：${formatError(error)}`);
      }
    }

    if (extracted.text) {
      await sendFeishuText(this.messageClient, { replyToMessageId, text: extracted.text });
    }
    for (const file of files) {
      await this.replyReturnFile(file, replyToMessageId);
    }
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
    await this.router.send(conversationKey, prompt, imagePaths, (output) =>
      this.handleSessionOutput(conversationKey, output, event.messageId)
    );
  }

  private async handleCommand(
    conversationKey: string,
    replyToMessageId: string,
    command: FeishuCommand
  ): Promise<void> {
    if (command.type === "new") {
      this.router.resetSession(conversationKey);
      await this.reply(conversationKey, replyToMessageId, "已开启新会话。");
      return;
    }
    if (command.type === "file") {
      await this.replyReturnFile(
        resolveFeishuReturnFile(this.account.cwd, command.path),
        replyToMessageId
      );
      return;
    }
    if (command.type === "stop") {
      const stopped = this.router.stopSession(conversationKey);
      await this.reply(conversationKey, replyToMessageId, stopped ? "已停止当前会话。" : "当前没有运行中的会话。");
      return;
    }
    if (command.type === "status") {
      await this.reply(conversationKey, replyToMessageId, this.buildStatusReply(conversationKey));
      return;
    }
    await this.reply(
      conversationKey,
      replyToMessageId,
      await this.buildArchivedSessionReply(conversationKey, command)
    );
  }

  private buildStatusReply(conversationKey: string): string {
    const status = this.router.getStatus(conversationKey);
    return [
      `状态：${status.running ? "运行中" : "空闲"}`,
      `账号：${this.account.id || "default"}`,
      `会话：${conversationKey}`,
      `模型：${status.model ?? this.account.model ?? "-"}`,
      `工作目录：${status.cwd ?? this.account.cwd}`,
      status.archiveId ? `Archive：${status.archiveId}` : "",
      status.sessionId ? `原生 session：${status.sessionId}` : "",
      `消息：${status.messageCount ?? 0}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async buildArchivedSessionReply(
    conversationKey: string,
    command: ArchivedSessionCommand
  ): Promise<string> {
    if (command.type === "sessions") {
      return this.buildArchivedSessionsReply(conversationKey, command);
    }
    if (command.type === "session") {
      return command.selection === undefined
        ? this.buildCurrentArchivedSessionReply(conversationKey)
        : this.buildArchivedSessionHistoryReply(conversationKey, command.selection);
    }

    const result =
      command.type === "resume"
        ? this.router.resumeArchivedSession?.(conversationKey, command.selection)
        : this.router.forkArchivedSession?.(conversationKey, command.selection);
    return formatArchivedSessionSwitchReply(result, command.type);
  }

  private async buildArchivedSessionsReply(
    conversationKey: string,
    command: Extract<FeishuCommand, { type: "sessions" }>
  ): Promise<string> {
    if (!this.router.listArchivedSessions) return "当前会话模式不支持查看历史 session。";
    const sessions = this.router.listArchivedSessions(conversationKey);
    if (sessions.length === 0) return "还没有可恢复的历史 session。";

    const summaries = new Map<string, SessionAiSummary>();
    if (command.summaryCount !== undefined) {
      if (!this.router.summarizeArchivedSessions) return "当前会话模式不支持 session 总结。";
      const values = await this.router.summarizeArchivedSessions(
        conversationKey,
        command.summaryCount
      );
      for (const session of values) summaries.set(session.archiveId, session.aiSummary);
    }

    return [
      command.summaryCount === undefined ? "历史 session：" : "历史 session summary：",
      ...limitSessionList(sessions, command.listCount).map((session, index) =>
        formatArchivedSessionLine(session, index, summaries.get(session.archiveId))
      ),
    ].join("\n");
  }

  private buildCurrentArchivedSessionReply(conversationKey: string): string {
    if (!this.router.getCurrentArchivedSession) return "当前会话模式不支持查看当前 session。";
    const session = this.router.getCurrentArchivedSession(conversationKey);
    if (!session) return "当前没有可查看的 session。";
    return [
      "当前 session：",
      `Archive：${session.archiveId}`,
      `原生 session：${session.sessionId ?? "-"}`,
      `模型：${session.model ?? "-"}`,
      `工作目录：${session.cwd}`,
      `消息：${session.messageCount}`,
      `最近：${session.preview || "-"}`,
      `更新时间：${formatArchivedSessionTime(session.lastActiveAt)}`,
    ].join("\n");
  }

  private buildArchivedSessionHistoryReply(
    conversationKey: string,
    selection: number
  ): string {
    if (!this.router.getArchivedSessionDetail) {
      return "当前会话模式不支持查看历史 session 记录。";
    }
    const detail = this.router.getArchivedSessionDetail(conversationKey, selection);
    if (!detail) return `没有找到第 ${selection} 个 session。`;
    return [
      `Session ${selection} · ${detail.session.current ? "当前" : "历史"} · ${detail.session.messageCount} 条消息`,
      `Archive：${detail.session.archiveId}`,
      `原生 session：${detail.session.sessionId ?? "-"}`,
      `更新时间：${formatArchivedSessionTime(detail.session.lastActiveAt)}`,
      "",
      ...detail.messages.map(formatArchivedHistoryMessage),
    ].join("\n");
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

  private async replyReturnFile(
    file: FeishuReturnFile,
    replyToMessageId: string
  ): Promise<void> {
    if (!this.messageClient) return;
    await sendFeishuFile(this.messageClient, {
      replyToMessageId,
      filePath: file.path,
      fileName: file.fileName,
    });
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

type FeishuCommand =
  | { type: "new" }
  | { type: "stop" }
  | { type: "status" }
  | { type: "sessions"; listCount?: SessionCount; summaryCount?: SessionCount }
  | { type: "session"; selection?: number }
  | { type: "resume"; selection: number }
  | { type: "fork"; selection: number }
  | { type: "file"; path: string };

type SessionCount = number | "all";
type ArchivedSessionCommand = Extract<
  FeishuCommand,
  { type: "sessions" | "session" | "resume" | "fork" }
>;

function parseCommand(text: string): FeishuCommand | null {
  const trimmed = text.trim();
  const normalized = trimmed.toLowerCase();
  if (normalized === "/new" || normalized === "/clear") return { type: "new" };
  if (normalized === "/stop") return { type: "stop" };
  if (normalized === "/status") return { type: "status" };
  const sessions = parseSessionsCommand(trimmed);
  if (sessions) return sessions;
  if (normalized === "/session") return { type: "session" };
  const session = trimmed.match(/^\/session\s+(\d+)$/i);
  if (session) return { type: "session", selection: Number(session[1]) };
  const resume = trimmed.match(/^\/resume\s+(\d+)$/i);
  if (resume) return { type: "resume", selection: Number(resume[1]) };
  const fork = trimmed.match(/^\/fork\s+(\d+)$/i);
  if (fork) return { type: "fork", selection: Number(fork[1]) };
  const file = trimmed.match(/^\/(?:file|sendfile)\s+(.+)$/i);
  if (file) return { type: "file", path: file[1].trim() };
  return null;
}

function parseSessionsCommand(text: string): FeishuCommand | null {
  const tokens = text.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() !== "/sessions") return null;
  let listCount: SessionCount | undefined;
  let summaryCount: SessionCount | undefined;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.toLowerCase() === "--summary") {
      const count = parseSessionCount(tokens[index + 1]);
      if (count !== null) {
        summaryCount = count;
        index += 1;
      } else {
        summaryCount = 10;
      }
      continue;
    }
    const count = parseSessionCount(token);
    if (count === null || listCount !== undefined) return null;
    listCount = count;
  }

  if (summaryCount !== undefined) {
    listCount = listCount === undefined ? summaryCount : maxSessionCount(listCount, summaryCount);
  }
  return { type: "sessions", listCount, summaryCount };
}

function parseSessionCount(value: string | undefined): SessionCount | null {
  if (!value) return null;
  if (value.toLowerCase() === "all") return "all";
  if (!/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count > 0 ? count : null;
}

function maxSessionCount(left: SessionCount, right: SessionCount): SessionCount {
  if (left === "all" || right === "all") return "all";
  return Math.max(left, right);
}

function limitSessionList<T>(sessions: T[], count: SessionCount | undefined): T[] {
  if (count === undefined || count === "all") return sessions;
  return sessions.slice(0, count);
}

function formatArchivedSessionLine(
  session: SessionSummary,
  index: number,
  summary?: SessionAiSummary
): string {
  const marker = session.current ? "当前" : "历史";
  const resumable = session.nativeSessionStarted ? "" : " · 不可直接 resume";
  const forkedFrom = session.forkedFrom ? ` · fork 自 ${session.forkedFrom}` : "";
  if (session.messageCount === 0) {
    return `${index + 1}. ${marker} · ${formatArchivedSessionTime(session.lastActiveAt)} · 0 条消息 · 空会话${forkedFrom}`;
  }
  if (summary) {
    return [
      `${index + 1}. ${marker} · ${formatArchivedSessionTime(session.lastActiveAt)} · ${session.messageCount} 条消息${resumable}${forkedFrom}`,
      `   主题：${summary.topic}`,
      `   关键信息：${summary.keyInfo}`,
      `   最近动作：${summary.recentAction}`,
    ].join("\n");
  }
  return [
    `${index + 1}. ${marker} · ${formatArchivedSessionTime(session.lastActiveAt)} · ${session.messageCount} 条消息${resumable}${forkedFrom}`,
    `   ${session.preview || session.archiveId}`,
  ].join("\n");
}

function formatArchivedHistoryMessage(message: {
  role: "user" | "assistant";
  text: string;
}): string {
  const text = message.text.trim();
  const truncated = text.length > 2000 ? `${text.slice(0, 2000)}\n...` : text;
  return `${message.role === "user" ? "用户" : "模型"}：\n${truncated}`;
}

function formatArchivedSessionSwitchReply(
  result: ArchivedSessionSwitchResult | undefined,
  action: "resume" | "fork"
): string {
  if (!result) {
    return action === "resume"
      ? "当前会话模式不支持恢复历史 session。"
      : "当前会话模式不支持 fork 历史 session。";
  }
  if (!result.ok) return result.message;
  return [
    result.message,
    result.archiveId ? `Archive：${result.archiveId}` : "",
    result.sessionId ? `原生 session：${result.sessionId}` : "",
    result.forkedFrom ? `fork 自：${result.forkedFrom}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatArchivedSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

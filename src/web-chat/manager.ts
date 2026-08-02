import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import type {
  CodexModelOption,
} from "../codex/model-catalog.js";
import type { CodexAppServerRuntime } from "../codex/app-server-runtime.js";
import type { CodexProgressEvent } from "../codex/json-events.js";
import type { CodexRunner } from "../codex/runner.js";
import type {
  CodexReasoningEffort,
  CodexVerbosity,
} from "../codex/runtime-settings.js";
import type { CodexConfig } from "../config.js";
import {
  extractFeishuReturnFileDirectives,
} from "../feishu/return-files.js";
import {
  FeishuMessageProgressTracker,
  type FeishuTrackedMessage,
  type FeishuTrackedSession,
} from "../feishu/message-tracker.js";
import type {
  SessionAttachment,
  SessionMessage,
} from "../session/history.js";
import {
  CodexSessionRouter,
  type ArchivedSessionDetail,
  type CodexSessionRouterOptions,
  type SessionSummaryWithAi,
} from "../session/router.js";
import type { SessionSummary } from "../session/history.js";
import { WebChatEventHub } from "./event-hub.js";
import {
  WebChatFileRepository,
  type WebChatFilePublic,
  type WebChatOpenedFile,
  type WebChatUploadInput,
} from "./files.js";
import {
  WebChatSessionStore,
  type WebChatSessionInput,
  type WebChatSessionRecord,
  type WebChatSessionRuntimeInput,
} from "./session-store.js";
import {
  WebChatCapabilityCatalog,
  type WebChatCapabilityPublic,
} from "./capabilities.js";
import {
  WEB_CHAT_COMMANDS,
  type WebChatCommandRequest,
} from "./commands.js";
import { WebChatTraceNormalizer } from "./trace-normalizer.js";
import { WebChatTraceStore } from "./trace-store.js";
import type { WebChatTurnTrace } from "./trace-types.js";
import type {
  CreateWebChatUserInput,
  UpdateWebChatUserInput,
  WebChatUserPublic,
} from "./types.js";
import { WebChatUserStore } from "./user-store.js";

export interface WebChatManagerOptions {
  gatewayHome?: string;
  projectRoot: string;
  codex: CodexConfig;
  userStore?: WebChatUserStore;
  sessionStore?: WebChatSessionStore;
  eventHub?: WebChatEventHub;
  fileRepository?: WebChatFileRepository;
  modelCatalogProvider: () => Promise<CodexModelOption[]>;
  runner?: CodexRunner;
  appServerRuntime?: CodexAppServerRuntime;
  capabilityCatalog?: WebChatCapabilityCatalog;
  traceStore?: WebChatTraceStore;
  traceNormalizer?: WebChatTraceNormalizer;
  createRouter?: (options: CodexSessionRouterOptions) => CodexSessionRouter;
  createMessageId?: () => string;
}

export interface WebChatSendInput {
  text: string;
  fileIds?: string[];
  references?: string[];
}

export interface WebChatSendResult {
  messageId: string;
  assistantMessageId: string;
  output?: string;
  attachments: SessionAttachment[];
}

export interface WebChatRewriteBranchResult {
  session: WebChatSessionRecord;
  fileIds: string[];
  references: string[];
}

export interface WebChatMessagePage {
  messages: SessionMessage[];
  total: number;
  nextOffset?: number;
}

export interface WebChatCommandResult {
  ok: boolean;
  message: string;
  session?: WebChatSessionRecord;
  data?: unknown;
}

export interface WebChatBatchDeleteResult {
  deletedIds: string[];
  stoppedIds: string[];
  failed: Array<{ sessionId: string; error: string }>;
}

export interface WebChatAccountSettingsInput {
  model?: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
  fast?: boolean | null;
}

export interface WebChatAccountSettings {
  user: WebChatUserPublic;
  defaults: {
    model: string | null;
    reasoningEffort: CodexReasoningEffort | null;
    fast: boolean | null;
  };
  effective: {
    model: string | null;
    reasoningEffort: CodexReasoningEffort | null;
    fast: boolean;
  };
  inherited: {
    model: string | null;
    reasoningEffort: CodexReasoningEffort | null;
    fast: boolean;
  };
}

interface WebChatRunState {
  pending: number;
  cancelled: boolean;
}

const ATTACHMENT_ONLY_PROMPT = "请查看并处理用户提供的附件。";
const REFERENCE_ONLY_PROMPT = "请查看并使用用户选择的上下文。";

export class WebChatManager {
  readonly userStore: WebChatUserStore;
  readonly sessionStore: WebChatSessionStore;
  readonly eventHub: WebChatEventHub;
  readonly fileRepository: WebChatFileRepository;
  readonly traceStore: WebChatTraceStore;
  readonly capabilityCatalog?: WebChatCapabilityCatalog;
  private readonly routers = new Map<string, CodexSessionRouter>();
  private readonly runStates = new Map<string, WebChatRunState>();
  private readonly trackers = new Map<string, FeishuMessageProgressTracker>();
  private readonly createRouter: (options: CodexSessionRouterOptions) => CodexSessionRouter;
  private readonly createMessageId: () => string;
  private readonly traceNormalizer: WebChatTraceNormalizer;
  private codex: CodexConfig;

  get appServerReady(): boolean {
    return this.options.appServerRuntime?.ready ?? false;
  }

  constructor(private readonly options: WebChatManagerOptions) {
    this.codex = cloneCodexConfig(options.codex);
    this.userStore =
      options.userStore ?? new WebChatUserStore({ gatewayHome: options.gatewayHome });
    this.sessionStore =
      options.sessionStore ??
      new WebChatSessionStore({ gatewayHome: options.gatewayHome });
    this.eventHub = options.eventHub ?? new WebChatEventHub();
    this.fileRepository =
      options.fileRepository ??
      new WebChatFileRepository({ gatewayHome: options.gatewayHome });
    this.traceStore =
      options.traceStore ??
      new WebChatTraceStore({
        gatewayHome: options.gatewayHome,
        warn: (message) => console.warn(`[codex-gateway] ${message}`),
      });
    this.traceNormalizer =
      options.traceNormalizer ?? new WebChatTraceNormalizer();
    this.capabilityCatalog =
      options.capabilityCatalog ??
      (options.appServerRuntime
        ? new WebChatCapabilityCatalog({ runtime: options.appServerRuntime })
        : undefined);
    this.createRouter =
      options.createRouter ?? ((routerOptions) => new CodexSessionRouter(routerOptions));
    this.createMessageId =
      options.createMessageId ?? (() => `message-${randomUUID()}`);
    this.clearStaleRunningState();
    this.syncBlankSessionRuntime();
  }

  listUsers(): WebChatUserPublic[] {
    return this.userStore.list();
  }

  createUser(input: CreateWebChatUserInput): Promise<WebChatUserPublic> {
    return this.userStore.create(input);
  }

  updateUser(
    userId: string,
    input: UpdateWebChatUserInput
  ): WebChatUserPublic | null {
    const updated = this.userStore.update(userId, input);
    if (updated && !updated.enabled) this.stopUser(userId);
    return updated;
  }

  async getAccountSettings(userId: string): Promise<WebChatAccountSettings> {
    const user = this.requireEnabledUser(userId);
    const models = await this.listModels();
    return buildAccountSettings(user, this.codex, models);
  }

  async updateAccountSettings(
    userId: string,
    input: WebChatAccountSettingsInput
  ): Promise<WebChatAccountSettings> {
    const user = this.requireEnabledUser(userId);
    const defaults = {
      model: Object.prototype.hasOwnProperty.call(input, "model")
        ? input.model ?? null
        : user.model ?? null,
      reasoningEffort: Object.prototype.hasOwnProperty.call(
        input,
        "reasoningEffort"
      )
        ? input.reasoningEffort ?? null
        : user.reasoningEffort ?? null,
      fast: Object.prototype.hasOwnProperty.call(input, "fast")
        ? input.fast ?? null
        : user.fast ?? null,
    };
    const candidate: WebChatUserPublic = {
      ...user,
      model: defaults.model ?? undefined,
      reasoningEffort: defaults.reasoningEffort ?? undefined,
      fast: defaults.fast ?? undefined,
    };
    const models = await this.listModels();
    validateAccountSettings(candidate, this.codex, models);
    const updated = this.userStore.update(userId, defaults);
    if (!updated) throw new Error("用户不存在或已停用。");
    this.syncBlankSessionRuntime(userId);
    return buildAccountSettings(updated, this.codex, models);
  }

  resetUserPassword(userId: string, password: string): Promise<boolean> {
    return this.userStore.resetPassword(userId, password);
  }

  removeUser(userId: string, purgeData: boolean): boolean {
    this.stopUser(userId);
    return this.userStore.remove(userId, purgeData);
  }

  listSessions(userId: string): WebChatSessionRecord[] {
    if (!this.userStore.getById(userId)) return [];
    return this.sessionStore.list(userId);
  }

  getSession(userId: string, sessionId: string): WebChatSessionRecord | null {
    if (!this.userStore.getById(userId)) return null;
    return this.sessionStore.get(userId, sessionId);
  }

  createSession(
    userId: string,
    input: WebChatSessionInput = {}
  ): WebChatSessionRecord {
    const user = this.requireEnabledUser(userId);
    const runtime = resolveSessionRuntime(input, user, this.codex);
    const session = this.sessionStore.create(userId, {
      ...input,
      ...runtime,
    });
    this.eventHub.publish(userId, {
      sessionId: session.id,
      type: "session.created",
      payload: { session },
    });
    return session;
  }

  updateCodexConfig(codex: CodexConfig): void {
    this.codex = cloneCodexConfig(codex);
    this.syncBlankSessionRuntime();
  }

  private syncBlankSessionRuntime(userId?: string): void {
    const users = userId
      ? this.userStore.list().filter((user) => user.id === userId)
      : this.userStore.list();
    for (const user of users) {
      for (const session of this.sessionStore.list(user.id)) {
        if (!this.isBlankSession(user.id, session)) continue;
        const runtime = resolveSessionRuntime({}, user, this.codex);
        if (
          session.model === runtime.model
          && session.reasoningEffort === runtime.reasoningEffort
          && session.fast === runtime.fast
          && session.verbosity === runtime.verbosity
        ) {
          continue;
        }
        const updated = this.sessionStore.updateRuntime(user.id, session.id, runtime);
        if (!updated) continue;
        const router = this.routers.get(runKey(user.id, session.id));
        if (router) {
          router.updateDefaults(runtime);
          router.updateCurrentSessionRuntime(session.id, runtime);
        }
        this.eventHub.publish(user.id, {
          sessionId: session.id,
          type: "session.updated",
          payload: { session: updated },
        });
      }
    }
  }

  renameSession(
    userId: string,
    sessionId: string,
    title: string
  ): WebChatSessionRecord | null {
    const session = this.sessionStore.rename(userId, sessionId, title);
    if (session) {
      if (session.threadId && this.options.appServerRuntime) {
        void this.options.appServerRuntime
          .setThreadName(session.threadId, session.title)
          .catch((error) => {
            console.warn(
              `[codex-gateway] Web Chat Thread 重命名同步失败：${formatError(error)}`
            );
          });
      }
      this.eventHub.publish(userId, {
        sessionId,
        type: "session.updated",
        payload: { session },
      });
    }
    return session;
  }

  removeSession(userId: string, sessionId: string): boolean {
    return this.removeSessions(userId, [sessionId]).deletedIds.length === 1;
  }

  removeSessions(userId: string, sessionIds: string[]): WebChatBatchDeleteResult {
    const result: WebChatBatchDeleteResult = {
      deletedIds: [],
      stoppedIds: [],
      failed: [],
    };
    for (const sessionId of Array.from(new Set(sessionIds))) {
      const session = this.sessionStore.get(userId, sessionId);
      if (!session) {
        result.failed.push({ sessionId, error: "Session 不存在。" });
        continue;
      }
      const key = runKey(userId, sessionId);
      const wasRunning = session.running || this.runStates.has(key);
      if (wasRunning) {
        this.stopSession(userId, sessionId);
        result.stoppedIds.push(sessionId);
      }
      if (this.removeSessionRecord(userId, sessionId, session)) {
        result.deletedIds.push(sessionId);
      } else {
        result.failed.push({ sessionId, error: "Session 删除失败。" });
      }
    }
    return result;
  }

  private removeSessionRecord(
    userId: string,
    sessionId: string,
    session: WebChatSessionRecord
  ): boolean {
    const key = runKey(userId, sessionId);
    if (!this.sessionStore.remove(userId, sessionId)) return false;
    if (session?.threadId && this.options.appServerRuntime) {
      void this.options.appServerRuntime.deleteThread(session.threadId).catch((error) => {
        console.warn(
          `[codex-gateway] Web Chat Thread 删除同步失败：${formatError(error)}`
        );
      });
    }
    this.routers.delete(key);
    this.runStates.delete(key);
    this.traceStore.removeSession(userId, sessionId);
    this.eventHub.publish(userId, {
      sessionId,
      type: "session.deleted",
      payload: {},
    });
    return true;
  }

  stopSession(userId: string, sessionId: string): boolean {
    const session = this.sessionStore.get(userId, sessionId);
    if (!session) return false;
    const key = runKey(userId, sessionId);
    const state = this.runStates.get(key);
    if (state) state.cancelled = true;
    const stopped = this.routers.get(key)?.stopSession(sessionId) ?? session.running;
    this.routers.delete(key);
    this.runStates.delete(key);
    this.sessionStore.setRunning(userId, sessionId, false);
    this.markConversationStopped(userId, sessionId);
    for (const trace of this.traceStore.list(userId, sessionId)) {
      if (trace.status !== "running") continue;
      this.traceNormalizer.finalize(trace, "stopped");
      this.traceStore.save(trace);
      this.publishTrace(userId, sessionId, trace);
    }
    this.publishRunning(userId, sessionId, false);
    return stopped;
  }

  forkSession(
    userId: string,
    sessionId: string
  ): WebChatSessionRecord | null {
    const source = this.sessionStore.get(userId, sessionId);
    if (!source || source.running) return null;
    const sourceRouter = this.routerFor(userId, source);
    const messages =
      sourceRouter.getArchivedSessionDetail(sessionId)?.messages ?? [];
    const fork = this.createSession(userId, {
      title: `${source.title} 副本`,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
      fast: source.fast,
      verbosity: source.verbosity,
      forkedFrom: source.id,
    });
    this.routerFor(userId, fork).importMessages(fork.id, messages, source.id);
    if (source.threadId && this.options.appServerRuntime) {
      void this.options.appServerRuntime
        .forkThread(source.threadId, this.requireEnabledUser(userId).workspacePath)
        .then((threadId) => {
          this.sessionStore.updateThreadState(userId, fork.id, { threadId });
        })
        .catch((error) => {
          console.warn(
            `[codex-gateway] Web Chat Thread 分支同步失败：${formatError(error)}`
          );
        });
    }
    return fork;
  }

  createRewriteBranch(
    userId: string,
    sessionId: string,
    messageId: string
  ): WebChatRewriteBranchResult {
    const source = this.sessionStore.get(userId, sessionId);
    if (!source) throw new Error("Session 不存在。");
    if (source.running || this.runStates.has(runKey(userId, sessionId))) {
      throw new Error("当前会话仍在运行，不能重写消息。");
    }
    const sourceRouter = this.routerFor(userId, source);
    const messages =
      sourceRouter.getArchivedSessionDetail(sessionId)?.messages ?? [];
    const targetIndex = messages.findIndex(
      (message) => message.role === "user" && message.id === messageId
    );
    if (targetIndex < 0) throw new Error("没有找到要重写的用户消息。");
    const target = messages[targetIndex]!;
    const branch = this.createSession(userId, {
      title: `${source.title}（重写）`,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
      fast: source.fast,
      verbosity: source.verbosity,
      forkedFrom: source.id,
    });
    this.routerFor(userId, branch).importMessages(
      branch.id,
      messages.slice(0, targetIndex),
      source.id
    );
    return {
      session: branch,
      fileIds: (target.attachments ?? [])
        .filter(
          (attachment) =>
            attachment.kind === "upload" &&
            Boolean(this.fileRepository.open(userId, attachment.id))
        )
        .map((attachment) => attachment.id),
      references: (target.references ?? []).map((reference) => reference.id),
    };
  }

  listMessages(
    userId: string,
    sessionId: string,
    input: { offset?: number; limit?: number } = {}
  ): WebChatMessagePage | null {
    const session = this.sessionStore.get(userId, sessionId);
    if (!session) return null;
    const messages =
      this.routerFor(userId, session).getArchivedSessionDetail(sessionId)?.messages ?? [];
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
    const page = messages.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      messages: page,
      total: messages.length,
      ...(nextOffset < messages.length ? { nextOffset } : {}),
    };
  }

  listTraces(userId: string, sessionId: string): WebChatTurnTrace[] {
    return this.sessionStore.get(userId, sessionId)
      ? this.traceStore.list(userId, sessionId)
      : [];
  }

  async listCapabilities(
    userId: string,
    sessionId: string
  ): Promise<WebChatCapabilityPublic[]> {
    const user = this.requireEnabledUser(userId);
    const session = this.sessionStore.get(userId, sessionId);
    if (!session) throw new Error("Session 不存在。");
    return this.capabilityCatalog?.list(
      userId,
      user.workspacePath,
      session.threadId
    ) ?? [];
  }

  async searchCapabilities(
    userId: string,
    sessionId: string,
    query: string
  ): Promise<WebChatCapabilityPublic[]> {
    const user = this.requireEnabledUser(userId);
    if (!this.sessionStore.get(userId, sessionId)) {
      throw new Error("Session 不存在。");
    }
    return this.capabilityCatalog?.searchFiles(
      userId,
      user.workspacePath,
      query.trim()
    ) ?? [];
  }

  async sendMessage(
    userId: string,
    sessionId: string,
    input: WebChatSendInput
  ): Promise<WebChatSendResult> {
    const user = this.requireEnabledUser(userId);
    let session = this.sessionStore.get(userId, sessionId);
    if (!session) throw new Error("Session 不存在。");
    const text = input.text.trim();
    const files = (input.fileIds ?? []).map((fileId) => {
      const opened = this.fileRepository.open(userId, fileId);
      if (!opened) throw new Error("附件不存在。");
      return opened;
    });
    if (!text && files.length === 0 && (input.references?.length ?? 0) === 0) {
      throw new Error("消息内容不能为空。");
    }
    const preview =
      text
      || files[0]?.file.name
      || (input.references?.length ? "上下文消息" : "附件消息");
    const prompt =
      text
      || (files.length > 0 ? ATTACHMENT_ONLY_PROMPT : REFERENCE_ONLY_PROMPT);
    const codexPrompt = buildCodexPrompt(user.workspacePath, prompt, files);
    const resolvedCapabilities =
      input.references && input.references.length > 0
        ? this.requireCapabilityCatalog().resolve(
            userId,
            user.workspacePath,
            input.references
          )
        : undefined;
    if (session.title === "新对话") {
      session =
        this.sessionStore.rename(userId, sessionId, titleFromMessage(preview)) ?? session;
    }
    const messageId = this.createMessageId();
    const assistantMessageId = this.createMessageId();
    const trace = this.traceNormalizer.create({
      messageId,
      assistantMessageId,
      userId,
      sessionId,
      threadId: session.threadId,
    });
    this.traceStore.save(trace);
    const attachments = files.map((file) =>
      this.fileRepository.toAttachment(file.file)
    );
    const tracker = this.trackerFor(userId);
    tracker.start({
      messageId,
      conversationKey: sessionId,
      chatKind: "direct",
      senderName: user.username,
      preview: titleFromMessage(preview),
      imageCount: files.filter((file) => file.file.image).length,
      fileCount: files.length,
    });
    tracker.update(messageId, { stage: "queued" });
    this.eventHub.publish(userId, {
      sessionId,
      type: "message.accepted",
      payload: {
        messageId,
        text,
        attachments,
        references: resolvedCapabilities?.references ?? [],
      },
    });

    const key = runKey(userId, sessionId);
    const state = this.runStates.get(key) ?? { pending: 0, cancelled: false };
    if (state.pending === 0) {
      this.runStates.set(key, state);
      this.sessionStore.setRunning(userId, sessionId, true);
      this.publishRunning(userId, sessionId, true);
    }
    state.pending += 1;

    const generatedFiles: WebChatFilePublic[] = [];
    let output: string | undefined;
    try {
      await this.routerFor(userId, session).send(
        sessionId,
        codexPrompt,
        files.filter((file) => file.file.image).map((file) => file.path),
        async (cleanText, outputAttachments) => {
          output = cleanText;
          tracker.appendOutputForMessage(messageId, cleanText);
          if (generatedFiles.length > 0) {
            tracker.setFileAttachments(
              messageId,
              generatedFiles.flatMap((file) => {
                const opened = this.fileRepository.open(userId, file.id);
                return opened ? [{ name: file.name, path: opened.path }] : [];
              })
            );
          }
          tracker.update(messageId, { stage: "completed" });
          this.eventHub.publish(userId, {
            sessionId,
            type: "message.completed",
            payload: {
              messageId: assistantMessageId,
              text: cleanText,
              attachments: outputAttachments ?? [],
            },
          });
        },
        (event) => this.handleProgress(userId, sessionId, messageId, trace, event),
        {
          userMessage: {
            id: messageId,
            text,
            attachments: attachments.length > 0 ? attachments : undefined,
            references: resolvedCapabilities?.references,
          },
          assistantMessageId,
          structuredInput: resolvedCapabilities
            ? [
                { type: "text", text: codexPrompt },
                ...resolvedCapabilities.structuredInput,
              ]
            : undefined,
          additionalContext: resolvedCapabilities?.additionalContext,
          onResult: (result) => {
            trace.threadId = result.sessionId;
            trace.turnId = result.turnId;
            if (result.sessionId) {
              this.sessionStore.updateThreadState(userId, sessionId, {
                threadId: result.sessionId,
              });
            }
            this.traceStore.save(trace);
          },
          processOutput: (rawText) => {
            const extracted = extractFeishuReturnFileDirectives(
              rawText,
              user.workspacePath
            );
            for (const filePath of extracted.filePaths) {
              try {
                generatedFiles.push(
                  this.fileRepository.registerGenerated(userId, filePath)
                );
              } catch {}
            }
            return {
              text: extracted.text,
              attachments: generatedFiles.map((file) =>
                this.fileRepository.toAttachment(file)
              ),
            };
          },
        }
      );
      if (!state.cancelled && output === undefined) {
        tracker.update(messageId, { stage: "completed" });
      }
      if (!state.cancelled) {
        this.traceNormalizer.finalize(trace, "completed");
        this.traceStore.save(trace);
        this.publishTrace(userId, sessionId, trace);
      }
      return {
        messageId,
        assistantMessageId,
        output,
        attachments: generatedFiles.map((file) =>
          this.fileRepository.toAttachment(file)
        ),
      };
    } catch (error) {
      if (!state.cancelled) {
        this.traceNormalizer.finalize(trace, "failed", formatError(error));
        this.traceStore.save(trace);
        this.publishTrace(userId, sessionId, trace);
        tracker.update(messageId, {
          stage: "failed",
          error: formatError(error),
        });
        this.eventHub.publish(userId, {
          sessionId,
          type: "message.failed",
          payload: { messageId, message: "处理失败，请稍后重试。" },
        });
      }
      throw error;
    } finally {
      if (this.runStates.get(key) === state) {
        state.pending = Math.max(0, state.pending - 1);
        if (state.pending === 0) {
          this.runStates.delete(key);
          this.sessionStore.setRunning(userId, sessionId, false);
          this.publishRunning(userId, sessionId, false);
        }
      }
    }
  }

  uploadFile(
    userId: string,
    sessionId: string,
    input: WebChatUploadInput
  ): WebChatFilePublic {
    this.requireEnabledUser(userId);
    if (!this.sessionStore.get(userId, sessionId)) throw new Error("Session 不存在。");
    const file = this.fileRepository.saveUpload(userId, input);
    this.eventHub.publish(userId, {
      sessionId,
      type: "file.available",
      payload: { file },
    });
    return file;
  }

  openFile(userId: string, fileId: string): WebChatOpenedFile | null {
    if (!this.userStore.getById(userId)) return null;
    return this.fileRepository.open(userId, fileId);
  }

  async listModels(): Promise<CodexModelOption[]> {
    return this.options.modelCatalogProvider();
  }

  async checkAppServer(): Promise<{
    ready: boolean;
    models: number;
    skills: number;
    plugins: number;
    apps: number;
  }> {
    const runtime = this.options.appServerRuntime;
    if (!runtime) {
      const models = await this.listModels();
      return {
        ready: models.length > 0,
        models: models.length,
        skills: 0,
        plugins: 0,
        apps: 0,
      };
    }
    const cwd =
      this.listUsers().find((user) => user.enabled)?.workspacePath
      ?? this.options.projectRoot;
    const [models, skillEntries, plugins, apps] = await Promise.all([
      runtime.listModels(),
      runtime.listSkills(cwd),
      runtime.listInstalledPlugins(cwd),
      runtime.listInstalledApps(),
    ]);
    const skills = skillEntries.reduce<number>((count, entry) => {
      const value = entry as { skills?: unknown };
      return count + (Array.isArray(value.skills) ? value.skills.length : 0);
    }, 0);
    return {
      ready: true,
      models: models.length,
      skills,
      plugins: plugins.length,
      apps: apps.length,
    };
  }

  async listEfforts(
    userId: string,
    sessionId: string
  ): Promise<CodexReasoningEffort[]> {
    const session = this.sessionStore.get(userId, sessionId);
    if (!session) return [];
    const models = await this.listModels();
    return (
      resolveModel(models, session.model)?.supportedReasoningEfforts.map(
        (item) => item.reasoningEffort
      ) ?? []
    );
  }

  async updateRuntime(
    userId: string,
    sessionId: string,
    input: WebChatSessionRuntimeInput
  ): Promise<WebChatSessionRecord | null> {
    const session = this.sessionStore.get(userId, sessionId);
    if (!session || session.running) return null;
    const models = await this.listModels();
    const requestedModel = Object.prototype.hasOwnProperty.call(input, "model")
      ? input.model ?? undefined
      : session.model;
    const model = resolveModel(models, requestedModel);
    if (requestedModel && !model) {
      throw new Error(`模型 ${requestedModel} 不在当前模型目录中。`);
    }
    const effectiveEffort = Object.prototype.hasOwnProperty.call(
      input,
      "reasoningEffort"
    )
      ? input.reasoningEffort ?? undefined
      : session.reasoningEffort;
    if (
      effectiveEffort &&
      model &&
      !model.supportedReasoningEfforts.some(
        (item) => item.reasoningEffort === effectiveEffort
      )
    ) {
      throw new Error(`模型 ${model.model} 不支持 Effort ${effectiveEffort}。`);
    }
    const effectiveFast = Object.prototype.hasOwnProperty.call(input, "fast")
      ? input.fast ?? undefined
      : session.fast;
    if (effectiveFast === true && model && !model.supportsFast) {
      throw new Error(`模型 ${model.model} 不支持 Fast。`);
    }
    const normalized: WebChatSessionRuntimeInput = {
      ...input,
      ...(Object.prototype.hasOwnProperty.call(input, "model")
        ? { model: model?.model ?? null }
        : {}),
    };
    const router = this.routerFor(userId, session);
    const routerUpdated = router.updateCurrentSessionRuntime(sessionId, {
      ...(Object.prototype.hasOwnProperty.call(normalized, "model")
        ? { model: normalized.model ?? undefined }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(normalized, "reasoningEffort")
        ? { reasoningEffort: normalized.reasoningEffort ?? undefined }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(normalized, "fast")
        ? { fast: normalized.fast ?? undefined }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(normalized, "verbosity")
        ? { verbosity: normalized.verbosity ?? undefined }
        : {}),
    });
    if (!routerUpdated) return null;
    const updated = this.sessionStore.updateRuntime(userId, sessionId, normalized);
    if (updated) {
      this.eventHub.publish(userId, {
        sessionId,
        type: "session.updated",
        payload: { session: updated },
      });
    }
    return updated;
  }

  async executeCommand(
    userId: string,
    sessionId: string,
    command: WebChatCommandRequest
  ): Promise<WebChatCommandResult> {
    const session = this.sessionStore.get(userId, sessionId);
    if (!session) throw new Error("Session 不存在。");
    const runtime = this.options.appServerRuntime;
    const value = stringArgument(command.arguments.value);

    if (command.name === "help") {
      return { ok: true, message: "可用命令", data: WEB_CHAT_COMMANDS };
    }
    if (command.name === "new") {
      const created = this.createSession(userId);
      return { ok: true, message: "已创建新会话。", session: created };
    }
    if (command.name === "fork") {
      const fork = this.forkSession(userId, sessionId);
      if (!fork) throw new Error("当前会话无法分支。");
      return { ok: true, message: "已创建会话分支。", session: fork };
    }
    if (command.name === "stop") {
      const stopped = this.stopSession(userId, sessionId);
      return {
        ok: stopped,
        message: stopped ? "已停止当前执行。" : "当前没有运行中的任务。",
      };
    }
    if (command.name === "clear") {
      if (session.running) throw new Error("当前会话仍在运行。");
      if (!this.routerFor(userId, session).clearNativeContext(sessionId)) {
        throw new Error("当前会话无法清空上下文。");
      }
      const updated = this.sessionStore.updateThreadState(userId, sessionId, {
        threadId: null,
      });
      return {
        ok: true,
        message: "已清空 Codex 上下文。",
        session: updated ?? session,
      };
    }
    if (command.name === "model") {
      if (!value) {
        return { ok: true, message: session.model ?? "Codex 默认模型" };
      }
      const updated = await this.updateRuntime(userId, sessionId, { model: value });
      if (!updated) throw new Error("当前会话无法修改模型。");
      return {
        ok: true,
        message: `模型已切换为 ${updated.model}。`,
        session: updated,
      };
    }
    if (command.name === "effort") {
      if (!value) {
        return {
          ok: true,
          message: session.reasoningEffort ?? "模型默认 Effort",
          data: await this.listEfforts(userId, sessionId),
        };
      }
      const updated = await this.updateRuntime(userId, sessionId, {
        reasoningEffort: value as CodexReasoningEffort,
      });
      if (!updated) throw new Error("当前会话无法修改 Effort。");
      return {
        ok: true,
        message: `Effort 已切换为 ${value}。`,
        session: updated,
      };
    }
    if (command.name === "fast") {
      const fast = value
        ? value === "on" || value === "true" || value === "fast"
        : !session.fast;
      const updated = await this.updateRuntime(userId, sessionId, { fast });
      if (!updated) throw new Error("当前会话无法修改速度。");
      return {
        ok: true,
        message: fast ? "Fast 已开启。" : "已切换为标准速度。",
        session: updated,
      };
    }
    if (command.name === "status") {
      return {
        ok: true,
        message: "当前会话状态",
        data: {
          model: session.model,
          reasoningEffort: session.reasoningEffort,
          fast: session.fast === true,
          goal: session.goal,
          planMode: session.planMode,
          permissionProfile: session.permissionProfile,
          threadId: session.threadId,
        },
      };
    }

    const threadId = session.threadId;
    if (!runtime || !threadId) {
      throw new Error("当前会话尚未建立 Codex Thread，请先发送一条消息。");
    }
    if (command.name === "goal") {
      if (!value) {
        const data = await runtime.executeThreadAction({
          type: "goal-get",
          threadId,
        });
        return {
          ok: true,
          message: session.goal ?? "当前未设置目标。",
          data,
        };
      }
      if (value === "clear") {
        await runtime.executeThreadAction({ type: "goal-clear", threadId });
        const updated = this.sessionStore.updateThreadState(userId, sessionId, {
          goal: null,
        });
        return {
          ok: true,
          message: "目标已清除。",
          session: updated ?? session,
        };
      }
      await runtime.executeThreadAction({
        type: "goal-set",
        threadId,
        objective: value,
      });
      const updated = this.sessionStore.updateThreadState(userId, sessionId, {
        goal: value,
      });
      return {
        ok: true,
        message: "目标已更新。",
        session: updated ?? session,
      };
    }
    if (command.name === "plan") {
      if (!value) {
        return {
          ok: true,
          message: session.planMode ? "Plan Mode 已开启。" : "Plan Mode 已关闭。",
        };
      }
      if (value !== "on" && value !== "off") {
        throw new Error("/plan 只支持 on 或 off。");
      }
      const enabled = value === "on";
      await runtime.executeThreadAction({
        type: "settings",
        threadId,
        settings: {
          collaborationMode: {
            mode: enabled ? "plan" : "default",
            settings: {},
          },
        },
      });
      const updated = this.sessionStore.updateThreadState(userId, sessionId, {
        planMode: enabled,
      });
      return {
        ok: true,
        message: enabled ? "Plan Mode 已开启。" : "Plan Mode 已关闭。",
        session: updated ?? session,
      };
    }
    if (command.name === "compact") {
      await runtime.executeThreadAction({ type: "compact", threadId });
      return { ok: true, message: "已开始压缩上下文。" };
    }
    if (command.name === "review") {
      const target =
        command.arguments.target && typeof command.arguments.target === "object"
          ? command.arguments.target as Record<string, unknown>
          : { type: "uncommittedChanges" };
      await runtime.executeThreadAction({ type: "review", threadId, target });
      return { ok: true, message: "已启动代码审查。" };
    }
    if (command.name === "permissions") {
      const user = this.requireEnabledUser(userId);
      const profiles = await runtime.listPermissionProfiles(user.workspacePath);
      if (!value) {
        return { ok: true, message: "可用权限配置", data: profiles };
      }
      const allowed = profiles.some((profile) => {
        const item = profile as { id?: unknown };
        return item.id === value;
      });
      if (!allowed || value === "danger-full-access") {
        throw new Error("该权限配置不可用于 Web Chat。");
      }
      await runtime.executeThreadAction({
        type: "settings",
        threadId,
        settings: { permissions: value },
      });
      const updated = this.sessionStore.updateThreadState(userId, sessionId, {
        permissionProfile: value as "read-only" | "workspace-write",
      });
      return {
        ok: true,
        message: `权限已切换为 ${value}。`,
        session: updated ?? session,
      };
    }
    throw new Error(`不支持命令 /${command.name}。`);
  }

  listAdminMessages(userId: string): FeishuTrackedMessage[] {
    return this.trackers.get(userId)?.list() ?? [];
  }

  listAdminSessions(userId: string): FeishuTrackedSession[] {
    return this.trackers.get(userId)?.listSessions() ?? [];
  }

  listArchivedSessions(
    userId: string,
    sessionId: string
  ): SessionSummary[] {
    const session = this.sessionStore.get(userId, sessionId);
    return session
      ? this.routerFor(userId, session).listArchivedSessions(sessionId)
      : [];
  }

  getArchivedSessionDetail(
    userId: string,
    sessionId: string,
    selection?: number | string
  ): ArchivedSessionDetail | null {
    const session = this.sessionStore.get(userId, sessionId);
    return session
      ? this.routerFor(userId, session).getArchivedSessionDetail(
          sessionId,
          selection
        )
      : null;
  }

  async summarizeArchivedSession(
    userId: string,
    sessionId: string,
    selection?: number | string,
    refresh = false
  ): Promise<SessionSummaryWithAi | null> {
    const session = this.sessionStore.get(userId, sessionId);
    return session
      ? this.routerFor(userId, session).summarizeArchivedSession(
          sessionId,
          selection,
          refresh
        )
      : null;
  }

  stopAll(): void {
    for (const user of this.userStore.list()) this.stopUser(user.id);
    this.traceStore.flush();
  }

  private routerFor(
    userId: string,
    session: WebChatSessionRecord
  ): CodexSessionRouter {
    const key = runKey(userId, session.id);
    const existing = this.routers.get(key);
    if (existing) return existing;
    const user = this.userStore.getById(userId);
    if (!user) throw new Error("用户不存在。");
    const publicUser = this.userStore.toPublic(user);
    const runtime = resolveSessionRuntime(
      session,
      publicUser,
      this.codex
    );
    const router = this.createRouter({
      cwd: publicUser.workspacePath,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      fast: runtime.fast,
      verbosity: runtime.verbosity,
      developerInstructionsProvider: () =>
        "你正在通过 Codex Gateway Web Chat 工作。生成供用户下载的文件时，请将文件保存在当前工作目录，并在最终回复中单独一行输出 [[codex:file:路径]]。",
      historyBaseDir: this.sessionStore.historyPath(userId, session.id),
      runner: this.options.runner ?? this.options.appServerRuntime?.runner,
      command: this.codex.command,
      sandbox: "workspace-write",
      profile: this.codex.profile,
      search: this.codex.search,
      skipGitRepoCheck: this.codex.skipGitRepoCheck,
      dangerouslyBypassApprovalsAndSandbox: false,
      extraArgs: [],
      projectRoot: this.options.projectRoot,
      historyMaxMessages: 10_000,
      historyMaxSessions: 5,
    });
    this.routers.set(key, router);
    return router;
  }

  private handleProgress(
    userId: string,
    sessionId: string,
    messageId: string,
    trace: WebChatTurnTrace,
    event: CodexProgressEvent
  ): void {
    const tracker = this.trackerFor(userId);
    tracker.update(messageId, {
      stage: event.type === "assistant_text" ? "replying" : "model_processing",
    });
    tracker.appendProgressEventForMessage(messageId, event);
    this.traceNormalizer.append(trace, event);
    this.traceStore.save(trace);
    const activity = publicLatestActivity(trace);
    if (activity) {
      this.eventHub.publish(userId, {
        sessionId,
        type: "message.activity",
        payload: { messageId, activity },
      });
    }
    this.publishTrace(userId, sessionId, trace);
    if (event.type === "assistant_text" && event.text) {
      this.eventHub.publish(userId, {
        sessionId,
        type: "message.progress",
        payload: { messageId, text: event.text },
      });
    }
  }

  private trackerFor(userId: string): FeishuMessageProgressTracker {
    const existing = this.trackers.get(userId);
    if (existing) return existing;
    const tracker = new FeishuMessageProgressTracker({ accountId: userId });
    this.trackers.set(userId, tracker);
    return tracker;
  }

  private requireEnabledUser(userId: string): WebChatUserPublic {
    const user = this.userStore.getById(userId);
    if (!user?.enabled) throw new Error("用户不存在或已停用。");
    return this.userStore.toPublic(user);
  }

  private requireCapabilityCatalog(): WebChatCapabilityCatalog {
    if (!this.capabilityCatalog) {
      throw new Error("Web Chat App Server 能力目录不可用。");
    }
    return this.capabilityCatalog;
  }

  private publishTrace(
    userId: string,
    sessionId: string,
    trace: WebChatTurnTrace
  ): void {
    this.eventHub.publish(userId, {
      sessionId,
      type: "message.trace",
      payload: {
        messageId: trace.messageId,
        trace: {
          status: trace.status,
          summary: trace.summary,
          latestActivity: trace.latestActivity,
          steps: trace.steps,
          fileChanges: trace.fileChanges,
          updatedAt: trace.updatedAt,
          completedAt: trace.completedAt,
        },
      },
    });
  }

  private publishRunning(
    userId: string,
    sessionId: string,
    running: boolean
  ): void {
    this.eventHub.publish(userId, {
      sessionId,
      type: "session.running",
      payload: { running },
    });
  }

  private markConversationStopped(userId: string, sessionId: string): void {
    const tracker = this.trackers.get(userId);
    if (!tracker) return;
    for (const message of tracker.list()) {
      if (
        message.conversationKey === sessionId &&
        message.stage !== "completed" &&
        message.stage !== "failed" &&
        message.stage !== "stopped"
      ) {
        tracker.update(message.messageId, { stage: "stopped" });
      }
    }
  }

  private stopUser(userId: string): void {
    for (const session of this.sessionStore.list(userId)) {
      if (session.running || this.routers.has(runKey(userId, session.id))) {
        this.stopSession(userId, session.id);
      }
    }
  }

  private isBlankSession(userId: string, session: WebChatSessionRecord): boolean {
    if (
      session.running
      || session.threadId
      || session.goal
      || session.planMode
      || session.permissionProfile
      || session.forkedFrom
      || this.traceStore.list(userId, session.id).length > 0
    ) {
      return false;
    }
    const router = this.routers.get(runKey(userId, session.id));
    return !router || router.getStatus(session.id).messageCount === 0;
  }

  private clearStaleRunningState(): void {
    for (const user of this.userStore.list()) {
      for (const session of this.sessionStore.list(user.id)) {
        if (session.running) this.sessionStore.setRunning(user.id, session.id, false);
      }
    }
  }
}

function runKey(userId: string, sessionId: string): string {
  return `${userId}\u0000${sessionId}`;
}

function titleFromMessage(text: string): string {
  const title = text.trim().replace(/\s+/g, " ");
  return title.length > 48 ? `${title.slice(0, 45)}...` : title;
}

function buildCodexPrompt(
  workspacePath: string,
  text: string,
  files: WebChatOpenedFile[]
): string {
  const documents = files.filter((file) => !file.file.image);
  if (documents.length === 0) return text;
  const lines = documents.map(
    (file) => `- ${file.file.name}: ${relative(workspacePath, file.path)}`
  );
  return `${text}\n\n以下文件已保存在当前工作目录，可按需读取：\n${lines.join("\n")}`;
}

function resolveModel(
  models: CodexModelOption[],
  model: string | undefined
): CodexModelOption | undefined {
  return model
    ? models.find((item) => item.model === model || item.id === model)
    : models.find((item) => item.isDefault) ?? models[0];
}

function resolveSessionRuntime(
  input: WebChatSessionInput,
  user: WebChatUserPublic,
  codex: CodexConfig
): Pick<
  WebChatSessionInput,
  "model" | "reasoningEffort" | "fast" | "verbosity"
> {
  return {
    model: input.model ?? user.model ?? codex.model,
    reasoningEffort:
      input.reasoningEffort ?? user.reasoningEffort ?? codex.reasoningEffort,
    fast: input.fast ?? user.fast ?? codex.fast,
    verbosity: input.verbosity ?? user.verbosity ?? codex.verbosity,
  };
}

function buildAccountSettings(
  user: WebChatUserPublic,
  codex: CodexConfig,
  models: CodexModelOption[]
): WebChatAccountSettings {
  const runtime = resolveSessionRuntime({}, user, codex);
  const model = resolveModel(models, runtime.model);
  const inheritedModel = resolveModel(models, codex.model);
  return {
    user,
    defaults: {
      model: user.model ?? null,
      reasoningEffort: user.reasoningEffort ?? null,
      fast: user.fast ?? null,
    },
    effective: {
      model: model?.model ?? runtime.model ?? null,
      reasoningEffort:
        runtime.reasoningEffort ?? model?.defaultReasoningEffort ?? null,
      fast: runtime.fast === true,
    },
    inherited: {
      model: inheritedModel?.model ?? codex.model ?? null,
      reasoningEffort:
        codex.reasoningEffort
        ?? inheritedModel?.defaultReasoningEffort
        ?? null,
      fast: codex.fast === true,
    },
  };
}

function validateAccountSettings(
  user: WebChatUserPublic,
  codex: CodexConfig,
  models: CodexModelOption[]
): void {
  const runtime = resolveSessionRuntime({}, user, codex);
  const model = resolveModel(models, runtime.model);
  if (runtime.model && !model) {
    throw new Error(`模型 ${runtime.model} 不在当前模型目录中。`);
  }
  const effort =
    runtime.reasoningEffort ?? model?.defaultReasoningEffort;
  if (
    effort
    && model
    && !model.supportedReasoningEfforts.some(
      (item) => item.reasoningEffort === effort
    )
  ) {
    throw new Error(`模型 ${model.model} 不支持 Effort ${effort}。`);
  }
  if (runtime.fast === true && model && !model.supportsFast) {
    throw new Error(`模型 ${model.model} 不支持 Fast。`);
  }
}

function cloneCodexConfig(codex: CodexConfig): CodexConfig {
  return {
    ...codex,
    extraArgs: [...codex.extraArgs],
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringArgument(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function publicLatestActivity(
  trace: WebChatTurnTrace
): Record<string, unknown> | undefined {
  const entry = trace.entries.at(-1);
  if (!entry) return undefined;
  if (entry.type === "tool_group") {
    const activity = entry.activities.at(-1);
    if (!activity) return undefined;
    return {
      id: activity.id,
      type: activity.kind,
      title: activity.title,
      status: activity.status,
      createdAt: activity.startedAt,
      updatedAt: activity.completedAt ?? entry.updatedAt,
      durationMs: activity.durationMs,
    };
  }
  return {
    id: entry.id,
    type: entry.type === "message" ? entry.kind : entry.type,
    title:
      entry.type === "message"
        ? trace.latestActivity ?? "Codex 正在处理"
        : entry.title,
    status: "completed",
    createdAt: entry.createdAt,
  };
}

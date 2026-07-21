import type { CodexRunner } from "../codex/runner.js";
import { runCodex } from "../codex/runner.js";
import type { CodexProgressEvent } from "../codex/json-events.js";
import type { CodexSandboxMode } from "../config.js";
import type {
  CodexReasoningEffort,
  CodexRuntimeTuning,
  CodexVerbosity,
} from "../codex/runtime-settings.js";
import {
  type SessionAiSummary,
  type SessionMessage,
  type SessionMetadata,
  SessionHistoryStore,
  type SessionSummary,
} from "./history.js";

export interface CodexSessionRouterOptions {
  cwd: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  developerInstructionsProvider?: () => string | undefined;
  historyBaseDir: string;
  runner?: CodexRunner;
  command?: string;
  sandbox?: CodexSandboxMode;
  profile?: string;
  search?: boolean;
  skipGitRepoCheck?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  extraArgs?: string[];
  projectRoot?: string;
  createArchiveId?: () => string;
  historyMaxMessages?: number;
  historyMaxSessions?: number;
  summaryModel?: string;
  summaryMaxMessages?: number;
  summaryConcurrency?: number;
  onOutput?: (conversationKey: string, text: string) => void | Promise<void>;
  onProgress?: (conversationKey: string, event: CodexProgressEvent) => void;
}

interface RoutedSession {
  conversationKey: string;
  metadata: SessionMetadata;
  queue: Promise<void>;
  abortController?: AbortController;
}

export interface ArchivedSessionSwitchResult {
  ok: boolean;
  message: string;
  archiveId?: string;
  sessionId?: string;
  forkedFrom?: string;
}

export interface ArchivedSessionDetail {
  session: SessionSummary;
  messages: SessionMessage[];
}

export interface SessionSummaryWithAi extends SessionSummary {
  aiSummary?: SessionAiSummary;
  summaryError?: string;
}

export interface CodexSessionStatus {
  running: boolean;
  sessionId?: string;
  archiveId?: string;
  cwd: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  messageCount: number;
}

export type CodexSessionOutputHandler = (text: string) => void | Promise<void>;
export type CodexSessionProgressHandler = (event: CodexProgressEvent) => void;

const DEFAULT_HISTORY_LIMIT = 50;
const DEFAULT_SUMMARY_LIMIT = 50;
const DEFAULT_SUMMARY_CONCURRENCY = 5;
const SESSION_SUMMARY_PROMPT_VERSION = 2;

export class CodexSessionRouter {
  private readonly historyStore: SessionHistoryStore;
  private readonly runner: CodexRunner;
  private readonly sessions = new Map<string, RoutedSession>();

  constructor(private readonly options: CodexSessionRouterOptions) {
    this.historyStore = new SessionHistoryStore(
      options.historyBaseDir,
      options.createArchiveId,
      positiveInteger(options.historyMaxSessions, 100)
    );
    this.runner = options.runner ?? runCodex;
  }

  async send(
    conversationKey: string,
    prompt: string,
    imagePaths: string[] = [],
    onOutput?: CodexSessionOutputHandler,
    onProgress?: CodexSessionProgressHandler
  ): Promise<void> {
    const routed = this.getOrCreateRoutedSession(conversationKey);
    routed.queue = routed.queue
      .catch(() => undefined)
      .then(() => this.runQueuedMessage(routed, prompt, imagePaths, onOutput, onProgress));
    return routed.queue;
  }

  resetSession(conversationKey: string): void {
    const existing = this.sessions.get(conversationKey);
    existing?.abortController?.abort();
    const metadata = this.historyStore.createNewSession(conversationKey, {
      cwd: this.options.cwd,
      model: this.options.model,
      ...this.currentTuning(),
    });
    this.sessions.set(conversationKey, this.createRoutedSession(metadata));
  }

  stopSession(conversationKey: string): boolean {
    const existing = this.sessions.get(conversationKey);
    if (!existing) return false;
    existing.abortController?.abort();
    this.sessions.delete(conversationKey);
    return true;
  }

  stopAll(): void {
    for (const key of this.sessions.keys()) {
      this.stopSession(key);
    }
  }

  updateDefaultModel(model?: string): void {
    this.updateDefaults({ model });
  }

  updateDefaults(
    defaults: CodexRuntimeTuning & { model?: string }
  ): void {
    if (Object.prototype.hasOwnProperty.call(defaults, "model")) {
      this.options.model = defaults.model;
    }
    if (Object.prototype.hasOwnProperty.call(defaults, "reasoningEffort")) {
      this.options.reasoningEffort = defaults.reasoningEffort;
    }
    if (Object.prototype.hasOwnProperty.call(defaults, "fast")) {
      this.options.fast = defaults.fast;
    }
    if (Object.prototype.hasOwnProperty.call(defaults, "verbosity")) {
      this.options.verbosity = defaults.verbosity;
    }
  }

  getStatus(conversationKey: string): CodexSessionStatus {
    const current = this.getCurrentArchivedSession(conversationKey);
    return {
      running: this.isProcessing(conversationKey),
      sessionId: current?.sessionId,
      archiveId: current?.archiveId,
      cwd: current?.cwd ?? this.options.cwd,
      model: current ? this.sessionModel(current) : this.options.model,
      reasoningEffort: current
        ? this.sessionTuning(current).reasoningEffort
        : this.options.reasoningEffort,
      fast: current ? this.sessionTuning(current).fast : this.options.fast,
      verbosity: current ? this.sessionTuning(current).verbosity : this.options.verbosity,
      messageCount: current?.messageCount ?? 0,
    };
  }

  listArchivedSessions(conversationKey: string): SessionSummary[] {
    return this.historyStore.listSessions(conversationKey);
  }

  getCurrentArchivedSession(conversationKey: string): SessionSummary | null {
    return this.listArchivedSessions(conversationKey).find((session) => session.current) ?? null;
  }

  getArchivedSessionDetail(
    conversationKey: string,
    selection?: number | string
  ): ArchivedSessionDetail | null {
    const session =
      selection === undefined
        ? this.getCurrentArchivedSession(conversationKey)
        : this.selectArchivedSession(conversationKey, selection);
    if (!session) return null;
    return {
      session,
      messages: this.historyStore.readRecentMessages(
        session,
        positiveInteger(this.options.historyMaxMessages, DEFAULT_HISTORY_LIMIT)
      ),
    };
  }

  resumeArchivedSession(
    conversationKey: string,
    selection: number | string
  ): ArchivedSessionSwitchResult {
    if (this.isProcessing(conversationKey)) {
      return { ok: false, message: "当前会话仍在处理中，请等待完成或先发送 /stop。" };
    }
    const selected = this.selectArchivedSession(conversationKey, selection);
    if (!selected) return { ok: false, message: "没有找到对应的历史 session。" };
    if (!selected.nativeSessionStarted || !selected.sessionId) {
      return { ok: false, message: "这个 session 还没有建立 Codex 原生会话，不能直接恢复。" };
    }

    const resumed = this.historyStore.resumeSession(conversationKey, selected.archiveId);
    if (!resumed) return { ok: false, message: "恢复失败，历史 session 元信息不存在。" };
    this.sessions.set(conversationKey, this.createRoutedSession(resumed));
    return {
      ok: true,
      message: "已恢复历史 session。",
      archiveId: resumed.archiveId,
      sessionId: resumed.sessionId,
    };
  }

  forkArchivedSession(
    conversationKey: string,
    selection: number | string
  ): ArchivedSessionSwitchResult {
    if (this.isProcessing(conversationKey)) {
      return { ok: false, message: "当前会话仍在处理中，请等待完成或先发送 /stop。" };
    }
    const selected = this.selectArchivedSession(conversationKey, selection);
    if (!selected) return { ok: false, message: "没有找到对应的历史 session。" };

    const fork = this.historyStore.forkSession(conversationKey, selected.archiveId, {
      cwd: this.options.cwd,
      model: this.options.model,
      ...this.currentTuning(),
    });
    if (!fork) return { ok: false, message: "fork 失败，历史 session 元信息不存在。" };
    this.sessions.set(conversationKey, this.createRoutedSession(fork));
    return {
      ok: true,
      message: "已 fork 历史 session。",
      archiveId: fork.archiveId,
      sessionId: fork.sessionId,
      forkedFrom: fork.forkedFrom,
    };
  }

  async summarizeArchivedSessions(
    conversationKey: string,
    count: number | "all"
  ): Promise<SessionSummaryWithAi[]> {
    const sessions = limitSessions(this.listArchivedSessions(conversationKey), count).filter(
      (session) => session.messageCount > 0
    );
    return mapWithConcurrency(
      sessions,
      positiveInteger(this.options.summaryConcurrency, DEFAULT_SUMMARY_CONCURRENCY),
      async (session) => {
        try {
          return {
            ...session,
            aiSummary: await this.generateArchivedSessionSummary(session),
          };
        } catch (error) {
          return {
            ...session,
            summaryError: errorMessage(error),
          };
        }
      }
    );
  }

  async summarizeArchivedSession(
    conversationKey: string,
    selection?: number | string,
    refresh = false
  ): Promise<SessionSummaryWithAi | null> {
    const session =
      selection === undefined
        ? this.getCurrentArchivedSession(conversationKey)
        : this.selectArchivedSession(conversationKey, selection);
    if (!session) return null;
    if (session.messageCount === 0) {
      return { ...session, summaryError: "这个 session 还没有可总结的消息。" };
    }
    try {
      return {
        ...session,
        aiSummary: await this.generateArchivedSessionSummary(session, refresh),
      };
    } catch (error) {
      return {
        ...session,
        summaryError: errorMessage(error),
      };
    }
  }

  private createRoutedSession(metadata: SessionMetadata): RoutedSession {
    return {
      conversationKey: metadata.conversationKey,
      metadata,
      queue: Promise.resolve(),
    };
  }

  private getOrCreateRoutedSession(conversationKey: string): RoutedSession {
    const existing = this.sessions.get(conversationKey);
    if (existing) return existing;
    const metadata = this.historyStore.readOrCreate(conversationKey, {
      cwd: this.options.cwd,
      model: this.options.model,
      ...this.currentTuning(),
    });
    const routed = this.createRoutedSession(metadata);
    this.sessions.set(conversationKey, routed);
    return routed;
  }

  private async runQueuedMessage(
    routed: RoutedSession,
    prompt: string,
    imagePaths: string[],
    onOutput?: CodexSessionOutputHandler,
    onProgress?: CodexSessionProgressHandler
  ): Promise<void> {
    if (this.sessions.get(routed.conversationKey) !== routed) return;
    const abortController = new AbortController();
    routed.abortController = abortController;

    const metadata = routed.metadata;
    const resume = Boolean(metadata.nativeSessionStarted && metadata.sessionId);
    const previousMessages = resume
      ? []
      : this.historyStore.readRecentMessages(
          metadata,
          positiveInteger(this.options.historyMaxMessages, DEFAULT_HISTORY_LIMIT)
        );
    const runPrompt = resume ? prompt : buildPromptWithFallbackHistory(previousMessages, prompt);
    this.historyStore.appendMessage(metadata, { role: "user", text: prompt });

    try {
      const result = await this.runner(
        this.buildRunnerInput(
          runPrompt,
          metadata,
          resume,
          imagePaths,
          abortController.signal,
          (event) => {
            onProgress?.(event);
            this.options.onProgress?.(routed.conversationKey, event);
          }
        )
      );

      if (this.sessions.get(routed.conversationKey) !== routed) return;
      metadata.sessionId = result.sessionId || metadata.sessionId;
      metadata.nativeSessionStarted = Boolean(metadata.sessionId);
      metadata.lastActiveAt = new Date().toISOString();
      this.historyStore.write(metadata);
      if (result.text) {
        this.historyStore.appendMessage(metadata, { role: "assistant", text: result.text });
        if (onOutput) {
          await onOutput(result.text);
        } else {
          await this.options.onOutput?.(routed.conversationKey, result.text);
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      throw error;
    } finally {
      if (this.sessions.get(routed.conversationKey) === routed) {
        routed.abortController = undefined;
      }
    }
  }

  private buildRunnerInput(
    prompt: string,
    metadata: SessionMetadata,
    resume: boolean,
    imagePaths: string[],
    signal?: AbortSignal,
    onProgress?: CodexSessionProgressHandler,
    model = this.sessionModel(metadata),
    tuningSource: "session" | "current" = "session"
  ) {
    const tuning = tuningSource === "current" ? this.currentTuning() : this.sessionTuning(metadata);
    return {
      cwd: this.options.cwd,
      prompt,
      model,
      reasoningEffort: tuning.reasoningEffort,
      fast: tuning.fast,
      verbosity: tuning.verbosity,
      developerInstructions: this.options.developerInstructionsProvider?.(),
      sessionId: resume ? metadata.sessionId : undefined,
      resume,
      imagePaths,
      command: this.options.command,
      sandbox: this.options.sandbox,
      profile: this.options.profile,
      search: this.options.search,
      skipGitRepoCheck: this.options.skipGitRepoCheck,
      dangerouslyBypassApprovalsAndSandbox: this.options.dangerouslyBypassApprovalsAndSandbox,
      extraArgs: this.options.extraArgs,
      signal,
      projectRoot: this.options.projectRoot,
      onProgress,
    };
  }

  private isProcessing(conversationKey: string): boolean {
    return Boolean(this.sessions.get(conversationKey)?.abortController);
  }

  private currentTuning(): CodexRuntimeTuning {
    return {
      reasoningEffort: this.options.reasoningEffort,
      fast: this.options.fast,
      verbosity: this.options.verbosity,
    };
  }

  private sessionModel(metadata: SessionMetadata): string | undefined {
    return metadata.runtimeSettingsCaptured === true
      ? metadata.model
      : metadata.model ?? this.options.model;
  }

  private sessionTuning(metadata: SessionMetadata): CodexRuntimeTuning {
    if (metadata.runtimeSettingsCaptured === true) {
      return {
        reasoningEffort: metadata.reasoningEffort,
        fast: metadata.fast,
        verbosity: metadata.verbosity,
      };
    }
    return {
      reasoningEffort: metadata.reasoningEffort ?? this.options.reasoningEffort,
      fast: metadata.fast ?? this.options.fast,
      verbosity: metadata.verbosity ?? this.options.verbosity,
    };
  }

  private selectArchivedSession(
    conversationKey: string,
    selection: number | string
  ): SessionSummary | null {
    const sessions = this.listArchivedSessions(conversationKey);
    if (typeof selection === "number") return sessions[selection - 1] ?? null;
    return sessions.find((session) => session.archiveId === selection) ?? null;
  }

  private async generateArchivedSessionSummary(
    session: SessionSummary,
    refresh = false
  ): Promise<SessionAiSummary> {
    const model = this.options.summaryModel ?? this.options.model;
    const cacheContext = {
      model,
      promptVersion: SESSION_SUMMARY_PROMPT_VERSION,
    };
    const cached = refresh ? null : this.historyStore.readSessionSummary(session, cacheContext);
    if (cached) return cached;

    const messages = this.historyStore.readRecentMessages(
      session,
      positiveInteger(this.options.summaryMaxMessages, DEFAULT_SUMMARY_LIMIT)
    );
    const result = await this.runner(
      this.buildRunnerInput(
        buildSessionSummaryPrompt(session, messages),
        session,
        false,
        [],
        undefined,
        undefined,
        model,
        "current"
      )
    );
    return this.historyStore.writeSessionSummary(
      session,
      parseSessionSummaryText(result.text),
      cacheContext
    );
  }
}

function buildPromptWithFallbackHistory(messages: SessionMessage[], prompt: string): string {
  if (messages.length === 0) return prompt;
  const history = messages
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.text}`)
    .join("\n");
  return `以下是当前飞书会话的最近历史，供你延续上下文。\n\n${history}\n\n当前用户消息：\n${prompt}`;
}

function buildSessionSummaryPrompt(session: SessionSummary, messages: SessionMessage[]): string {
  const history = messages.map((message) => `${message.role}: ${message.text}`).join("\n\n");
  return [
    "总结以下飞书历史 session。",
    "只输出 JSON，不要输出 markdown，也不要输出解释文字。",
    'JSON 字段必须是：{"topic":"...","keyInfo":"...","recentAction":"..."}',
    `Archive：${session.archiveId}`,
    `消息数：${session.messageCount}`,
    "历史：",
    history,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseSessionSummaryText(text: string): {
  topic: string;
  keyInfo: string;
  recentAction: string;
} {
  const trimmed = text.trim();
  const jsonText = extractJsonObjectText(trimmed);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      return {
        topic: summaryField(parsed.topic, "未命名 session"),
        keyInfo: summaryField(parsed.keyInfo, "无"),
        recentAction: summaryField(parsed.recentAction, "无"),
      };
    } catch {
      // JSON 解析失败时使用纯文本兜底。
    }
  }
  return {
    topic: firstNonEmptyLine(trimmed) || "未命名 session",
    keyInfo: trimmed || "无",
    recentAction: "无",
  };
}

function extractJsonObjectText(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

function summaryField(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function limitSessions<T>(sessions: T[], count: number | "all"): T[] {
  return count === "all" ? sessions : sessions.slice(0, Math.max(0, count));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    })
  );
  return results;
}

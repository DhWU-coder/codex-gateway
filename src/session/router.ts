import type { CodexRunner } from "../codex/runner.js";
import { runCodex } from "../codex/runner.js";
import type { CodexSandboxMode } from "../config.js";
import { SessionHistoryStore } from "./history.js";

export interface CodexSessionRouterOptions {
  cwd: string;
  model?: string;
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
  onOutput?: (conversationKey: string, text: string) => void | Promise<void>;
}

interface RoutedSession {
  queue: Promise<void>;
  abortController?: AbortController;
}

export class CodexSessionRouter {
  private readonly historyStore: SessionHistoryStore;
  private readonly runner: CodexRunner;
  private readonly sessions = new Map<string, RoutedSession>();

  constructor(private readonly options: CodexSessionRouterOptions) {
    this.historyStore = new SessionHistoryStore(options.historyBaseDir);
    this.runner = options.runner ?? runCodex;
  }

  async send(conversationKey: string, prompt: string, imagePaths: string[] = []): Promise<void> {
    const routed = this.getOrCreateRoutedSession(conversationKey);
    routed.queue = routed.queue
      .catch(() => undefined)
      .then(() => this.runQueuedMessage(conversationKey, prompt, imagePaths, routed));
    return routed.queue;
  }

  resetSession(conversationKey: string): void {
    const existing = this.sessions.get(conversationKey);
    existing?.abortController?.abort();
    this.historyStore.reset(conversationKey, {
      cwd: this.options.cwd,
      model: this.options.model,
    });
    this.sessions.set(conversationKey, { queue: Promise.resolve() });
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

  getStatus(conversationKey: string): { running: boolean; sessionId?: string } {
    const metadata = this.historyStore.read(conversationKey);
    return {
      running: Boolean(this.sessions.get(conversationKey)?.abortController),
      sessionId: metadata?.sessionId,
    };
  }

  private getOrCreateRoutedSession(conversationKey: string): RoutedSession {
    const existing = this.sessions.get(conversationKey);
    if (existing) return existing;
    const routed = { queue: Promise.resolve() };
    this.sessions.set(conversationKey, routed);
    return routed;
  }

  private async runQueuedMessage(
    conversationKey: string,
    prompt: string,
    imagePaths: string[],
    routed: RoutedSession
  ): Promise<void> {
    const abortController = new AbortController();
    routed.abortController = abortController;

    const metadata = this.historyStore.readOrCreate(conversationKey, {
      cwd: this.options.cwd,
      model: this.options.model,
    });
    const resume = Boolean(metadata.sessionId);
    const previousMessages = resume
      ? []
      : this.historyStore.readRecentMessages(conversationKey, 20);
    const runPrompt = resume ? prompt : buildPromptWithFallbackHistory(previousMessages, prompt);
    this.historyStore.appendMessage(conversationKey, { role: "user", text: prompt });

    try {
      const result = await this.runner({
        cwd: this.options.cwd,
        prompt: runPrompt,
        model: this.options.model,
        sessionId: metadata.sessionId,
        resume,
        imagePaths,
        command: this.options.command,
        sandbox: this.options.sandbox,
        profile: this.options.profile,
        search: this.options.search,
        skipGitRepoCheck: this.options.skipGitRepoCheck,
        dangerouslyBypassApprovalsAndSandbox: this.options.dangerouslyBypassApprovalsAndSandbox,
        extraArgs: this.options.extraArgs,
        signal: abortController.signal,
        projectRoot: this.options.projectRoot,
      });

      if (this.sessions.get(conversationKey) !== routed) return;
      metadata.sessionId = result.sessionId || metadata.sessionId;
      metadata.lastActiveAt = new Date().toISOString();
      metadata.messageCount += 2;
      this.historyStore.write(metadata);
      if (result.text) {
        this.historyStore.appendMessage(conversationKey, { role: "assistant", text: result.text });
        await this.options.onOutput?.(conversationKey, result.text);
      }
    } finally {
      if (this.sessions.get(conversationKey) === routed) {
        routed.abortController = undefined;
      }
    }
  }
}

function buildPromptWithFallbackHistory(
  messages: Array<{ role: "user" | "assistant"; text: string }>,
  prompt: string
): string {
  if (messages.length === 0) return prompt;
  const history = messages
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.text}`)
    .join("\n");
  return `以下是当前飞书会话的最近历史，供你延续上下文。\n\n${history}\n\n当前用户消息：\n${prompt}`;
}

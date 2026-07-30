import type {
  AppServerNotification,
} from "./app-server-types.js";
import type { CodexProgressEvent } from "./json-events.js";
import type {
  CodexRunInput,
  CodexRunResult,
  CodexRunner,
  CodexStructuredInput,
} from "./runner.js";
import { CodexSessionResumeError } from "./runner.js";

export interface CodexAppServerClientLike {
  readonly ready: boolean;
  start(): Promise<void>;
  request<T>(method: string, params?: unknown): Promise<T>;
  subscribe(listener: (notification: AppServerNotification) => void): () => void;
  stop?(): Promise<void>;
}

export type CodexThreadActionInput =
  | { type: "goal-get"; threadId: string }
  | { type: "goal-set"; threadId: string; objective: string }
  | { type: "goal-clear"; threadId: string }
  | { type: "compact"; threadId: string }
  | {
      type: "settings";
      threadId: string;
      settings: Record<string, unknown>;
    }
  | {
      type: "review";
      threadId: string;
      target: Record<string, unknown>;
    };

interface ThreadResponse {
  thread?: { id?: string };
}

interface TurnStartResponse {
  turn?: { id?: string };
}

interface TurnCompletion {
  status: string;
  error?: string;
}

export class CodexAppServerRuntime {
  readonly runner: CodexRunner;

  constructor(private readonly client: CodexAppServerClientLike) {
    this.runner = (input) => this.run(input);
  }

  get ready(): boolean {
    return this.client.ready;
  }

  async stop(): Promise<void> {
    await this.client.stop?.();
  }

  async listModels(): Promise<unknown[]> {
    await this.client.start();
    const response = await this.client.request<{ data?: unknown[] }>("model/list", {
      limit: 100,
      includeHidden: false,
    });
    return Array.isArray(response.data) ? response.data : [];
  }

  async listSkills(cwd: string): Promise<unknown[]> {
    await this.client.start();
    const response = await this.client.request<{ data?: unknown[] }>("skills/list", {
      cwds: [cwd],
      forceReload: false,
    });
    return Array.isArray(response.data) ? response.data : [];
  }

  async listInstalledPlugins(cwd: string): Promise<unknown[]> {
    await this.client.start();
    const response = await this.client.request<{ marketplaces?: unknown[] }>(
      "plugin/installed",
      {
        cwds: [cwd],
        installSuggestionPluginNames: [],
      }
    );
    const plugins: unknown[] = [];
    for (const marketplace of response.marketplaces ?? []) {
      const record = asRecord(marketplace);
      if (!Array.isArray(record?.plugins)) continue;
      for (const plugin of record.plugins) {
        const item = asRecord(plugin);
        if (item?.installed === true && item.enabled === true) plugins.push(plugin);
      }
    }
    return plugins;
  }

  async listInstalledApps(threadId?: string): Promise<unknown[]> {
    await this.client.start();
    let response: { apps?: unknown[] };
    try {
      response = await this.requestInstalledApps(threadId);
    } catch (error) {
      if (!threadId || !isThreadNotFound(error)) throw error;
      response = await this.requestInstalledApps();
    }
    return Array.isArray(response.apps) ? response.apps : [];
  }

  private requestInstalledApps(threadId?: string): Promise<{ apps?: unknown[] }> {
    return this.client.request("app/installed", {
      threadId: threadId ?? null,
      forceRefresh: false,
    });
  }

  async searchFiles(cwd: string, query: string): Promise<unknown[]> {
    await this.client.start();
    const response = await this.client.request<{ files?: unknown[] }>(
      "fuzzyFileSearch",
      {
        query,
        roots: [cwd],
        cancellationToken: null,
      }
    );
    return Array.isArray(response.files) ? response.files : [];
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.client.request("thread/name/set", { threadId, name });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.client.request("thread/delete", { threadId });
  }

  async forkThread(threadId: string, cwd?: string): Promise<string> {
    const response = await this.client.request<ThreadResponse>("thread/fork", {
      threadId,
      ...(cwd ? { cwd } : {}),
      approvalPolicy: "never",
      permissions: "workspace-write",
      excludeTurns: false,
      deferGoalContinuation: true,
    });
    const forkedId = readString(response.thread?.id);
    if (!forkedId) throw new Error("App Server 没有返回分支 Thread ID。");
    return forkedId;
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.client.request("turn/interrupt", { threadId, turnId });
  }

  async listPermissionProfiles(cwd: string): Promise<unknown[]> {
    const response = await this.client.request<{ data?: unknown[] }>(
      "permissionProfile/list",
      { cwd, limit: 100 }
    );
    return (response.data ?? []).filter((profile) => {
      const item = asRecord(profile);
      const id = readString(item?.id);
      return item?.allowed === true && id !== "danger-full-access";
    });
  }

  async listCollaborationModes(): Promise<unknown[]> {
    const response = await this.client.request<{ data?: unknown[] }>(
      "collaborationMode/list",
      {}
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  async executeThreadAction(input: CodexThreadActionInput): Promise<unknown> {
    if (input.type === "goal-get") {
      return this.client.request("thread/goal/get", { threadId: input.threadId });
    }
    if (input.type === "goal-set") {
      return this.client.request("thread/goal/set", {
        threadId: input.threadId,
        objective: input.objective,
      });
    }
    if (input.type === "goal-clear") {
      return this.client.request("thread/goal/clear", { threadId: input.threadId });
    }
    if (input.type === "compact") {
      return this.client.request("thread/compact/start", { threadId: input.threadId });
    }
    if (input.type === "review") {
      return this.client.request("review/start", {
        threadId: input.threadId,
        target: input.target,
        delivery: "inline",
      });
    }
    return this.client.request("thread/settings/update", {
      threadId: input.threadId,
      ...input.settings,
    });
  }

  async run(input: CodexRunInput): Promise<CodexRunResult> {
    await this.client.start();
    const thread = await this.openThread(input);
    const threadId = readString(thread.thread?.id) || input.sessionId;
    if (!threadId) throw new Error("App Server 没有返回 Thread ID。");

    let turnId = "";
    let finalText = "";
    let unknownFinalText = "";
    let completeTurn!: (completion: TurnCompletion) => void;
    let failTurn!: (error: Error) => void;
    const completion = new Promise<TurnCompletion>((resolve, reject) => {
      completeTurn = resolve;
      failTurn = reject;
    });
    const queued: AppServerNotification[] = [];
    let turnStarted = false;
    const unsubscribe = this.client.subscribe((notification) => {
      const params = asRecord(notification.params);
      if (readString(params?.threadId) !== threadId) return;
      if (!turnStarted) {
        queued.push(notification);
        return;
      }
      this.consumeNotification(
        notification,
        turnId,
        input.onProgress,
        (text, phase) => {
          if (phase === "final_answer") finalText = text;
          else if (!phase) unknownFinalText = text;
        },
        completeTurn
      );
    });

    let abortListener: (() => void) | undefined;
    try {
      const started = await this.client.request<TurnStartResponse>("turn/start", {
        threadId,
        input: buildUserInput(input),
        ...(input.additionalContext ? { additionalContext: input.additionalContext } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
        serviceTier: input.fast === true ? "fast" : null,
      });
      turnId = readString(started.turn?.id);
      if (!turnId) throw new Error("App Server 没有返回 Turn ID。");
      turnStarted = true;
      for (const notification of queued.splice(0)) {
        this.consumeNotification(
          notification,
          turnId,
          input.onProgress,
          (text, phase) => {
            if (phase === "final_answer") finalText = text;
            else if (!phase) unknownFinalText = text;
          },
          completeTurn
        );
      }

      abortListener = () => {
        void this.client
          .request("turn/interrupt", { threadId, turnId })
          .catch((error) => failTurn(toError(error)));
      };
      if (input.signal?.aborted) abortListener();
      else input.signal?.addEventListener("abort", abortListener, { once: true });

      const completed = await completion;
      if (completed.status === "interrupted" || input.signal?.aborted) {
        throw new Error("Codex 执行已停止。");
      }
      if (completed.status === "failed") {
        throw new Error(completed.error || "Codex App Server 执行失败。");
      }
      return {
        text: (finalText || unknownFinalText).trim(),
        sessionId: threadId,
        turnId,
      };
    } finally {
      if (abortListener) input.signal?.removeEventListener("abort", abortListener);
      unsubscribe();
    }
  }

  private async openThread(input: CodexRunInput): Promise<ThreadResponse> {
    const common = {
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      serviceTier: input.fast === true ? "fast" : null,
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      approvalPolicy: "never",
      ...(input.developerInstructions?.trim()
        ? { developerInstructions: input.developerInstructions }
        : {}),
    };
    if (input.resume !== false && input.sessionId) {
      try {
        return await this.client.request<ThreadResponse>("thread/resume", {
          threadId: input.sessionId,
          ...common,
        });
      } catch (error) {
        throw new CodexSessionResumeError(
          `无法恢复 Codex Thread ${input.sessionId}。`,
          { cause: error }
        );
      }
    }
    return this.client.request<ThreadResponse>("thread/start", common);
  }

  private consumeNotification(
    notification: AppServerNotification,
    turnId: string,
    onProgress: ((event: CodexProgressEvent) => void) | undefined,
    onAgentText: (text: string, phase?: "commentary" | "final_answer") => void,
    onComplete: (completion: TurnCompletion) => void
  ): void {
    const params = asRecord(notification.params);
    if (!params) return;
    const notificationTurnId =
      readString(params.turnId) || readString(asRecord(params.turn)?.id);
    if (notificationTurnId && notificationTurnId !== turnId) return;

    if (notification.method === "turn/completed") {
      const turn = asRecord(params.turn);
      const error = asRecord(turn?.error);
      onComplete({
        status: readString(turn?.status) || "completed",
        error: readString(error?.message) || readString(error?.additionalDetails),
      });
      return;
    }
    if (notification.method === "turn/plan/updated") {
      const explanation = readString(params.explanation);
      const plan = Array.isArray(params.plan) ? params.plan : [];
      onProgress?.({
        type: "plan",
        text: explanation || summarizePlan(plan),
        steps: plan,
      });
      return;
    }
    if (
      notification.method !== "item/started" &&
      notification.method !== "item/completed"
    ) {
      return;
    }

    const item = asRecord(params.item);
    if (!item) return;
    const event = mapItemEvent(
      notification.method === "item/started" ? "started" : "completed",
      item
    );
    if (event.agentText) {
      onAgentText(event.agentText.text, event.agentText.phase);
      if (event.agentText.phase === "commentary") {
        onProgress?.({
          type: "assistant_text",
          text: event.agentText.text,
          phase: "commentary",
        });
      }
    }
    for (const progressEvent of event.progress) onProgress?.(progressEvent);
  }
}

function buildUserInput(input: CodexRunInput): unknown[] {
  const structured =
    input.structuredInput && input.structuredInput.length > 0
      ? input.structuredInput
      : [{ type: "text", text: input.prompt } satisfies CodexStructuredInput];
  const values = structured.map((item) => {
    if (item.type === "text") {
      return { type: "text", text: item.text, text_elements: [] };
    }
    return { ...item };
  });
  const existingImages = new Set(
    structured
      .filter((item): item is Extract<CodexStructuredInput, { type: "localImage" }> =>
        item.type === "localImage"
      )
      .map((item) => item.path)
  );
  for (const path of input.imagePaths ?? []) {
    if (!existingImages.has(path)) values.push({ type: "localImage", path });
  }
  return values;
}

function mapItemEvent(
  lifecycle: "started" | "completed",
  item: Record<string, unknown>
): {
  agentText?: {
    text: string;
    phase?: "commentary" | "final_answer";
  };
  progress: CodexProgressEvent[];
} {
  const type = readString(item.type);
  const id = readString(item.id) || undefined;
  if (type === "userMessage" || type === "user_message") {
    return { progress: [] };
  }
  if (type === "agentMessage" || type === "agent_message") {
    if (lifecycle !== "completed") return { progress: [] };
    const text = readString(item.text);
    const rawPhase = readString(item.phase);
    const phase =
      rawPhase === "commentary" || rawPhase === "final_answer"
        ? rawPhase
        : undefined;
    return text ? { agentText: { text, ...(phase ? { phase } : {}) }, progress: [] } : { progress: [] };
  }
  if (type === "reasoning") {
    if (lifecycle !== "completed") return { progress: [] };
    const summary = Array.isArray(item.summary)
      ? item.summary.filter((value): value is string => typeof value === "string").join("\n")
      : readString(item.summary);
    return summary
      ? { progress: [{ type: "reasoning", text: summary }] }
      : { progress: [] };
  }
  if (type === "plan") {
    if (lifecycle !== "completed") return { progress: [] };
    const text = readString(item.text);
    return text ? { progress: [{ type: "plan", text }] } : { progress: [] };
  }
  if (type === "fileChange") {
    if (lifecycle !== "completed") return { progress: [] };
    return {
      progress: [
        {
          type: "file_change",
          changes: Array.isArray(item.changes) ? item.changes : [],
          ...(id ? { toolUseId: id } : {}),
        },
      ],
    };
  }
  if (type === "webSearch") {
    if (lifecycle !== "completed") return { progress: [] };
    return {
      progress: [
        {
          type: "web_search",
          ...(readString(item.query) ? { query: readString(item.query) } : {}),
          ...(id ? { toolUseId: id } : {}),
        },
      ],
    };
  }
  if (type === "contextCompaction") {
    return lifecycle === "completed"
      ? { progress: [{ type: "context_compaction" }] }
      : { progress: [] };
  }

  if (lifecycle === "started") {
    return {
      progress: [
        {
          type: "tool_start",
          name: type || "tool",
          input: readToolInput(item),
          ...(id ? { toolUseId: id } : {}),
        },
      ],
    };
  }
  return {
    progress: [
      {
        type: "tool_result",
        name: type || "tool",
        text: readToolOutput(item),
        ...(readString(item.status) === "failed" ? { isError: true } : {}),
        ...(id ? { toolUseId: id } : {}),
        ...(readNumber(item.durationMs) === undefined
          ? {}
          : { durationMs: readNumber(item.durationMs) }),
      },
    ],
  };
}

function readToolInput(item: Record<string, unknown>): unknown {
  const type = readString(item.type);
  if (type === "commandExecution") {
    return {
      command: readString(item.command),
      cwd: readString(item.cwd),
    };
  }
  if (item.arguments !== undefined) return item.arguments;
  if (item.input !== undefined) return item.input;
  return {};
}

function readToolOutput(item: Record<string, unknown>): string {
  const direct =
    readString(item.aggregatedOutput) ||
    readString(item.output) ||
    readString(item.result) ||
    readString(asRecord(item.error)?.message);
  if (direct) return direct;
  try {
    return item.result === undefined ? readString(item.status) : JSON.stringify(item.result);
  } catch {
    return String(item.result ?? "");
  }
}

function summarizePlan(plan: unknown[]): string {
  return plan
    .map((step) => readString(asRecord(step)?.step))
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isThreadNotFound(error: unknown): boolean {
  return /\bthread\b.*\bnot found\b/i.test(toError(error).message);
}

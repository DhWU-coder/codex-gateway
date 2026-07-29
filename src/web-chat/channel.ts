import type {
  ManagedChannel,
  ManagedChannelStatus,
} from "../channel-manager.js";
import type { CodexModelOption } from "../codex/model-catalog.js";
import type { FeishuConnectionTestResult } from "../feishu/send.js";
import type { SessionSummary } from "../session/history.js";
import type {
  ArchivedSessionDetail,
  SessionSummaryWithAi,
} from "../session/router.js";
import { WebChatManager } from "./manager.js";

export interface WebChatChannelOptions {
  manager: WebChatManager;
  modelCatalogProvider: () => Promise<CodexModelOption[]>;
  now?: () => number;
}

export class WebChatChannel implements ManagedChannel {
  readonly id = "web-chat";
  private status: "connected" | "stopped" = "stopped";
  private readonly now: () => number;

  constructor(private readonly options: WebChatChannelOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async start(): Promise<void> {
    this.status = "connected";
  }

  async stop(): Promise<void> {
    this.options.manager.stopAll();
    this.status = "stopped";
  }

  getStatus(): ManagedChannelStatus {
    const users = this.options.manager.listUsers();
    const accounts = users.map((user) => {
      const sessions = this.options.manager.listSessions(user.id);
      const recentMessages = this.options.manager.listAdminMessages(user.id);
      const recentSessions = this.options.manager
        .listAdminSessions(user.id)
        .map((session) => mapTrackedSession(user.id, session));
      return {
        id: user.id,
        accountId: user.id,
        username: user.username,
        enabled: user.enabled,
        model: user.model,
        reasoningEffort: user.reasoningEffort,
        fast: user.fast,
        verbosity: user.verbosity,
        cwd: user.workspacePath,
        sessionsPath: user.sessionsPath,
        sessionCount: sessions.length,
        activeSessions: sessions.filter((session) => session.running).length,
        lastActiveAt: sessions[0]?.updatedAt ?? user.lastLoginAt,
        recentMessages,
        recentSessions,
      };
    });
    const sessions = accounts.flatMap((account) =>
      this.options.manager.listSessions(account.id)
    );
    return {
      id: this.id,
      name: "Web Chat",
      status: this.status,
      appServerReady: this.options.manager.appServerReady,
      configuredUsers: users.length,
      enabledUsers: users.filter((user) => user.enabled).length,
      sessionCount: sessions.length,
      activeSessions: sessions.filter((session) => session.running).length,
      accounts,
      recentMessages: accounts.flatMap((account) => account.recentMessages),
      recentSessions: accounts.flatMap((account) => account.recentSessions),
    };
  }

  async testConnection(): Promise<FeishuConnectionTestResult> {
    const startedAt = this.now();
    try {
      const catalogs = await this.options.manager.checkAppServer();
      return {
        ok: catalogs.ready && catalogs.models > 0,
        latencyMs: this.now() - startedAt,
        checks: [
          {
            name: "codex_models",
            ok: catalogs.models > 0,
            ...(catalogs.models > 0
              ? { message: `${catalogs.models} 个模型` }
              : { message: "模型目录为空。" }),
          },
          {
            name: "codex_app_server",
            ok: catalogs.ready,
            message: catalogs.ready ? "App Server 已就绪" : "App Server 未就绪",
          },
          {
            name: "codex_capabilities",
            ok: true,
            message: `${catalogs.skills} 个 Skill，${catalogs.plugins} 个插件，${catalogs.apps} 个应用`,
          },
        ],
        ...(catalogs.models > 0 ? {} : { error: "Codex 模型目录为空。" }),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: this.now() - startedAt,
        checks: [{ name: "codex_models", ok: false, message: formatError(error) }],
        error: formatError(error),
      };
    }
  }

  listArchivedSessions(conversationKey: string): SessionSummary[] {
    const target = parseWebChatConversationKey(conversationKey);
    return target
      ? this.options.manager.listArchivedSessions(target.userId, target.sessionId)
      : [];
  }

  getArchivedSessionDetail(
    conversationKey: string,
    selection?: number | string
  ): ArchivedSessionDetail | null {
    const target = parseWebChatConversationKey(conversationKey);
    return target
      ? this.options.manager.getArchivedSessionDetail(
          target.userId,
          target.sessionId,
          selection
        )
      : null;
  }

  summarizeArchivedSession(
    conversationKey: string,
    selection?: number | string,
    refresh = false
  ): Promise<SessionSummaryWithAi | null> {
    const target = parseWebChatConversationKey(conversationKey);
    return target
      ? this.options.manager.summarizeArchivedSession(
          target.userId,
          target.sessionId,
          selection,
          refresh
        )
      : Promise.resolve(null);
  }
}

export function createWebChatConversationKey(
  userId: string,
  sessionId: string
): string {
  return `${userId}:${sessionId}`;
}

export function parseWebChatConversationKey(
  value: string
): { userId: string; sessionId: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  const userId = value.slice(0, separator);
  const sessionId = value.slice(separator + 1);
  if (
    !/^[a-zA-Z0-9_-]+$/.test(userId) ||
    !/^[a-zA-Z0-9_-]+$/.test(sessionId)
  ) {
    return null;
  }
  return { userId, sessionId };
}

function mapTrackedSession(
  userId: string,
  session: ReturnType<WebChatManager["listAdminSessions"]>[number]
) {
  const conversationKey = createWebChatConversationKey(
    userId,
    session.conversationKey
  );
  return {
    ...session,
    conversationKey,
    currentMessage: { ...session.currentMessage, conversationKey },
    messages: session.messages.map((message) => ({
      ...message,
      conversationKey,
    })),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

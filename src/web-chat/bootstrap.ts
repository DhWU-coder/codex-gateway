import type { CodexModelOption } from "../codex/model-catalog.js";
import type { WebChatAuthenticatedSession } from "./auth.js";
import type { WebChatCapabilityPublic } from "./capabilities.js";
import {
  WEB_CHAT_COMMANDS,
  type WebChatCommandDefinition,
} from "./commands.js";
import type {
  WebChatManager,
  WebChatMessagePage,
} from "./manager.js";
import type { WebChatSessionRecord } from "./session-store.js";
import type { WebChatTurnTrace } from "./trace-types.js";
import type { WebChatUserPublic } from "./types.js";

export interface WebChatBootstrapIdentity {
  user: WebChatUserPublic;
  csrfToken: string;
  expiresAt: number;
}

export interface WebChatBootstrapCurrent {
  session: WebChatSessionRecord;
  messages: WebChatMessagePage;
  traces: WebChatTurnTrace[];
  capabilities: WebChatCapabilityPublic[];
}

export interface WebChatBootstrapData {
  version: 1;
  identity: WebChatBootstrapIdentity;
  models: CodexModelOption[];
  sessions: WebChatSessionRecord[];
  current: WebChatBootstrapCurrent | null;
  commands: WebChatCommandDefinition[];
}

export async function buildWebChatBootstrap(
  manager: WebChatManager,
  authenticated: WebChatAuthenticatedSession
): Promise<WebChatBootstrapData> {
  let sessions = manager.listSessions(authenticated.user.id);
  if (sessions.length === 0) {
    manager.createSession(authenticated.user.id);
    sessions = manager.listSessions(authenticated.user.id);
  }

  const session = sessions[0] ?? null;
  const [models, capabilities] = await Promise.all([
    manager.listModels(),
    session
      ? manager.listCapabilities(authenticated.user.id, session.id)
      : Promise.resolve([]),
  ]);

  return {
    version: 1,
    identity: {
      user: authenticated.user,
      csrfToken: authenticated.csrfToken,
      expiresAt: authenticated.expiresAt,
    },
    models,
    sessions,
    current: session
      ? {
          session,
          messages:
            manager.listMessages(authenticated.user.id, session.id) ?? {
              messages: [],
              total: 0,
            },
          traces: manager.listTraces(authenticated.user.id, session.id),
          capabilities,
        }
      : null,
    commands: WEB_CHAT_COMMANDS,
  };
}

import type {
  CodexReasoningEffort,
  CodexVerbosity,
} from "../codex/runtime-settings.js";

export interface WebChatUserRecord {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  enabled: boolean;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface WebChatUserPublic {
  id: string;
  username: string;
  enabled: boolean;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  workspacePath: string;
  sessionsPath: string;
}

export interface CreateWebChatUserInput {
  username: string;
  password: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fast?: boolean;
  verbosity?: CodexVerbosity;
}

export interface UpdateWebChatUserInput {
  username?: string;
  enabled?: boolean;
  model?: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
  fast?: boolean | null;
  verbosity?: CodexVerbosity | null;
}

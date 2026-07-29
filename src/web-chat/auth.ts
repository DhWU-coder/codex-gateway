import { createHash, randomBytes } from "node:crypto";
import type { WebChatUserPublic } from "./types.js";
import {
  WebChatAuthSessionStore,
  type WebChatAuthSessionRecord,
} from "./auth-session-store.js";
import {
  normalizeUsernameKey,
  WebChatUserStore,
} from "./user-store.js";

export const WEB_CHAT_SESSION_COOKIE = "codex_gateway_chat";

export interface WebChatAuthenticatedSession {
  sessionToken: string;
  csrfToken: string;
  user: WebChatUserPublic;
  expiresAt: number;
}

interface WebChatAuthSuccess<Status extends 200 | 201> {
  ok: true;
  status: Status;
  sessionToken: string;
  csrfToken: string;
  user: WebChatUserPublic;
  expiresAt: number;
  setCookie: string;
}

export type WebChatLoginResult =
  | WebChatAuthSuccess<200>
  | {
      ok: false;
      status: 401 | 429;
      message: string;
      retryAfterSeconds?: number;
    };

export type WebChatRegistrationResult =
  | WebChatAuthSuccess<201>
  | {
      ok: false;
      status: 400 | 409 | 429;
      message: string;
      retryAfterSeconds?: number;
    };

export interface WebChatAuthServiceOptions {
  userStore: WebChatUserStore;
  now?: () => number;
  createToken?: () => string;
  sessionTtlMs?: number;
  maxFailedAttempts?: number;
  failureWindowMs?: number;
  maxRegistrationAttempts?: number;
  registrationWindowMs?: number;
  gatewayHome?: string;
  sessionStore?: WebChatAuthSessionStore;
}

export class WebChatAuthService {
  private readonly userStore: WebChatUserStore;
  private readonly now: () => number;
  private readonly createToken: () => string;
  private readonly sessionTtlMs: number;
  private readonly maxFailedAttempts: number;
  private readonly failureWindowMs: number;
  private readonly maxRegistrationAttempts: number;
  private readonly registrationWindowMs: number;
  private readonly sessionStore: WebChatAuthSessionStore;
  private readonly sessions = new Map<string, WebChatAuthSessionRecord>();
  private readonly failedAttempts = new Map<string, number[]>();
  private readonly registrationAttempts = new Map<string, number[]>();
  private registrationQueue: Promise<void> = Promise.resolve();

  constructor(options: WebChatAuthServiceOptions) {
    this.userStore = options.userStore;
    this.now = options.now ?? (() => Date.now());
    this.createToken =
      options.createToken ?? (() => randomBytes(32).toString("base64url"));
    this.sessionTtlMs = options.sessionTtlMs ?? 24 * 60 * 60 * 1000;
    this.maxFailedAttempts = options.maxFailedAttempts ?? 5;
    this.failureWindowMs = options.failureWindowMs ?? 5 * 60 * 1000;
    this.maxRegistrationAttempts = options.maxRegistrationAttempts ?? 5;
    this.registrationWindowMs = options.registrationWindowMs ?? 60 * 60 * 1000;
    this.sessionStore =
      options.sessionStore ??
      new WebChatAuthSessionStore({ gatewayHome: options.gatewayHome });
    this.restoreSessions();
  }

  async register(
    username: string,
    password: string,
    clientAddress: string
  ): Promise<WebChatRegistrationResult> {
    const registrationKey = clientAddress || "unknown";
    const limited = this.checkRegistrationRateLimit(registrationKey);
    if (limited !== null) {
      return {
        ok: false,
        status: 429,
        message: "注册尝试过于频繁，请稍后再试。",
        retryAfterSeconds: limited,
      };
    }
    this.recordRegistrationAttempt(registrationKey);

    try {
      const user = await this.createUserSerially(username, password);
      return this.createAuthenticatedSession(user.id, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册失败。";
      return {
        ok: false,
        status: message === "用户名已存在。" ? 409 : 400,
        message,
      };
    }
  }

  async login(
    username: string,
    password: string,
    clientAddress: string
  ): Promise<WebChatLoginResult> {
    const failureKey = this.failureKey(username, clientAddress);
    const limited = this.checkRateLimit(failureKey);
    if (limited !== null) {
      return {
        ok: false,
        status: 429,
        message: "登录尝试过于频繁，请稍后再试。",
        retryAfterSeconds: limited,
      };
    }

    const user = this.findUser(username);
    const verified =
      Boolean(user?.enabled) &&
      Boolean(user && (await this.userStore.verifyPassword(user.id, password)));
    if (!user || !verified) {
      this.recordFailure(failureKey);
      return {
        ok: false,
        status: 401,
        message: "用户名或密码错误。",
      };
    }

    this.failedAttempts.delete(failureKey);
    return this.createAuthenticatedSession(user.id, 200);
  }

  private createAuthenticatedSession<Status extends 200 | 201>(
    userId: string,
    status: Status
  ): WebChatAuthSuccess<Status> {
    const sessionToken = this.uniqueToken();
    const csrfToken = this.uniqueToken();
    const expiresAt = this.now() + this.sessionTtlMs;
    const publicUser = this.userStore.markLogin(userId);
    if (!publicUser) throw new Error("用户不存在。");
    this.sessions.set(hashSessionToken(sessionToken), {
      tokenHash: hashSessionToken(sessionToken),
      csrfToken,
      userId,
      expiresAt,
    });
    this.persistSessions();
    return {
      ok: true,
      status,
      sessionToken,
      csrfToken,
      user: publicUser,
      expiresAt,
      setCookie: createSessionCookie(sessionToken, this.sessionTtlMs),
    };
  }

  authenticate(cookieHeader: string | null | undefined): WebChatAuthenticatedSession | null {
    const token = readCookie(cookieHeader, WEB_CHAT_SESSION_COOKIE);
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(tokenHash);
      this.persistSessions();
      return null;
    }
    const user = this.userStore.getById(session.userId);
    if (!user?.enabled) {
      this.revokeUser(session.userId);
      return null;
    }
    return {
      sessionToken: token,
      csrfToken: session.csrfToken,
      user: this.userStore.toPublic(user),
      expiresAt: session.expiresAt,
    };
  }

  authenticateMutation(
    cookieHeader: string | null | undefined,
    csrfToken: string | null | undefined
  ): WebChatAuthenticatedSession | null {
    const session = this.authenticate(cookieHeader);
    if (!session || !csrfToken || csrfToken !== session.csrfToken) return null;
    return session;
  }

  logout(cookieHeader: string | null | undefined): string {
    const token = readCookie(cookieHeader, WEB_CHAT_SESSION_COOKIE);
    if (token && this.sessions.delete(hashSessionToken(token))) {
      this.persistSessions();
    }
    return clearSessionCookie();
  }

  revokeUser(userId: string): number {
    let count = 0;
    for (const [token, session] of this.sessions) {
      if (session.userId !== userId) continue;
      this.sessions.delete(token);
      count += 1;
    }
    if (count > 0) this.persistSessions();
    return count;
  }

  async changePassword(
    cookieHeader: string | null | undefined,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const session = this.authenticate(cookieHeader);
    if (!session) return false;
    if (!(await this.userStore.verifyPassword(session.user.id, currentPassword))) {
      return false;
    }
    if (!(await this.userStore.resetPassword(session.user.id, newPassword))) {
      return false;
    }
    this.revokeUser(session.user.id);
    return true;
  }

  private findUser(username: string) {
    try {
      return this.userStore.findByUsername(username);
    } catch {
      return null;
    }
  }

  private failureKey(username: string, clientAddress: string): string {
    let usernameKey: string;
    try {
      usernameKey = normalizeUsernameKey(username);
    } catch {
      usernameKey = username.trim().normalize("NFKC").toLocaleLowerCase("en-US");
    }
    return `${clientAddress || "unknown"}\u0000${usernameKey}`;
  }

  private checkRateLimit(key: string): number | null {
    const attempts = this.activeFailures(key);
    if (attempts.length < this.maxFailedAttempts) return null;
    const retryAt = (attempts[0] ?? this.now()) + this.failureWindowMs;
    return Math.max(1, Math.ceil((retryAt - this.now()) / 1000));
  }

  private recordFailure(key: string): void {
    const attempts = this.activeFailures(key);
    attempts.push(this.now());
    this.failedAttempts.set(key, attempts);
  }

  private activeFailures(key: string): number[] {
    const cutoff = this.now() - this.failureWindowMs;
    const attempts = (this.failedAttempts.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff
    );
    if (attempts.length > 0) this.failedAttempts.set(key, attempts);
    else this.failedAttempts.delete(key);
    return attempts;
  }

  private checkRegistrationRateLimit(key: string): number | null {
    const attempts = this.activeRegistrationAttempts(key);
    if (attempts.length < this.maxRegistrationAttempts) return null;
    const retryAt = (attempts[0] ?? this.now()) + this.registrationWindowMs;
    return Math.max(1, Math.ceil((retryAt - this.now()) / 1000));
  }

  private recordRegistrationAttempt(key: string): void {
    const attempts = this.activeRegistrationAttempts(key);
    attempts.push(this.now());
    this.registrationAttempts.set(key, attempts);
  }

  private activeRegistrationAttempts(key: string): number[] {
    const cutoff = this.now() - this.registrationWindowMs;
    const attempts = (this.registrationAttempts.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff
    );
    if (attempts.length > 0) this.registrationAttempts.set(key, attempts);
    else this.registrationAttempts.delete(key);
    return attempts;
  }

  private createUserSerially(
    username: string,
    password: string
  ): Promise<WebChatUserPublic> {
    const operation = this.registrationQueue.then(() =>
      this.userStore.create({ username, password })
    );
    this.registrationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private uniqueToken(): string {
    let token = this.createToken();
    while (this.sessions.has(hashSessionToken(token))) token = this.createToken();
    return token;
  }

  private restoreSessions(): void {
    let changed = false;
    const records = this.sessionStore.load();
    for (const record of records) {
      const user = this.userStore.getById(record.userId);
      if (this.now() >= record.expiresAt || !user?.enabled) {
        changed = true;
        continue;
      }
      if (this.sessions.has(record.tokenHash)) changed = true;
      this.sessions.set(record.tokenHash, record);
    }
    if (changed) this.persistSessions();
  }

  private persistSessions(): void {
    this.sessionStore.save([...this.sessions.values()]);
  }
}

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function createSessionCookie(token: string, ttlMs: number): string {
  const maxAge = Math.max(1, Math.floor(ttlMs / 1000));
  return `${WEB_CHAT_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function clearSessionCookie(): string {
  return `${WEB_CHAT_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

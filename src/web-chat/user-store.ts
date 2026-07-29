import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  normalizeCodexReasoningEffort,
  normalizeCodexVerbosity,
} from "../codex/runtime-settings.js";
import {
  resolveGatewayHome,
  resolveWebChatSessionsPath,
  resolveWebChatUserRoot,
  resolveWebChatUsersPath,
  resolveWebChatWorkspacePath,
} from "../paths.js";
import type {
  CreateWebChatUserInput,
  UpdateWebChatUserInput,
  WebChatUserPublic,
  WebChatUserRecord,
} from "./types.js";

interface WebChatUsersFile {
  version: 1;
  users: WebChatUserRecord[];
}

export interface WebChatUserStoreOptions {
  gatewayHome?: string;
  usersPath?: string;
  createId?: () => string;
  now?: () => Date;
}

export class WebChatUserStore {
  private readonly gatewayHome: string;
  private readonly usersPath: string;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: WebChatUserStoreOptions = {}) {
    this.gatewayHome = options.gatewayHome ?? resolveGatewayHome();
    this.usersPath =
      options.usersPath ??
      resolveWebChatUsersPath({
        env: { CODEX_GATEWAY_HOME: this.gatewayHome },
      });
    this.createId = options.createId ?? (() => `user-${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
  }

  list(): WebChatUserPublic[] {
    return this.readUsers()
      .sort((left, right) => left.usernameKey.localeCompare(right.usernameKey))
      .map((user) => this.toPublic(user));
  }

  getById(userId: string): WebChatUserRecord | null {
    const user = this.readUsers().find((item) => item.id === userId);
    return user ? { ...user } : null;
  }

  findByUsername(username: string): WebChatUserRecord | null {
    const key = normalizeUsernameKey(username);
    const user = this.readUsers().find((item) => item.usernameKey === key);
    return user ? { ...user } : null;
  }

  async create(input: CreateWebChatUserInput): Promise<WebChatUserPublic> {
    const users = this.readUsers();
    const username = normalizeUsername(input.username);
    const usernameKey = normalizeUsernameKey(username);
    if (users.some((user) => user.usernameKey === usernameKey)) {
      throw new Error("用户名已存在。");
    }
    validatePassword(input.password);
    const timestamp = this.now().toISOString();
    const record: WebChatUserRecord = {
      id: this.createId(),
      username,
      usernameKey,
      passwordHash: await Bun.password.hash(input.password, { algorithm: "argon2id" }),
      enabled: true,
      model: normalizeOptionalString(input.model),
      reasoningEffort: normalizeCodexReasoningEffort(input.reasoningEffort),
      fast: typeof input.fast === "boolean" ? input.fast : undefined,
      verbosity: normalizeCodexVerbosity(input.verbosity),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    users.push(record);
    this.writeUsers(users);
    mkdirSync(this.workspacePath(record.id), { recursive: true, mode: 0o700 });
    mkdirSync(this.sessionsPath(record.id), { recursive: true, mode: 0o700 });
    return this.toPublic(record);
  }

  update(userId: string, input: UpdateWebChatUserInput): WebChatUserPublic | null {
    const users = this.readUsers();
    const record = users.find((user) => user.id === userId);
    if (!record) return null;

    if (input.username !== undefined) {
      const username = normalizeUsername(input.username);
      const usernameKey = normalizeUsernameKey(username);
      if (users.some((user) => user.id !== userId && user.usernameKey === usernameKey)) {
        throw new Error("用户名已存在。");
      }
      record.username = username;
      record.usernameKey = usernameKey;
    }
    if (typeof input.enabled === "boolean") record.enabled = input.enabled;
    assignOptional(record, input, "model", normalizeOptionalString);
    assignOptional(record, input, "reasoningEffort", normalizeCodexReasoningEffort);
    assignOptional(record, input, "fast", (value) =>
      typeof value === "boolean" ? value : undefined
    );
    assignOptional(record, input, "verbosity", normalizeCodexVerbosity);
    record.updatedAt = this.now().toISOString();
    this.writeUsers(users);
    return this.toPublic(record);
  }

  async resetPassword(userId: string, password: string): Promise<boolean> {
    validatePassword(password);
    const users = this.readUsers();
    const record = users.find((user) => user.id === userId);
    if (!record) return false;
    record.passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    record.updatedAt = this.now().toISOString();
    this.writeUsers(users);
    return true;
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const record = this.getById(userId);
    if (!record) return false;
    try {
      return await Bun.password.verify(password, record.passwordHash);
    } catch {
      return false;
    }
  }

  markLogin(userId: string): WebChatUserPublic | null {
    const users = this.readUsers();
    const record = users.find((user) => user.id === userId);
    if (!record) return null;
    const timestamp = this.now().toISOString();
    record.lastLoginAt = timestamp;
    record.updatedAt = timestamp;
    this.writeUsers(users);
    return this.toPublic(record);
  }

  remove(userId: string, purgeData: boolean): boolean {
    const users = this.readUsers();
    if (!users.some((user) => user.id === userId)) return false;
    this.writeUsers(users.filter((user) => user.id !== userId));
    if (purgeData) rmSync(this.userRoot(userId), { recursive: true, force: true });
    return true;
  }

  toPublic(record: WebChatUserRecord): WebChatUserPublic {
    return {
      id: record.id,
      username: record.username,
      enabled: record.enabled,
      model: record.model,
      reasoningEffort: record.reasoningEffort,
      fast: record.fast,
      verbosity: record.verbosity,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastLoginAt: record.lastLoginAt,
      workspacePath: this.workspacePath(record.id),
      sessionsPath: this.sessionsPath(record.id),
    };
  }

  private readUsers(): WebChatUserRecord[] {
    if (!existsSync(this.usersPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.usersPath, "utf8")) as WebChatUsersFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.users)) throw new Error();
      return parsed.users.map((user) => ({ ...user }));
    } catch {
      throw new Error("Web Chat 用户文件损坏，已停止读取以避免覆盖。");
    }
  }

  private writeUsers(users: WebChatUserRecord[]): void {
    mkdirSync(dirname(this.usersPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.usersPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify({ version: 1, users } satisfies WebChatUsersFile, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      renameSync(temporaryPath, this.usersPath);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  }

  private userRoot(userId: string): string {
    return join(this.gatewayHome, "channels", "web", userId);
  }

  private workspacePath(userId: string): string {
    return resolveWebChatWorkspacePath(userId, {
      env: { CODEX_GATEWAY_HOME: this.gatewayHome },
    });
  }

  private sessionsPath(userId: string): string {
    return resolveWebChatSessionsPath(userId, {
      env: { CODEX_GATEWAY_HOME: this.gatewayHome },
    });
  }
}

function normalizeUsername(value: string): string {
  const username = value.trim().normalize("NFKC");
  if (!username || username.length > 64 || /[\u0000-\u001f\u007f/\\]/.test(username)) {
    throw new Error("用户名必须为 1-64 个有效字符。");
  }
  return username;
}

export function normalizeUsernameKey(value: string): string {
  return normalizeUsername(value).toLocaleLowerCase("en-US");
}

function validatePassword(value: string): void {
  if (value.length < 8 || value.length > 256) {
    throw new Error("密码长度必须为 8-256 个字符。");
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assignOptional<
  Key extends "model" | "reasoningEffort" | "fast" | "verbosity",
>(
  record: WebChatUserRecord,
  input: UpdateWebChatUserInput,
  key: Key,
  normalize: (value: unknown) => WebChatUserRecord[Key]
): void {
  if (!Object.prototype.hasOwnProperty.call(input, key)) return;
  Object.assign(record, { [key]: normalize(input[key]) });
}

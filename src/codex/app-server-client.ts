import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type {
  AppServerInitializeResponse,
  AppServerNotification,
  AppServerRequest,
  AppServerRequestId,
  AppServerResponse,
  AppServerServerRequestHandler,
} from "./app-server-types.js";

export interface AppServerChildProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface CodexAppServerClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  createProcess?: () => AppServerChildProcess;
  handleServerRequest?: AppServerServerRequestHandler;
  onStderr?: (text: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type NotificationListener = (notification: AppServerNotification) => void;

export class CodexAppServerClient {
  private child?: AppServerChildProcess;
  private startPromise?: Promise<void>;
  private nextRequestId = 1;
  private readonly pending = new Map<AppServerRequestId, PendingRequest>();
  private readonly listeners = new Set<NotificationListener>();
  private stdoutBuffer = "";
  private stopping = false;
  private _ready = false;

  constructor(private readonly options: CodexAppServerClientOptions) {}

  get ready(): boolean {
    return this._ready;
  }

  start(): Promise<void> {
    if (this._ready) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this._ready) await this.start();
    return this.sendRequest<T>(method, params);
  }

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this._ready = false;
      return;
    }
    this.stopping = true;
    const child = this.child;
    this.child = undefined;
    this._ready = false;
    this.rejectPending(new Error("App Server 已停止。"));
    child.kill("SIGTERM");
    this.stopping = false;
  }

  private async startInternal(): Promise<void> {
    this.stopping = false;
    this.stdoutBuffer = "";
    const child: AppServerChildProcess = this.options.createProcess?.() ?? this.spawnProcess();
    this.child = child;
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => this.consumeStdout(String(chunk)));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.options.onStderr?.(text);
    });
    child.on("error", (error: Error) => this.handleExit(undefined, error));
    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      const suffix = signal ? `（${signal}）` : code === null ? "" : `（退出码 ${code}）`;
      this.handleExit(child, new Error(`App Server 已退出${suffix}。`));
    });

    try {
      await this.sendRequest<AppServerInitializeResponse>("initialize", {
        clientInfo: {
          name: "codex-gateway",
          title: "Codex Gateway",
          version: "0.1.0",
        },
        capabilities: null,
      });
      if (this.child !== child) throw new Error("App Server 初始化期间已退出。");
      this._ready = true;
    } catch (error) {
      if (this.child === child) {
        this.child = undefined;
        child.kill("SIGTERM");
      }
      this._ready = false;
      throw error;
    }
  }

  private spawnProcess(): AppServerChildProcess {
    return spawn(this.options.command, this.options.args ?? ["app-server", "--stdio"], {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: "pipe",
    });
  }

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("App Server 尚未启动。"));
    const id = this.nextRequestId++;
    const timeoutMs = Math.max(1, this.options.requestTimeoutMs ?? 30_000);
    const request: AppServerRequest = {
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`App Server 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        child.stdin.write(`${JSON.stringify(request)}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (this.stdoutBuffer.includes("\n")) {
      const newline = this.stdoutBuffer.indexOf("\n");
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.handleMessage(JSON.parse(line) as unknown);
      } catch {
        this.options.onStderr?.(`App Server 返回了无法解析的消息：${line.slice(0, 500)}`);
      }
    }
  }

  private handleMessage(value: unknown): void {
    if (!isRecord(value)) return;
    const id = typeof value.id === "number" ? value.id : undefined;
    const method = typeof value.method === "string" ? value.method : undefined;
    if (id !== undefined && method) {
      void this.handleServerRequest({
        id,
        method,
        ...(value.params === undefined ? {} : { params: value.params }),
      });
      return;
    }
    if (id !== undefined) {
      this.handleResponse(value as unknown as AppServerResponse);
      return;
    }
    if (method) {
      const notification: AppServerNotification = {
        method,
        ...(value.params === undefined ? {} : { params: value.params }),
      };
      for (const listener of this.listeners) listener(notification);
    }
  }

  private handleResponse(response: AppServerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(
        new Error(
          response.error.message ||
            `App Server 请求失败${response.error.code === undefined ? "" : `（${response.error.code}）`}`
        )
      );
      return;
    }
    pending.resolve(response.result);
  }

  private async handleServerRequest(request: AppServerRequest): Promise<void> {
    try {
      if (!this.options.handleServerRequest) {
        this.write({
          id: request.id,
          error: { code: -32601, message: `不支持服务端请求：${request.method}` },
        });
        return;
      }
      const result = await this.options.handleServerRequest(request);
      this.write({ id: request.id, result });
    } catch (error) {
      this.write({
        id: request.id,
        error: { code: -32000, message: toError(error).message },
      });
    }
  }

  private write(value: unknown): void {
    this.child?.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private handleExit(
    child: AppServerChildProcess | undefined,
    error: Error
  ): void {
    if (child && this.child !== child) return;
    this.child = undefined;
    this._ready = false;
    if (!this.stopping) this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

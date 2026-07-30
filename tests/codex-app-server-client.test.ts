import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "bun:test";
import {
  CodexAppServerClient,
  type AppServerChildProcess,
} from "../src/codex/app-server-client.js";

describe("Codex App Server Client", () => {
  test("初始化时声明 experimentalApi 能力", async () => {
    const child = new FakeChildProcess();
    const client = new CodexAppServerClient({
      command: "codex",
      createProcess: () => child,
    });
    let initializeRequest: Record<string, unknown> | undefined;
    child.onRequest((request) => {
      if (request.method !== "initialize") return;
      initializeRequest = request;
      child.respond(request.id as number, {});
    });

    await client.start();

    expect(initializeRequest).toMatchObject({
      method: "initialize",
      params: {
        capabilities: {
          experimentalApi: true,
        },
      },
    });
    await client.stop();
  });

  test("初始化后支持乱序并发响应和通知订阅", async () => {
    const child = new FakeChildProcess();
    const client = new CodexAppServerClient({
      command: "codex",
      createProcess: () => child,
    });
    const requests: Array<Record<string, unknown>> = [];
    child.onRequest((request) => {
      requests.push(request);
      if (request.method === "initialize") {
        child.respond(request.id as number, {
          userAgent: "codex-test",
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
        });
      }
    });

    await client.start();
    const notifications: unknown[] = [];
    client.subscribe((notification) => notifications.push(notification));
    const first = client.request<{ value: string }>("model/list", {});
    const second = client.request<{ value: string }>("skills/list", { cwds: ["/tmp"] });
    await waitFor(() => requests.length === 3);
    const firstRequest = requests[1];
    const secondRequest = requests[2];

    child.respond(secondRequest.id as number, { value: "second" });
    child.notify("skills/changed", { cwd: "/tmp" });
    child.respond(firstRequest.id as number, { value: "first" });

    expect(await first).toEqual({ value: "first" });
    expect(await second).toEqual({ value: "second" });
    expect(notifications).toEqual([
      { method: "skills/changed", params: { cwd: "/tmp" } },
    ]);
    expect(client.ready).toBe(true);
    await client.stop();
  });

  test("请求超时后拒绝且不会接收迟到响应", async () => {
    const child = new FakeChildProcess();
    const client = new CodexAppServerClient({
      command: "codex",
      requestTimeoutMs: 10,
      createProcess: () => child,
    });
    child.onRequest((request) => {
      if (request.method === "initialize") child.respond(request.id as number, {});
    });
    await client.start();

    await expect(client.request("model/list", {})).rejects.toThrow("App Server 请求超时");
    child.respond(2, { data: [] });
    await client.stop();
  });

  test("进程退出时拒绝全部待处理请求", async () => {
    const child = new FakeChildProcess();
    const client = new CodexAppServerClient({
      command: "codex",
      createProcess: () => child,
    });
    child.onRequest((request) => {
      if (request.method === "initialize") child.respond(request.id as number, {});
    });
    await client.start();
    const pending = client.request("model/list", {});

    child.exit(17);

    await expect(pending).rejects.toThrow("App Server 已退出");
    expect(client.ready).toBe(false);
  });

  test("服务端反向请求交给处理器并返回结果", async () => {
    const child = new FakeChildProcess();
    const client = new CodexAppServerClient({
      command: "codex",
      createProcess: () => child,
      handleServerRequest: async (request) => ({
        accepted: request.method === "currentTime/read",
      }),
    });
    const writes: Array<Record<string, unknown>> = [];
    child.onRequest((request) => {
      writes.push(request);
      if (request.method === "initialize") child.respond(request.id as number, {});
    });
    await client.start();

    child.serverRequest(99, "currentTime/read", {});
    await waitFor(() => writes.some((item) => item.id === 99 && "result" in item));

    expect(writes.find((item) => item.id === 99)).toEqual({
      id: 99,
      result: { accepted: true },
    });
    await client.stop();
    await client.stop();
  });

  test("未配置处理器的服务端反向请求返回错误", async () => {
    const child = new FakeChildProcess();
    const client = new CodexAppServerClient({
      command: "codex",
      createProcess: () => child,
    });
    const writes: Array<Record<string, unknown>> = [];
    child.onRequest((request) => {
      writes.push(request);
      if (request.method === "initialize") child.respond(request.id as number, {});
    });
    await client.start();

    child.serverRequest(101, "item/tool/requestUserInput", {});
    await waitFor(() => writes.some((item) => item.id === 101 && "error" in item));

    expect(writes.find((item) => item.id === 101)).toMatchObject({
      id: 101,
      error: { code: -32601 },
    });
    await client.stop();
  });
});

class FakeChildProcess extends EventEmitter implements AppServerChildProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private buffer = "";

  constructor() {
    super();
    this.stdin.setEncoding("utf-8");
  }

  onRequest(listener: (request: Record<string, unknown>) => void): void {
    this.stdin.on("data", (chunk) => {
      this.buffer += String(chunk);
      while (this.buffer.includes("\n")) {
        const newline = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.trim()) listener(JSON.parse(line) as Record<string, unknown>);
      }
    });
  }

  respond(id: number, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }

  notify(method: string, params: unknown): void {
    this.stdout.write(`${JSON.stringify({ method, params })}\n`);
  }

  serverRequest(id: number, method: string, params: unknown): void {
    this.stdout.write(`${JSON.stringify({ id, method, params })}\n`);
  }

  kill(): boolean {
    this.exit(0);
    return true;
  }

  exit(code: number): void {
    this.emit("exit", code, null);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待条件超时");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

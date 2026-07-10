import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  formatStartResult,
  formatStatus,
  startServiceCommand,
  stopServiceCommand,
} from "../src/service/commands.js";
import type { ServiceState } from "../src/service/state.js";

describe("service commands", () => {
  test("formats stopped and running status", () => {
    expect(formatStatus(null)).toBe("codex-gateway service stopped");
    expect(formatStatus(state({ pid: process.pid }))).toContain("codex-gateway service running");
  });

  test("does not spawn another daemon when state is already running", async () => {
    const running = state({ pid: 1234 });
    const result = await startServiceCommand({
      configPath: join(mkdtempSync(join(tmpdir(), "codex-gateway-service-")), "config.yaml"),
      readState: () => running,
      isStateRunning: () => true,
      spawnDaemon: () => {
        throw new Error("不应该重复启动");
      },
    });

    expect(result.alreadyRunning).toBe(true);
    expect(formatStartResult(result)).toContain("already running");
  });

  test("spawns a detached daemon and writes service state", async () => {
    let written: Partial<ServiceState> = {};
    const result = await startServiceCommand({
      configPath: join(mkdtempSync(join(tmpdir(), "codex-gateway-service-")), "config.yaml"),
      now: () => new Date("2026-07-10T00:00:00.000Z"),
      readState: () => null,
      writeState: (next) => {
        written = next;
      },
      findPort: async () => ({ port: 18788 }),
      spawnDaemon: () => 4321,
    });

    expect(result.state.pid).toBe(4321);
    expect(result.state.webUrl).toBe("http://127.0.0.1:18788/");
    expect(written.pid).toBe(4321);
  });

  test("stop kills a running daemon and removes state", async () => {
    let removed = false;
    const killed: number[] = [];
    let checks = 0;
    const message = await stopServiceCommand({
      readState: () => state({ pid: 2345 }),
      isProcessRunning: () => checks++ === 0,
      killProcess: (pid) => {
        killed.push(pid);
      },
      removeState: () => {
        removed = true;
      },
    });

    expect(message).toContain("stopped");
    expect(killed).toEqual([2345]);
    expect(removed).toBe(true);
  });

  test("stop removes stale state without killing", async () => {
    let removed = false;
    const killed: number[] = [];
    const message = await stopServiceCommand({
      readState: () => state({ pid: 3456 }),
      isProcessRunning: () => false,
      killProcess: (pid) => {
        killed.push(pid);
      },
      removeState: () => {
        removed = true;
      },
    });

    expect(message).toContain("stopped");
    expect(killed).toEqual([]);
    expect(removed).toBe(true);
  });
});

function state(input: { pid: number }): ServiceState {
  return {
    pid: input.pid,
    startedAt: "2026-07-10T00:00:00.000Z",
    host: "127.0.0.1",
    port: 18788,
    webUrl: "http://127.0.0.1:18788/",
    logPath: "/tmp/service.log",
    cwd: "/tmp/work",
    channels: {},
  };
}

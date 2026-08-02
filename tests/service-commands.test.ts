import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  formatStartResult,
  formatStatus,
  restartServiceCommand,
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
    let spawnedConfigPath: string | undefined;
    let probedHost = "";
    const result = await startServiceCommand({
      configPath: "config.yaml",
      cwd: "/tmp/codex-gateway",
      now: () => new Date("2026-07-10T00:00:00.000Z"),
      readState: () => null,
      writeState: (next) => {
        written = next;
      },
      findPort: async (_port, host) => {
        probedHost = host;
        return { port: 18788 };
      },
      spawnDaemon: (input) => {
        spawnedConfigPath = input.configPath;
        return 4321;
      },
    });

    expect(result.state.pid).toBe(4321);
    expect(result.state.webUrl).toBe("http://127.0.0.1:18788/");
    expect(written.pid).toBe(4321);
    expect(spawnedConfigPath).toBe(resolve("/tmp/codex-gateway/config.yaml"));
    expect(probedHost).toBe("127.0.0.1");
  });

  test("defaults the daemon config to the installed project root", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-project-"));
    const invocationRoot = mkdtempSync(join(tmpdir(), "codex-gateway-caller-"));
    const configPath = join(projectRoot, "config.yaml");
    await Bun.write(
      configPath,
      [
        "service:",
        "  host: 0.0.0.0",
        "  port: 18788",
        `  cwd: ${join(projectRoot, "workspace")}`,
        "channels:",
        "  feishu:",
        "    accounts:",
        "      - id: primary",
        "        enabled: true",
        "        appId: cli_test",
        "        appSecret: secret",
        "",
      ].join("\n")
    );
    let spawnedConfigPath: string | undefined;

    const result = await startServiceCommand({
      cwd: invocationRoot,
      projectRoot,
      env: { CODEX_GATEWAY_HOME: join(projectRoot, "gateway-home") },
      readState: () => null,
      writeState: () => undefined,
      findPort: async () => ({ port: 18788 }),
      spawnDaemon: (input) => {
        spawnedConfigPath = input.configPath;
        return 4321;
      },
    });

    expect(spawnedConfigPath).toBe(configPath);
    expect(result.state.host).toBe("0.0.0.0");
  });

  test("reports LAN chat URLs for a public listener", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-gateway-service-lan-"));
    const configPath = join(root, "config.yaml");
    await Bun.write(
      configPath,
      "service:\n  host: 0.0.0.0\n  port: 18788\n  cwd: /tmp/work\n"
    );
    const result = await startServiceCommand({
      configPath,
      readState: () => null,
      writeState: () => undefined,
      findPort: async () => ({ port: 18788 }),
      spawnDaemon: () => 4321,
      networkAddresses: () => ["192.168.1.20"],
    });

    expect(result.state.host).toBe("0.0.0.0");
    expect(result.state.webUrl).toBe("http://127.0.0.1:18788/");
    expect(result.state.chatUrls).toEqual(["http://192.168.1.20:18788/chat"]);
    expect(formatStartResult(result)).toContain("Chat UI: http://192.168.1.20:18788/chat");
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

  test("stop force kills a daemon that does not exit gracefully", async () => {
    const signals: Array<NodeJS.Signals | undefined> = [];
    let waits = 0;
    const message = await stopServiceCommand({
      readState: () => state({ pid: 4567 }),
      isProcessRunning: () => true,
      killProcess: (_pid, signal) => {
        signals.push(signal);
      },
      waitForProcessExit: async () => {
        waits += 1;
        return waits === 2;
      },
      removeState: () => undefined,
    });

    expect(message).toContain("stopped");
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("restart waits for the configured port to be released and listening again", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-restart-port-"));
    const configPath = join(directory, "config.yaml");
    await Bun.write(
      configPath,
      "service:\n  host: 0.0.0.0\n  port: 18788\n  cwd: /tmp/work\n"
    );
    const states: Array<{ state: string; port: number; host: string }> = [];
    let removed = false;
    let runningState: ServiceState | null = state({ pid: 5678 });

    const message = await restartServiceCommand({
      configPath,
      readState: () => runningState,
      isProcessRunning: () => false,
      removeState: () => {
        removed = true;
        runningState = null;
      },
      writeState: () => undefined,
      findPort: async (port) => ({ port }),
      spawnDaemon: () => 6789,
      networkAddresses: () => [],
      waitForPortState: async (port, host, expectedState) => {
        states.push({ state: expectedState, port, host });
        return true;
      },
    });

    expect(removed).toBe(true);
    expect(message).toContain("service started (pid 6789)");
    expect(states).toEqual([
      { state: "available", port: 18788, host: "0.0.0.0" },
      { state: "occupied", port: 18788, host: "0.0.0.0" },
    ]);
  });

  test("restart never silently selects a fallback port", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-restart-strict-"));
    const configPath = join(directory, "config.yaml");
    await Bun.write(
      configPath,
      "service:\n  host: 127.0.0.1\n  port: 18788\n  cwd: /tmp/work\n"
    );

    await expect(
      restartServiceCommand({
        configPath,
        readState: () => null,
        removeState: () => undefined,
        findPort: async () => ({ port: 18789 }),
        spawnDaemon: () => 6789,
        waitForPortState: async () => true,
      })
    ).rejects.toThrow("service port 18788 became unavailable during restart");
  });
});

function state(input: { pid: number }): ServiceState {
  return {
    pid: input.pid,
    startedAt: "2026-07-10T00:00:00.000Z",
    host: "127.0.0.1",
    port: 18788,
    webUrl: "http://127.0.0.1:18788/",
    chatUrls: [],
    logPath: "/tmp/service.log",
    cwd: "/tmp/work",
    channels: {},
  };
}

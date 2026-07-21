import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChannelManager, ChannelReloadResult } from "../src/channel-manager.js";
import {
  startServiceDaemon,
  type ServiceConfigWatcherOptions,
} from "../src/service/daemon.js";
import type { SpawnRestartOptions } from "../src/service/process.js";
import type { WebServerOptions } from "../src/web-server.js";

let directory: string;
let configPath: string;
let originalGatewayHome: string | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "codex-gateway-daemon-"));
  configPath = join(directory, "config.yaml");
  writeFileSync(configPath, configText("cli_initial"));
  originalGatewayHome = process.env.CODEX_GATEWAY_HOME;
  process.env.CODEX_GATEWAY_HOME = join(directory, "home");
});

afterEach(() => {
  if (originalGatewayHome === undefined) delete process.env.CODEX_GATEWAY_HOME;
  else process.env.CODEX_GATEWAY_HOME = originalGatewayHome;
  rmSync(directory, { recursive: true, force: true });
});

describe("服务 Daemon 配置热更新", () => {
  test("监听项目配置并隔离解析错误", async () => {
    let watcherOptions: ServiceConfigWatcherOptions | undefined;
    let watcherClosed = false;
    let webStopped = false;
    let managerStopped = false;
    let webOptions: WebServerOptions | undefined;
    let restartOptions: SpawnRestartOptions | undefined;
    let modelCatalogCommand = "";
    const reloads: string[] = [];
    const manager = {
      async start() {},
      async stop() {
        managerStopped = true;
      },
      getStatus: () => ({ channels: [] }),
      async reloadConfig(config: { channels: { feishu: { accounts: Array<{ appId?: string }> } } }) {
        reloads.push(config.channels.feishu.accounts[0]?.appId ?? "");
        return reloadResult();
      },
    } as unknown as ChannelManager;

    const controller = await startServiceDaemon({
      port: 18788,
      configPath,
      createChannelManager: () => manager,
      startWebServer: (options) => {
        webOptions = options;
        return {
        port: 18788,
        stop() {
          webStopped = true;
        },
        } as never;
      },
      spawnServiceRestart: (options) => {
        restartOptions = options;
        return 4321;
      },
      createModelCatalog: (options) => {
        modelCatalogCommand = options.command ?? "";
        return {
          async list() {
            return [
              {
                id: "gpt-test",
                model: "gpt-test",
                displayName: "GPT Test",
                description: "Test model",
                supportedReasoningEfforts: [],
                additionalSpeedTiers: [],
                serviceTiers: [],
                supportsFast: false,
                isDefault: true,
              },
            ];
          },
          async runtimeDefaults() {
            return { fast: true, verbosity: "high" };
          },
        };
      },
      createConfigWatcher: (options) => {
        watcherOptions = options;
        return {
          close() {
            watcherClosed = true;
          },
        };
      },
    });

    try {
      expect(watcherOptions?.configPath).toBe(configPath);
      expect(webOptions).toMatchObject({
        projectRoot: directory,
        configPath,
        logPath: expect.stringContaining("service.log"),
      });
      expect(webOptions?.configReloadStateProvider?.()).toEqual({ status: "idle" });
      expect(modelCatalogCommand).toBe("codex");
      expect(await webOptions?.modelCatalogProvider?.()).toEqual([
        expect.objectContaining({ model: "gpt-test", isDefault: true }),
      ]);
      expect(await webOptions?.codexRuntimeDefaultsProvider?.()).toEqual({
        fast: true,
        verbosity: "high",
      });
      await webOptions?.restartService?.();
      expect(restartOptions).toMatchObject({
        cwd: directory,
        configPath,
        logPath: expect.stringContaining("service.log"),
      });

      writeFileSync(configPath, configText("cli_updated"));
      await watcherOptions?.onChange();
      expect(reloads).toEqual(["cli_updated"]);
      expect(controller.configReloadState()).toMatchObject({
        status: "success",
        result: expect.objectContaining({ errors: [] }),
      });

      writeFileSync(configPath, "channels: [broken");
      await watcherOptions?.onChange();
      expect(reloads).toEqual(["cli_updated"]);
      expect(controller.configReloadState()).toMatchObject({
        status: "error",
        error: expect.stringContaining("Flow sequence"),
      });
    } finally {
      await controller.stop();
    }

    expect(watcherClosed).toBe(true);
    expect(webStopped).toBe(true);
    expect(managerStopped).toBe(true);
  });
});

function reloadResult(): ChannelReloadResult {
  return {
    added: [],
    removed: [],
    restarted: [],
    updated: ["feishu:primary"],
    unchanged: [],
    ignoredNonHotFields: [],
    errors: [],
  };
}

function configText(appId: string): string {
  return `service:
  port: 18788
  cwd: ${directory}/workspace
codex:
  command: codex
channels:
  feishu:
    accounts:
      - id: primary
        enabled: true
        appId: ${appId}
        appSecret: secret
        domain: feishu
        cwd: ${directory}/workspace/primary
        historyBaseDir: ${directory}/history/primary
        sendProgressReplies: false
`;
}

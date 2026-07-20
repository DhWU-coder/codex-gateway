import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildRestartArgs,
  spawnDetachedServiceRestart,
} from "../src/service/process.js";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "codex-gateway-restart-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("服务进程辅助函数", () => {
  test("构造带项目配置路径的重启参数", () => {
    expect(buildRestartArgs({ configPath: "/project/config.yaml" })).toEqual([
      "restart",
      "--config",
      "/project/config.yaml",
    ]);
    expect(buildRestartArgs({})).toEqual(["restart"]);
  });

  test("分离启动重启辅助进程并复用服务日志", () => {
    const calls: unknown[][] = [];
    let unreferenced = false;
    const pid = spawnDetachedServiceRestart({
      cwd: directory,
      configPath: join(directory, "config.yaml"),
      logPath: join(directory, "service.log"),
      runtime: "/opt/bun",
      entrypoint: "/project/dist/index.js",
      spawnProcess: ((command: string, args: readonly string[], options: unknown) => {
        calls.push([command, args, options]);
        return {
          pid: 4321,
          unref() {
            unreferenced = true;
          },
        };
      }) as never,
    });

    expect(pid).toBe(4321);
    expect(unreferenced).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("/opt/bun");
    expect(calls[0]?.[1]).toEqual([
      "/project/dist/index.js",
      "restart",
      "--config",
      join(directory, "config.yaml"),
    ]);
    expect(calls[0]?.[2]).toMatchObject({ cwd: directory, detached: true });
  });

  test("辅助进程没有 PID 时返回明确错误", () => {
    expect(() =>
      spawnDetachedServiceRestart({
        cwd: directory,
        logPath: join(directory, "service.log"),
        spawnProcess: () => ({ pid: undefined, unref() {} }) as never,
      })
    ).toThrow("无法启动 codex-gateway 重启辅助进程");
  });
});

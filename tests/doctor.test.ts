import { describe, expect, test } from "bun:test";
import {
  inspectCodexAppServer,
  renderCodexAppServerDoctorReport,
} from "../src/doctor.js";
import type { CodexAppServerRuntime } from "../src/codex/app-server-runtime.js";

describe("Codex App Server Doctor", () => {
  test("检查握手和四类目录并明确显示空目录", async () => {
    let stopped = false;
    const runtime = {
      listModels: async () => [{ model: "gpt-test" }],
      listSkills: async () => [],
      listInstalledPlugins: async () => [{ name: "github" }],
      listInstalledApps: async () => [],
      stop: async () => {
        stopped = true;
      },
    } as unknown as CodexAppServerRuntime;

    const report = await inspectCodexAppServer(runtime, "/tmp/workspace");

    expect(report).toEqual({
      protocol: "ok",
      models: 1,
      skills: 0,
      plugins: 1,
      apps: 0,
    });
    expect(renderCodexAppServerDoctorReport(report)).toEqual([
      "App Server 协议：可用",
      "模型目录：1 项",
      "Skill 目录：可用，暂无项目",
      "插件目录：1 项",
      "应用目录：可用，暂无项目",
    ]);
    expect(stopped).toBe(true);
  });

  test("协议不可用时返回清晰错误且仍停止短生命周期进程", async () => {
    let stopped = false;
    const runtime = {
      listModels: async () => {
        throw new Error("initialize timeout token=private-token");
      },
      stop: async () => {
        stopped = true;
      },
    } as unknown as CodexAppServerRuntime;

    const report = await inspectCodexAppServer(runtime, "/tmp/workspace");

    expect(report).toEqual({
      protocol: "error",
      error: "initialize timeout token=[已隐藏]",
    });
    expect(renderCodexAppServerDoctorReport(report)).toEqual([
      "App Server 协议：不可用（initialize timeout token=[已隐藏]）",
    ]);
    expect(stopped).toBe(true);
  });
});

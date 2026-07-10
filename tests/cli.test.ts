import { describe, expect, test } from "bun:test";
import { createExampleConfig, parseCliArgs } from "../src/cli.js";

describe("CLI helpers", () => {
  test("parses run/start commands as background service start commands", () => {
    expect(parseCliArgs(["start", "--config", "/tmp/config.yaml"])).toEqual({
      command: "start",
      configPath: "/tmp/config.yaml",
    });
    expect(parseCliArgs(["run", "--config", "/tmp/config.yaml"])).toEqual({
      command: "run",
      configPath: "/tmp/config.yaml",
    });
  });

  test("parses service lifecycle commands", () => {
    expect(parseCliArgs(["restart"])).toEqual({ command: "restart" });
    expect(parseCliArgs(["stop"])).toEqual({ command: "stop" });
    expect(parseCliArgs(["status"])).toEqual({ command: "status" });
  });

  test("renders an example config with Feishu and Codex sections", () => {
    const config = createExampleConfig();

    expect(config).toContain("channels:");
    expect(config).toContain("feishu:");
    expect(config).toContain("codex:");
    expect(config).toContain("port: 18788");
    expect(config).toContain("appId: cli_xxx");
  });
});

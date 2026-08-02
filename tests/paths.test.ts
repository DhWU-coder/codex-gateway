import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  resolveConfigPath,
  resolveDefaultConfigPath,
  resolveGatewayHome,
  resolveWebChatAuthSessionsPath,
  resolveWebChatSessionsPath,
  resolveWebChatUserRoot,
  resolveWebChatUsersPath,
  resolveWebChatWorkspacePath,
} from "../src/paths.js";

describe("paths", () => {
  test("defaults config path to project config.yaml", () => {
    expect(resolveDefaultConfigPath({ projectRoot: "/tmp/codex-gateway" })).toBe(
      resolve("/tmp/codex-gateway/config.yaml")
    );
    expect(
      resolveConfigPath(undefined, {
        cwd: "/tmp/caller",
        projectRoot: "/tmp/codex-gateway",
      })
    ).toBe(resolve("/tmp/codex-gateway/config.yaml"));
  });

  test("resolves relative config override against the current project", () => {
    expect(resolveConfigPath("configs/local.yaml", { cwd: "/tmp/codex-gateway" })).toBe(
      resolve("/tmp/codex-gateway/configs/local.yaml")
    );
  });

  test("defaults gateway data and Web Chat paths to the project", () => {
    const input = {
      homeDir: "/Users/tester",
      projectRoot: "/tmp/codex-gateway",
      env: {},
    };
    const gatewayHome = resolve("/tmp/codex-gateway/.codex-gateway");
    expect(resolveGatewayHome(input)).toBe(gatewayHome);
    expect(resolveWebChatUsersPath(input)).toBe(
      join(gatewayHome, "web-chat", "users.json")
    );
    expect(resolveWebChatAuthSessionsPath(input)).toBe(
      join(gatewayHome, "web-chat", "auth-sessions.json")
    );
    expect(resolveWebChatUserRoot("user-1", input)).toBe(
      join(gatewayHome, "channels", "web", "user-1")
    );
    expect(resolveWebChatWorkspacePath("user-1", input)).toEndWith(
      join("channels", "web", "user-1", "workspace")
    );
    expect(resolveWebChatSessionsPath("user-1", input)).toEndWith(
      join("channels", "web", "user-1", "sessions")
    );
  });

  test("allows CODEX_GATEWAY_HOME to override the project data root", () => {
    expect(
      resolveGatewayHome({
        homeDir: "/Users/tester",
        projectRoot: "/tmp/codex-gateway",
        env: { CODEX_GATEWAY_HOME: "~/.custom-gateway" },
      })
    ).toBe(join("/Users/tester", ".custom-gateway"));
  });
});

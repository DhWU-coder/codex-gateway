import { describe, expect, test } from "bun:test";
import {
  resolveConfigPath,
  resolveDefaultConfigPath,
  resolveWebChatAuthSessionsPath,
  resolveWebChatSessionsPath,
  resolveWebChatUserRoot,
  resolveWebChatUsersPath,
  resolveWebChatWorkspacePath,
} from "../src/paths.js";

describe("paths", () => {
  test("defaults config path to project config.yaml", () => {
    expect(resolveDefaultConfigPath({ cwd: "/tmp/codex-gateway" })).toBe(
      "/tmp/codex-gateway/config.yaml"
    );
  });

  test("resolves relative config override against the current project", () => {
    expect(resolveConfigPath("configs/local.yaml", { cwd: "/tmp/codex-gateway" })).toBe(
      "/tmp/codex-gateway/configs/local.yaml"
    );
  });

  test("derives Web Chat data paths from gateway home and immutable user id", () => {
    const input = { homeDir: "/Users/tester", env: {} };
    expect(resolveWebChatUsersPath(input)).toBe(
      "/Users/tester/.codex-gateway/web-chat/users.json"
    );
    expect(resolveWebChatAuthSessionsPath(input)).toBe(
      "/Users/tester/.codex-gateway/web-chat/auth-sessions.json"
    );
    expect(resolveWebChatUserRoot("user-1", input)).toBe(
      "/Users/tester/.codex-gateway/channels/web/user-1"
    );
    expect(resolveWebChatWorkspacePath("user-1", input)).toEndWith(
      "/channels/web/user-1/workspace"
    );
    expect(resolveWebChatSessionsPath("user-1", input)).toEndWith(
      "/channels/web/user-1/sessions"
    );
  });
});

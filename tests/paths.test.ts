import { describe, expect, test } from "bun:test";
import { resolveConfigPath, resolveDefaultConfigPath } from "../src/paths.js";

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
});

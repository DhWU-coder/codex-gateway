import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("README", () => {
  test("documents codex-gateway commands instead of bun internals", () => {
    const readme = readFileSync("README.md", "utf-8");

    expect(readme).toContain("bun install");
    expect(readme).toContain("bun link");
    expect(readme).toContain("codex-gateway init-config");
    expect(readme).toContain("codex-gateway start");
    expect(readme).toContain(".codex-usage/usage.jsonl");
    expect(readme).toContain("[[codex:file:路径]]");
    expect(readme).toContain("/file");
    expect(readme).toContain("/sessions");
    expect(readme).toContain("/session N");
    expect(readme).toContain("/resume N");
    expect(readme).toContain("/fork N");
    expect(readme).toContain("--summary");
    expect(readme).toContain("不会删除旧会话");
    expect(readme).toContain("dangerouslyBypassApprovalsAndSandbox: true");
    expect(readme).toContain("默认使用完全权限模式");
    expect(readme).not.toContain("bun run src/index.ts");
    expect(readme).not.toContain("./bin/codex-gateway.cjs");
    expect(readme).not.toContain("~/.codex-gateway/config.yaml");
  });
});

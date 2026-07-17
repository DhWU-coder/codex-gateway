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
    expect(readme).not.toContain("bun run src/index.ts");
    expect(readme).not.toContain("./bin/codex-gateway.cjs");
    expect(readme).not.toContain("~/.codex-gateway/config.yaml");
  });
});

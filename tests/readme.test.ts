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
    expect(readme).toContain("service.host");
    expect(readme).toContain("0.0.0.0");
    expect(readme).toContain("/chat");
    expect(readme).toContain("Web Chat");
    expect(readme).toContain("registrationEnabled: true");
    expect(readme).toContain("注册成功后自动登录");
    expect(readme).toContain("每小时最多尝试注册 5 次");
    expect(readme).toContain("auth-sessions.json");
    expect(readme).toContain("重启服务后保持登录");
    expect(readme).toContain("不同 Session");
    expect(readme).toContain("不设置应用层并发上限");
    expect(readme).toContain("app-server --stdio");
    expect(readme).toContain("飞书频道仍使用");
    expect(readme).toContain("`/goal`");
    expect(readme).toContain("`/plan`");
    expect(readme).toContain("`@`");
    expect(readme).toContain("Skill、插件、应用");
    expect(readme).toContain("中间回复和工具调用");
    expect(readme).toContain("右键");
    expect(readme).toContain("长按");
    expect(readme).toContain("只允许本机");
    expect(readme).toContain("没有传输加密");
    expect(readme).not.toContain("bun run src/index.ts");
    expect(readme).not.toContain("./bin/codex-gateway.cjs");
    expect(readme).not.toContain("~/.codex-gateway/config.yaml");
  });
});

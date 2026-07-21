import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getCodexModelEditorState,
  getFeishuAccountSecret,
  getFeishuAccountsEditorState,
  saveCodexModelEditorState,
  saveFeishuAccountsEditorState,
} from "../src/web/config-editor.js";

let directory: string;
let configPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "codex-gateway-config-web-"));
  configPath = join(directory, "config.yaml");
  writeFileSync(configPath, exampleConfig());
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("Web 飞书配置编辑器", () => {
  test("读取、保存和删除全局 Codex 模型并保留注释", () => {
    expect(getCodexModelEditorState(configPath)).toEqual({
      model: "gpt-global",
      reasoningEffort: "",
      fast: null,
      verbosity: "",
    });

    expect(saveCodexModelEditorState({ model: "  gpt-updated  " }, configPath)).toEqual({
      model: "gpt-updated",
      reasoningEffort: "",
      fast: null,
      verbosity: "",
    });
    let text = readFileSync(configPath, "utf-8");
    let raw = parse(text);
    expect(raw.codex.model).toBe("gpt-updated");
    expect(text).toContain("# 全局模型注释");

    expect(saveCodexModelEditorState({ model: "" }, configPath)).toEqual({
      model: "",
      reasoningEffort: "",
      fast: null,
      verbosity: "",
    });
    text = readFileSync(configPath, "utf-8");
    raw = parse(text);
    expect(raw.codex).not.toHaveProperty("model");
    expect(text).toContain("# 项目配置注释");
  });

  test("保存、清除和校验全局 Codex 运行参数", () => {
    expect(
      saveCodexModelEditorState(
        { model: "gpt-global", reasoningEffort: "high", fast: true, verbosity: "low" },
        configPath
      )
    ).toEqual({
      model: "gpt-global",
      reasoningEffort: "high",
      fast: true,
      verbosity: "low",
    });
    let raw = parse(readFileSync(configPath, "utf-8"));
    expect(raw.codex).toMatchObject({ reasoningEffort: "high", fast: true, verbosity: "low" });

    expect(
      saveCodexModelEditorState(
        { model: "gpt-global", reasoningEffort: "", fast: null, verbosity: "" },
        configPath
      )
    ).toEqual({
      model: "gpt-global",
      reasoningEffort: "",
      fast: null,
      verbosity: "",
    });
    raw = parse(readFileSync(configPath, "utf-8"));
    expect(raw.codex).not.toHaveProperty("reasoningEffort");
    expect(raw.codex).not.toHaveProperty("fast");
    expect(raw.codex).not.toHaveProperty("verbosity");

    expect(() =>
      saveCodexModelEditorState(
        { model: "gpt-global", reasoningEffort: "extreme", fast: true, verbosity: "low" },
        configPath
      )
    ).toThrow("reasoningEffort 无效");
  });

  test("公共状态隐藏 Secret 并返回只读运行字段", () => {
    const state = getFeishuAccountsEditorState(configPath);

    expect(state.accounts).toEqual([
      expect.objectContaining({
        id: "primary",
        enabled: true,
        appId: "cli_primary",
        appSecret: "",
        hasAppSecret: true,
        botOpenId: "ou_primary",
        domain: "feishu",
        sendProgressReplies: false,
        model: "gpt-5",
        cwd: "/workspace/primary",
        historyBaseDir: "/history/primary",
      }),
    ]);
    expect(JSON.stringify(state)).not.toContain("secret-primary");
    expect(getFeishuAccountSecret("primary", configPath)).toEqual({
      appSecret: "secret-primary",
    });
  });

  test("保存热更新字段并保留 Secret、非热字段和其他配置注释", () => {
    const state = saveFeishuAccountsEditorState(
      {
        accounts: [
          {
            id: "primary",
            enabled: false,
            appId: "cli_updated",
            appSecret: "",
            botOpenId: "",
            domain: "lark",
            sendProgressReplies: true,
          },
        ],
      },
      configPath
    );

    const text = readFileSync(configPath, "utf-8");
    const raw = parse(text);
    expect(text).toContain("# 项目配置注释");
    expect(raw.service.port).toBe(18788);
    expect(raw.channels.feishu.accounts[0]).toEqual({
      id: "primary",
      enabled: false,
      appId: "cli_updated",
      appSecret: "secret-primary",
      domain: "lark",
      model: "gpt-5",
      cwd: "/workspace/primary",
      historyBaseDir: "/history/primary",
      sendProgressReplies: true,
      messageDedupeTtlMs: 600000,
      history: { maxMessages: 50, maxSessions: 100 },
      summary: { model: "gpt-5", maxMessages: 40, concurrency: 3 },
      customField: "keep-me",
    });
    expect(state.accounts[0]).toMatchObject({
      appId: "cli_updated",
      appSecret: "",
      hasAppSecret: true,
      enabled: false,
      domain: "lark",
    });
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("账号运行参数支持显式覆盖和留空继承全局配置", () => {
    const baseAccount = {
      id: "primary",
      enabled: true,
      appId: "cli_primary",
      appSecret: "",
      domain: "feishu" as const,
      sendProgressReplies: false,
    };

    saveFeishuAccountsEditorState(
      {
        accounts: [
          {
            ...baseAccount,
            model: "gpt-account",
            reasoningEffort: "high",
            fast: false,
            verbosity: "low",
          },
        ],
      },
      configPath
    );
    let raw = parse(readFileSync(configPath, "utf-8"));
    expect(raw.channels.feishu.accounts[0]).toMatchObject({
      model: "gpt-account",
      reasoningEffort: "high",
      fast: false,
      verbosity: "low",
    });

    const state = saveFeishuAccountsEditorState(
      {
        accounts: [
          {
            ...baseAccount,
            model: "",
            reasoningEffort: "",
            fast: null,
            verbosity: "",
          },
        ],
      },
      configPath
    );
    raw = parse(readFileSync(configPath, "utf-8"));
    expect(raw.channels.feishu.accounts[0]).not.toHaveProperty("model");
    expect(raw.channels.feishu.accounts[0]).not.toHaveProperty("reasoningEffort");
    expect(raw.channels.feishu.accounts[0]).not.toHaveProperty("fast");
    expect(raw.channels.feishu.accounts[0]).not.toHaveProperty("verbosity");
    expect(state.accounts[0]?.model).toBeUndefined();
  });

  test("新增账号必须提供 App ID 和 Secret", () => {
    expect(() =>
      saveFeishuAccountsEditorState(
        { accounts: [{ id: "new", enabled: true, appId: "cli_new", domain: "feishu" }] },
        configPath
      )
    ).toThrow("账号 new 缺少 App Secret");
  });

  test("拒绝重复账号和非法域名", () => {
    expect(() =>
      saveFeishuAccountsEditorState(
        {
          accounts: [
            { id: "same", appId: "cli_a", appSecret: "a", domain: "feishu" },
            { id: "same", appId: "cli_b", appSecret: "b", domain: "feishu" },
          ],
        },
        configPath
      )
    ).toThrow("飞书账号 ID 重复：same");

    expect(() =>
      saveFeishuAccountsEditorState(
        {
          accounts: [
            { id: "primary", appId: "cli_primary", appSecret: "", domain: "invalid" as never },
          ],
        },
        configPath
      )
    ).toThrow("飞书账号 primary 的域名无效");

    expect(() =>
      saveFeishuAccountsEditorState(
        {
          accounts: [
            {
              id: "primary",
              appId: "cli_primary",
              appSecret: "",
              domain: "feishu",
              verbosity: "verbose" as never,
            },
          ],
        },
        configPath
      )
    ).toThrow("账号 primary 的 verbosity 无效");
  });
});

function exampleConfig(): string {
  return `# 项目配置注释
service:
  port: 18788
  cwd: /workspace
codex:
  command: codex
  # 全局模型注释
  model: gpt-global
channels:
  feishu:
    accounts:
      - id: primary
        enabled: true
        appId: cli_primary
        appSecret: secret-primary
        botOpenId: ou_primary
        domain: feishu
        model: gpt-5
        cwd: /workspace/primary
        historyBaseDir: /history/primary
        sendProgressReplies: false
        messageDedupeTtlMs: 600000
        history:
          maxMessages: 50
          maxSessions: 100
        summary:
          model: gpt-5
          maxMessages: 40
          concurrency: 3
        customField: keep-me
`;
}

import { describe, expect, test } from "bun:test";
import { loadGatewayConfigFromObject } from "../src/config.js";

describe("gateway config", () => {
  test("loads multi-account Feishu config with per-account defaults", () => {
    const config = loadGatewayConfigFromObject(
      {
        service: {
          cwd: "~/codex-work",
        },
        codex: {
          model: "gpt-5",
          sandbox: "workspace-write",
        },
        channels: {
          feishu: {
            accounts: [
              {
                id: "personal",
                appId: "cli_a",
                appSecret: "secret_a",
                botOpenId: "ou_a",
              },
              {
                id: "team",
                appId: "cli_b",
                appSecret: "secret_b",
                cwd: "/tmp/team",
                model: "gpt-5-codex",
              },
            ],
          },
        },
      },
      {
        homeDir: "/Users/tester",
        env: {},
      }
    );

    expect(config.service.cwd).toBe("/Users/tester/codex-work");
    expect(config.codex.model).toBe("gpt-5");
    expect(config.channels.feishu.accounts).toHaveLength(2);
    expect(config.channels.feishu.accounts[0]).toMatchObject({
      id: "personal",
      enabled: true,
      cwd: "/Users/tester/.codex-gateway/workspace/personal",
      model: "gpt-5",
      domain: "feishu",
    });
    expect(config.channels.feishu.accounts[1]).toMatchObject({
      id: "team",
      cwd: "/tmp/team",
      model: "gpt-5-codex",
    });
  });

  test("keeps disabled accounts disabled even when credentials exist", () => {
    const config = loadGatewayConfigFromObject(
      {
        channels: {
          feishu: {
            accounts: [
              {
                id: "off",
                enabled: false,
                appId: "cli_a",
                appSecret: "secret_a",
              },
            ],
          },
        },
      },
      {
        homeDir: "/Users/tester",
        env: {},
      }
    );

    expect(config.channels.feishu.accounts[0].enabled).toBe(false);
  });
});

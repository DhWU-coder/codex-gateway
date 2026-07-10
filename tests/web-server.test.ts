import { describe, expect, test } from "bun:test";
import { handleWebRequest } from "../src/web-server.js";

describe("web server", () => {
  test("returns status JSON with channels", async () => {
    const response = await handleWebRequest(new Request("http://127.0.0.1/api/status"), {
      stateProvider: () => ({
        pid: 1234,
        startedAt: "2026-07-10T00:00:00.000Z",
        host: "127.0.0.1",
        port: 18788,
        webUrl: "http://127.0.0.1:18788/",
        logPath: "/tmp/service.log",
        cwd: "/tmp/work",
        channels: {},
      }),
      channelStatusProvider: () => ({
        channels: [{ id: "feishu:test", status: "connected" }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state.pid).toBe(1234);
    expect(body.channels.channels[0].id).toBe("feishu:test");
  });

  test("renders a monitor page", async () => {
    const response = await handleWebRequest(new Request("http://127.0.0.1/"), {
      stateProvider: () => null,
      channelStatusProvider: () => ({ channels: [] }),
    });

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Codex Gateway");
  });
});

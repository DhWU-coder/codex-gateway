import { createServer } from "node:net";
import { describe, expect, test } from "bun:test";
import {
  findServicePort,
  waitForServicePortState,
} from "../src/service/ports.js";

describe("服务端口探测", () => {
  test("使用目标监听地址探测端口", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const occupied = typeof address === "object" && address ? address.port : 0;
    try {
      const result = await findServicePort(occupied, "127.0.0.1");
      expect(result.port).toBeGreaterThan(occupied);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("service port state", () => {
  test("waits until the requested availability state is reached", async () => {
    let checks = 0;
    let now = 0;
    const reached = await waitForServicePortState(18788, "127.0.0.1", "available", {
      timeoutMs: 100,
      pollIntervalMs: 10,
      checkAvailable: async () => {
        checks += 1;
        return checks >= 3;
      },
      delay: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
    });

    expect(reached).toBe(true);
    expect(checks).toBe(3);
  });

  test("returns false when the requested state is not reached in time", async () => {
    let now = 0;
    const reached = await waitForServicePortState(18788, "127.0.0.1", "occupied", {
      timeoutMs: 20,
      pollIntervalMs: 10,
      checkAvailable: async () => true,
      delay: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
    });

    expect(reached).toBe(false);
  });
});

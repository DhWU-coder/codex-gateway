import { createServer } from "node:net";
import { describe, expect, test } from "bun:test";
import { findServicePort } from "../src/service/ports.js";

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

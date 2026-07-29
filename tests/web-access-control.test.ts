import { describe, expect, test } from "bun:test";
import { isChatRoute, isLoopbackAddress } from "../src/web/access-control.js";

describe("Web 访问控制", () => {
  test("识别 IPv4、IPv6 和映射形式的本机地址", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.8")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  test("仅将 Chat 页面和 Chat API 归入远程路由", () => {
    expect(isChatRoute("/chat")).toBe(true);
    expect(isChatRoute("/api/chat/auth/login")).toBe(true);
    expect(isChatRoute("/api/config")).toBe(false);
    expect(isChatRoute("/api/channels")).toBe(false);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getUsageDashboard } from "../src/web/usage-service.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-usage-web-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("Web 用量聚合服务", () => {
  test("聚合有效记录并忽略损坏或不兼容的 JSONL", () => {
    writeUsageLines([
      usageEvent("2026-07-20T01:00:00.000Z", "gpt-5", "/workspace/a", {
        total: 150,
        input: 100,
        cached: 40,
        output: 40,
        reasoning: 10,
      }),
      "{broken",
      JSON.stringify({ schema_version: "other.v1", usage: { total: 999 } }),
      usageEvent("2026-07-20T02:00:00.000Z", "gpt-5-mini", "/workspace/b", {
        total: 80,
        input: 50,
        output: 30,
      }),
    ]);

    const dashboard = getUsageDashboard({ projectRoot, preset: "all" });

    expect(dashboard.totalRequests).toBe(2);
    expect(dashboard.totals).toEqual({
      total: 230,
      input: 150,
      cached: 40,
      output: 70,
      reasoning: 10,
    });
    expect(dashboard.byModel).toEqual([
      expect.objectContaining({ name: "gpt-5", requests: 1, usage: { total: 150, input: 100, cached: 40, output: 40, reasoning: 10 } }),
      expect.objectContaining({ name: "gpt-5-mini", requests: 1, usage: { total: 80, input: 50, cached: 0, output: 30, reasoning: 0 } }),
    ]);
    expect(dashboard.byCwd.map((item) => item.name)).toEqual([
      "/workspace/a",
      "/workspace/b",
    ]);
    expect(dashboard.invalidLines).toBe(2);
  });

  test("按本地日期范围筛选并生成稳定的时间桶", () => {
    writeUsageLines([
      usageEvent("2026-07-18T03:00:00.000Z", "gpt-5", "/workspace", counters(10)),
      usageEvent("2026-07-19T03:00:00.000Z", "gpt-5", "/workspace", counters(20)),
      usageEvent("2026-07-20T03:00:00.000Z", "gpt-5", "/workspace", counters(30)),
    ]);

    const dashboard = getUsageDashboard({
      projectRoot,
      preset: "custom",
      startDate: "2026-07-19",
      endDate: "2026-07-20",
      bucket: "day",
      now: "2026-07-20T12:00:00+08:00",
    });

    expect(dashboard.totalRequests).toBe(2);
    expect(dashboard.totals.total).toBe(50);
    expect(dashboard.timeline).toEqual([
      expect.objectContaining({ key: "2026-07-19", requests: 1 }),
      expect.objectContaining({ key: "2026-07-20", requests: 1 }),
    ]);
    expect(dashboard.range).toMatchObject({
      preset: "custom",
      bucket: "day",
    });
  });

  test("空用量文件返回可渲染的空仪表盘", () => {
    const dashboard = getUsageDashboard({ projectRoot, preset: "month" });

    expect(dashboard.totalRequests).toBe(0);
    expect(dashboard.totals.total).toBe(0);
    expect(dashboard.timeline).toEqual([]);
    expect(dashboard.recent).toEqual([]);
    expect(dashboard.logPath).toBe(join(projectRoot, ".codex-usage", "usage.jsonl"));
  });
});

function writeUsageLines(lines: string[]): void {
  const directory = join(projectRoot, ".codex-usage");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "usage.jsonl"), `${lines.join("\n")}\n`);
}

function usageEvent(
  timestamp: string,
  model: string,
  cwd: string,
  usage: { total: number; input: number; output: number; cached?: number; reasoning?: number }
): string {
  return JSON.stringify({
    schema_version: "codex-usage.project-log.v1",
    timestamp,
    provider: "openai-codex",
    model,
    cwd,
    request_id: `${model}-${timestamp}`,
    api_surface: "chatgpt-codex-responses",
    usage,
  });
}

function counters(total: number) {
  return { total, input: total, output: 0 };
}

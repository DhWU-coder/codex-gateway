import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  WebChatCapabilityCatalog,
} from "../src/web-chat/capabilities.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Chat Capability 目录", () => {
  test("公开项不泄露路径并解析为 App Server 结构化输入", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-capabilities-"));
    roots.push(cwd);
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "README.md"), "readme");
    const catalog = new WebChatCapabilityCatalog({
      runtime: {
        listSkills: async () => [
          {
            cwd,
            skills: [
              {
                name: "review",
                description: "代码审查",
                path: "/opt/codex/skills/review/SKILL.md",
                enabled: true,
              },
            ],
          },
        ],
        listInstalledPlugins: async () => [
          { id: "github", name: "GitHub", enabled: true, installed: true },
        ],
        listInstalledApps: async () => [
          { id: "browser", runtimeName: "Browser", enabled: true, callable: true },
        ],
        searchFiles: async () => [
          {
            root: cwd,
            path: "README.md",
            file_name: "README.md",
            match_type: "file",
          },
          {
            root: cwd,
            path: "docs",
            file_name: "docs",
            match_type: "directory",
          },
        ],
      },
      createId: (() => {
        let id = 0;
        return () => `capability-${++id}`;
      })(),
    });

    const base = await catalog.list("user-1", cwd);
    const files = await catalog.searchFiles("user-1", cwd, "read");
    const publicText = JSON.stringify({ base, files });
    expect(publicText).not.toContain(cwd);
    expect(publicText).not.toContain("/opt/codex");
    expect(base.map((item) => item.kind)).toEqual(["skill", "plugin", "app"]);
    expect(files.map((item) => item.kind)).toEqual(["file", "directory"]);

    const resolved = catalog.resolve(
      "user-1",
      cwd,
      [...base, ...files].map((item) => item.id)
    );
    expect(resolved.structuredInput).toEqual([
      {
        type: "skill",
        name: "review",
        path: "/opt/codex/skills/review/SKILL.md",
      },
      { type: "mention", name: "README.md", path: join(cwd, "README.md") },
      { type: "mention", name: "docs", path: join(cwd, "docs") },
    ]);
    expect(Object.keys(resolved.additionalContext)).toHaveLength(2);
    expect(resolved.references).toHaveLength(5);
  });

  test("拒绝跨用户、过期和越出工作区的文件引用", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "codex-gateway-capabilities-boundary-"));
    roots.push(cwd);
    let now = 1_000;
    const catalog = new WebChatCapabilityCatalog({
      runtime: {
        listSkills: async () => [],
        listInstalledPlugins: async () => [],
        listInstalledApps: async () => [],
        searchFiles: async () => [
          {
            root: cwd,
            path: "../outside.txt",
            file_name: "outside.txt",
            match_type: "file",
          },
        ],
      },
      now: () => now,
      ttlMs: 100,
      createId: () => "capability-boundary",
    });
    const [item] = await catalog.searchFiles("user-1", cwd, "outside");

    expect(() => catalog.resolve("user-2", cwd, [item!.id])).toThrow("不可用");
    expect(() => catalog.resolve("user-1", cwd, [item!.id])).toThrow("工作区");
    now += 101;
    expect(() => catalog.resolve("user-1", cwd, [item!.id])).toThrow("过期");
  });
});

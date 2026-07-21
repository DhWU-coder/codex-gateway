import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createCodexModelCatalog,
  readCodexModels,
} from "../src/codex/model-catalog.js";

describe("Codex model catalog", () => {
  test("reads visible models from the app-server protocol and puts the default first", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-models-"));
    const command = createFakeCodex(directory, [
      {
        id: "gpt-secondary",
        model: "gpt-secondary",
        displayName: "GPT Secondary",
        description: "Secondary model",
        hidden: false,
        isDefault: false,
      },
      {
        id: "gpt-default",
        model: "gpt-default",
        displayName: "GPT Default",
        description: "Default model",
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "响应更快" },
          { reasoningEffort: "high", description: "推理更深" },
          { reasoningEffort: "invalid", description: "非法值" },
        ],
        defaultReasoningEffort: "low",
        additionalSpeedTiers: ["fast", "fast", ""],
        serviceTiers: [
          { id: "priority", name: "Fast", description: "1.5x speed" },
          { id: "", name: "Invalid", description: "忽略" },
        ],
        isDefault: true,
      },
    ]);

    const models = await readCodexModels({ command, timeoutMs: 1_000 });

    expect(models).toEqual([
      {
        id: "gpt-default",
        model: "gpt-default",
        displayName: "GPT Default",
        description: "Default model",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "响应更快" },
          { reasoningEffort: "high", description: "推理更深" },
        ],
        defaultReasoningEffort: "low",
        additionalSpeedTiers: ["fast"],
        serviceTiers: [{ id: "priority", name: "Fast", description: "1.5x speed" }],
        supportsFast: true,
        isDefault: true,
      },
      {
        id: "gpt-secondary",
        model: "gpt-secondary",
        displayName: "GPT Secondary",
        description: "Secondary model",
        supportedReasoningEfforts: [],
        additionalSpeedTiers: [],
        serviceTiers: [],
        supportsFast: false,
        isDefault: false,
      },
    ]);
  });

  test("reuses the cached model list within the TTL", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-model-cache-"));
    const counterPath = join(directory, "count.txt");
    const command = createFakeCodex(directory, [
      {
        id: "gpt-cached",
        model: "gpt-cached",
        displayName: "GPT Cached",
        description: "Cached model",
        hidden: false,
        isDefault: true,
      },
    ], counterPath);
    const catalog = createCodexModelCatalog({ command, timeoutMs: 1_000, ttlMs: 60_000 });

    await catalog.list();
    await catalog.list();

    expect(readFileSync(counterPath, "utf-8")).toBe("1");
  });

  test("rejects malformed app-server output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-model-invalid-"));
    const command = join(directory, "fake-codex");
    writeFileSync(
      command,
      [
        "#!/usr/bin/env bun",
        "for await (const line of console) {",
        "  if (line.includes('initialize')) console.log('{broken');",
        "}",
      ].join("\n"),
      { mode: 0o700 }
    );
    chmodSync(command, 0o700);

    await expect(readCodexModels({ command, timeoutMs: 1_000 })).rejects.toThrow(
      "Codex 模型列表响应不是有效 JSON"
    );
  });

  test("terminates a model request after the timeout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-model-timeout-"));
    const command = join(directory, "fake-codex");
    writeFileSync(command, ["#!/usr/bin/env bun", "await Bun.sleep(10_000);"].join("\n"), {
      mode: 0o700,
    });
    chmodSync(command, 0o700);

    await expect(readCodexModels({ command, timeoutMs: 20 })).rejects.toThrow(
      "读取 Codex 模型列表超时"
    );
  });
});

function createFakeCodex(
  directory: string,
  models: Array<Record<string, unknown>>,
  counterPath?: string
): string {
  const command = join(directory, "fake-codex");
  writeFileSync(
    command,
    [
      "#!/usr/bin/env bun",
      counterPath
        ? `await Bun.write(${JSON.stringify(counterPath)}, String(Number((await Bun.file(${JSON.stringify(counterPath)}).exists()) ? await Bun.file(${JSON.stringify(counterPath)}).text() : 0) + 1));`
        : "",
      "if (process.argv[2] !== 'app-server' || process.argv[3] !== '--stdio') process.exit(2);",
      "for await (const line of console) {",
      "  const message = JSON.parse(line);",
      "  if (message.method === 'initialize') {",
      "    console.log(JSON.stringify({ id: message.id, result: { userAgent: 'fake' } }));",
      "  }",
      "  if (message.method === 'model/list') {",
      `    console.log(JSON.stringify({ id: message.id, result: { data: ${JSON.stringify(models)}, nextCursor: null } }));`,
      "  }",
      "}",
    ]
      .filter(Boolean)
      .join("\n"),
    { mode: 0o700 }
  );
  chmodSync(command, 0o700);
  return command;
}

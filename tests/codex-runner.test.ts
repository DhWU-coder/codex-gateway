import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildCodexCommand, runCodex } from "../src/codex/runner.js";
import { parseCodexJsonEvents } from "../src/codex/json-events.js";

describe("Codex runner", () => {
  test("builds a fresh codex exec command with stdin prompt and images", () => {
    const command = buildCodexCommand({
      cwd: "/tmp/work",
      model: "gpt-5",
      prompt: "你好",
      imagePaths: ["/tmp/a.png"],
      outputFile: "/tmp/out.txt",
      sandbox: "workspace-write",
      skipGitRepoCheck: true,
    });

    expect(command.command).toBe("codex");
    expect(command.cwd).toBe("/tmp/work");
    expect(command.stdin).toBe("你好");
    expect(command.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      "/tmp/work",
      "--model",
      "gpt-5",
      "--sandbox",
      "workspace-write",
      "--output-last-message",
      "/tmp/out.txt",
      "--image",
      "/tmp/a.png",
      "-",
    ]);
  });

  test("builds a resume command when session id exists", () => {
    const command = buildCodexCommand({
      cwd: "/tmp/work",
      prompt: "继续",
      sessionId: "00000000-0000-0000-0000-000000000001",
      outputFile: "/tmp/out.txt",
      skipGitRepoCheck: true,
    });

    expect(command.args).toEqual([
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "--output-last-message",
      "/tmp/out.txt",
      "00000000-0000-0000-0000-000000000001",
      "-",
    ]);
  });

  test("extracts session id and assistant text from flexible JSONL events", () => {
    const parsed = parseCodexJsonEvents(
      [
        JSON.stringify({ type: "thread.started", thread_id: "sess_1" }),
        JSON.stringify({ type: "agent_message", message: "你好" }),
        JSON.stringify({ type: "assistant_delta", delta: "，世界" }),
        JSON.stringify({
          type: "turn.completed",
          model: "gpt-5",
          usage: {
            input_tokens: 101,
            cached_input_tokens: 7,
            output_tokens: 23,
            reasoning_output_tokens: 5,
            total_tokens: 124,
          },
        }),
      ].join("\n")
    );

    expect(parsed.sessionId).toBe("sess_1");
    expect(parsed.assistantText).toBe("你好，世界");
    expect(parsed.model).toBe("gpt-5");
    expect(parsed.usage).toEqual({
      total: 124,
      input: 101,
      cached: 7,
      output: 23,
      reasoning: 5,
    });
  });

  test("appends real usage after a successful Codex CLI run", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-usage-project-"));
    const workdir = mkdtempSync(join(tmpdir(), "codex-gateway-usage-work-"));
    const fakeCodex = join(projectRoot, "fake-codex");
    writeFileSync(
      fakeCodex,
      [
        "#!/usr/bin/env bun",
        "const outputIndex = process.argv.indexOf('--output-last-message');",
        "await Bun.write(process.argv[outputIndex + 1], '测试回复');",
        "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }));",
        "console.log(JSON.stringify({ type: 'turn.completed', model: 'gpt-5', usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } }));",
      ].join("\n"),
      { mode: 0o700 }
    );
    chmodSync(fakeCodex, 0o700);

    await runCodex({
      cwd: workdir,
      prompt: "不要写入日志的 prompt",
      model: "gpt-5",
      command: fakeCodex,
      projectRoot,
    });

    const lines = readFileSync(join(projectRoot, ".codex-usage", "usage.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(event).toMatchObject({
      schema_version: "codex-usage.project-log.v1",
      source: "codex-gateway",
      channel: "Codex Gateway",
      provider: "openai-codex",
      auth: "codex-oauth",
      api_surface: "chatgpt-codex-responses",
      project_root: projectRoot,
      cwd: workdir,
      session_id: "thread_1",
      model: "gpt-5",
      usage: { total: 20, input: 12, output: 8 },
    });
    expect(JSON.stringify(event)).not.toContain("不要写入日志的 prompt");
    expect(JSON.stringify(event)).not.toContain("测试回复");
  });

  test("does not estimate or write usage when Codex returns no usage", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-no-usage-project-"));
    const workdir = mkdtempSync(join(tmpdir(), "codex-gateway-no-usage-work-"));
    const fakeCodex = join(projectRoot, "fake-codex");
    writeFileSync(
      fakeCodex,
      [
        "#!/usr/bin/env bun",
        "const outputIndex = process.argv.indexOf('--output-last-message');",
        "await Bun.write(process.argv[outputIndex + 1], '没有 usage');",
        "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread_without_usage' }));",
      ].join("\n"),
      { mode: 0o700 }
    );
    chmodSync(fakeCodex, 0o700);

    await runCodex({
      cwd: workdir,
      prompt: "不应该被估算",
      model: "gpt-5",
      command: fakeCodex,
      projectRoot,
    });

    expect(() => readFileSync(join(projectRoot, ".codex-usage", "usage.jsonl"))).toThrow();
  });
});

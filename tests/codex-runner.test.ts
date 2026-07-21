import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildCodexCommand, runCodex } from "../src/codex/runner.js";
import { parseCodexJsonEvents, parseCodexProgressLine } from "../src/codex/json-events.js";

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
      sandbox: "danger-full-access",
      search: true,
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: true,
    });

    expect(command.args).toEqual([
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'web_search="live"',
      "--dangerously-bypass-approvals-and-sandbox",
      "--output-last-message",
      "/tmp/out.txt",
      "00000000-0000-0000-0000-000000000001",
      "-",
    ]);
  });

  test("full access fresh runs bypass approvals without adding a sandbox", () => {
    const command = buildCodexCommand({
      cwd: "/tmp/work",
      prompt: "联网检查",
      outputFile: "/tmp/out.txt",
      sandbox: "danger-full-access",
      search: true,
      dangerouslyBypassApprovalsAndSandbox: true,
    });

    expect(command.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(command.args).toContain('web_search="live"');
    expect(command.args).not.toContain("--sandbox");
  });

  test("maps runtime tuning to Codex config flags before extra arguments", () => {
    const command = buildCodexCommand({
      cwd: "/tmp/work",
      prompt: "调优",
      outputFile: "/tmp/out.txt",
      reasoningEffort: "high",
      fast: true,
      verbosity: "low",
      extraArgs: ["-c", 'model_verbosity="high"'],
    });

    expect(command.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      "/tmp/work",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'model_verbosity="low"',
      "--enable",
      "fast_mode",
      "-c",
      'service_tier="fast"',
      "-c",
      'model_verbosity="high"',
      "--output-last-message",
      "/tmp/out.txt",
      "-",
    ]);
  });

  test("passes channel instructions as developer instructions before extra arguments", () => {
    const command = buildCodexCommand({
      cwd: "/tmp/work",
      prompt: "执行任务",
      outputFile: "/tmp/out.txt",
      developerInstructions: "频道专属规则\n第二行",
      extraArgs: ["-c", 'developer_instructions="临时覆盖"'],
    });

    expect(command.args).toContain("-c");
    expect(command.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      "/tmp/work",
      "-c",
      'developer_instructions="频道专属规则\\n第二行"',
      "-c",
      'developer_instructions="临时覆盖"',
      "--output-last-message",
      "/tmp/out.txt",
      "-",
    ]);
  });

  test("does not add developer instructions for blank content", () => {
    const command = buildCodexCommand({
      cwd: "/tmp/work",
      prompt: "执行任务",
      outputFile: "/tmp/out.txt",
      developerInstructions: "  \n ",
    });

    expect(command.args.join(" ")).not.toContain("developer_instructions");
  });

  test("explicitly disables Fast mode without setting a service tier", () => {
    const command = buildCodexCommand({
      cwd: "/tmp/work",
      prompt: "标准速度",
      outputFile: "/tmp/out.txt",
      fast: false,
    });

    expect(command.args).toContain("--disable");
    expect(command.args).toContain("fast_mode");
    expect(command.args).not.toContain('service_tier="fast"');
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

  test("normalizes Codex item events into progress events", () => {
    expect(
      parseCodexProgressLine(
        JSON.stringify({
          type: "item.started",
          item: { id: "item_1", type: "command_execution", command: "bun test" },
        })
      )
    ).toEqual([
      {
        type: "tool_start",
        name: "command_execution",
        input: { command: "bun test" },
        toolUseId: "item_1",
      },
    ]);
    expect(
      parseCodexProgressLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "command_execution",
            aggregated_output: "57 tests passed",
            status: "completed",
          },
        })
      )
    ).toEqual([
      {
        type: "tool_result",
        name: "command_execution",
        text: "57 tests passed",
        isError: false,
        toolUseId: "item_1",
      },
    ]);
    expect(
      parseCodexProgressLine(
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_2", type: "agent_message", text: "已经完成。" },
        })
      )
    ).toEqual([{ type: "assistant_text", text: "已经完成。" }]);
  });

  test("emits progress before the Codex process exits", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-progress-project-"));
    const workdir = mkdtempSync(join(tmpdir(), "codex-gateway-progress-work-"));
    const fakeCodex = join(projectRoot, "fake-codex");
    writeFileSync(
      fakeCodex,
      [
        "#!/usr/bin/env bun",
        "const outputIndex = process.argv.indexOf('--output-last-message');",
        "console.log(JSON.stringify({ type: 'item.started', item: { id: 'tool_1', type: 'command_execution', command: 'pwd' } }));",
        "await Bun.sleep(80);",
        "console.log(JSON.stringify({ type: 'item.completed', item: { id: 'tool_1', type: 'command_execution', aggregated_output: '/tmp/work', status: 'completed' } }));",
        "console.log(JSON.stringify({ type: 'item.completed', item: { id: 'answer_1', type: 'agent_message', text: '完成' } }));",
        "await Bun.write(process.argv[outputIndex + 1], '完成');",
      ].join("\n"),
      { mode: 0o700 }
    );
    chmodSync(fakeCodex, 0o700);
    const events: unknown[] = [];
    let settled = false;
    let releaseProgress!: () => void;
    const progressReceived = new Promise<void>((resolve) => {
      releaseProgress = resolve;
    });

    const run = runCodex({
      cwd: workdir,
      prompt: "测试进度",
      command: fakeCodex,
      projectRoot,
      onProgress(event) {
        events.push(event);
        releaseProgress();
      },
    }).finally(() => {
      settled = true;
    });

    await progressReceived;
    expect(settled).toBe(false);
    await run;
    expect(events).toEqual([
      {
        type: "tool_start",
        name: "command_execution",
        input: { command: "pwd" },
        toolUseId: "tool_1",
      },
      {
        type: "tool_result",
        name: "command_execution",
        text: "/tmp/work",
        isError: false,
        toolUseId: "tool_1",
      },
      { type: "assistant_text", text: "完成" },
    ]);
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
        "console.log(JSON.stringify({ type: 'turn.completed', model: 'gpt-5', usage: { input_tokens: 12, output_tokens: 8 } }));",
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

  test("does not write usage when Codex exits with an error", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-failed-usage-project-"));
    const workdir = mkdtempSync(join(tmpdir(), "codex-gateway-failed-usage-work-"));
    const fakeCodex = join(projectRoot, "fake-codex");
    writeFileSync(
      fakeCodex,
      [
        "#!/usr/bin/env bun",
        "console.log(JSON.stringify({ type: 'turn.completed', model: 'gpt-5', usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } }));",
        "process.exit(1);",
      ].join("\n"),
      { mode: 0o700 }
    );
    chmodSync(fakeCodex, 0o700);

    await expect(
      runCodex({
        cwd: workdir,
        prompt: "失败请求",
        command: fakeCodex,
        projectRoot,
      })
    ).rejects.toThrow("Codex CLI failed (1)");

    expect(() => readFileSync(join(projectRoot, ".codex-usage", "usage.jsonl"))).toThrow();
  });

  test("does not write usage when Codex is interrupted", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "codex-gateway-aborted-usage-project-"));
    const workdir = mkdtempSync(join(tmpdir(), "codex-gateway-aborted-usage-work-"));
    const fakeCodex = join(projectRoot, "fake-codex");
    writeFileSync(
      fakeCodex,
      [
        "#!/usr/bin/env bun",
        "console.log(JSON.stringify({ type: 'item.started', item: { id: 'tool_1', type: 'command_execution', command: 'sleep' } }));",
        "await Bun.sleep(30000);",
        "console.log(JSON.stringify({ type: 'turn.completed', model: 'gpt-5', usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } }));",
      ].join("\n"),
      { mode: 0o700 }
    );
    chmodSync(fakeCodex, 0o700);
    const controller = new AbortController();

    await expect(
      runCodex({
        cwd: workdir,
        prompt: "中断请求",
        command: fakeCodex,
        projectRoot,
        signal: controller.signal,
        onProgress() {
          controller.abort();
        },
      })
    ).rejects.toThrow("Codex session stopped");

    expect(() => readFileSync(join(projectRoot, ".codex-usage", "usage.jsonl"))).toThrow();
  });
});

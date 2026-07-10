import { describe, expect, test } from "bun:test";
import { buildCodexCommand } from "../src/codex/runner.js";
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
        JSON.stringify({ type: "session_started", session_id: "sess_1" }),
        JSON.stringify({ type: "agent_message", message: "你好" }),
        JSON.stringify({ type: "assistant_delta", delta: "，世界" }),
      ].join("\n")
    );

    expect(parsed.sessionId).toBe("sess_1");
    expect(parsed.assistantText).toBe("你好，世界");
  });
});

import { describe, expect, test } from "bun:test";
import {
  getWindowsHideSpawnOptions,
  resolveCodexSpawnCommand,
} from "../src/process-options.js";

describe("child process options", () => {
  test("hides child process windows only on Windows", () => {
    expect(getWindowsHideSpawnOptions("win32")).toEqual({ windowsHide: true });
    expect(getWindowsHideSpawnOptions("darwin")).toEqual({});
    expect(getWindowsHideSpawnOptions("linux")).toEqual({});
  });

  test("bypasses the Windows npm cmd wrapper for Codex", () => {
    const existingFiles = new Set([
      "C:\\Users\\tester\\npm\\codex.cmd",
      "C:\\Users\\tester\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
      "D:\\nodejs\\node.exe",
    ]);

    expect(
      resolveCodexSpawnCommand("codex.cmd", ["app-server", "--stdio"], {
        platform: "win32",
        env: { Path: "C:\\Users\\tester\\npm;D:\\nodejs" },
        fileExists: (path) => existingFiles.has(path),
      })
    ).toEqual({
      command: "D:\\nodejs\\node.exe",
      args: [
        "C:\\Users\\tester\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
        "app-server",
        "--stdio",
      ],
    });
  });

  test("prefers node.exe installed beside the npm wrapper", () => {
    const existingFiles = new Set([
      "C:\\npm\\codex.cmd",
      "C:\\npm\\node.exe",
      "C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
    ]);

    expect(
      resolveCodexSpawnCommand("C:\\npm\\codex.cmd", ["--version"], {
        platform: "win32",
        env: { PATH: "" },
        fileExists: (path) => existingFiles.has(path),
      })
    ).toEqual({
      command: "C:\\npm\\node.exe",
      args: ["C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js", "--version"],
    });
  });

  test("leaves other platforms, custom commands, and unknown installs unchanged", () => {
    const args = ["app-server", "--stdio"];
    expect(resolveCodexSpawnCommand("codex", args, { platform: "darwin" })).toEqual({
      command: "codex",
      args,
    });
    expect(resolveCodexSpawnCommand("custom-codex.exe", args, { platform: "win32" })).toEqual({
      command: "custom-codex.exe",
      args,
    });
    expect(
      resolveCodexSpawnCommand("codex.cmd", args, {
        platform: "win32",
        env: { PATH: "C:\\missing" },
        fileExists: () => false,
      })
    ).toEqual({ command: "codex.cmd", args });
  });
});

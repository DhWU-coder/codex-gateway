import { describe, expect, test } from "bun:test";
import { getWindowsHideSpawnOptions } from "../src/process-options.js";

describe("child process options", () => {
  test("hides child process windows only on Windows", () => {
    expect(getWindowsHideSpawnOptions("win32")).toEqual({ windowsHide: true });
    expect(getWindowsHideSpawnOptions("darwin")).toEqual({});
    expect(getWindowsHideSpawnOptions("linux")).toEqual({});
  });
});
